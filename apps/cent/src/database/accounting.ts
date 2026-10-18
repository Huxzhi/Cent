import { type DBSchema, type IDBPTransaction, openDB } from "idb";
import { isEqual } from "lodash-es";
import {
    type AccountingData,
    getRootTransactions,
    validateAccountingData,
} from "../ledger/accounting";
import {
    type AccountingItem,
    type AccountingMeta,
    fromAccountingRecords,
    toAccountingItem,
    toAccountingMeta,
} from "./accounting-record";
import {
    createStashActions,
    type FullAction,
    mergeStashSnapshots,
    StashBucket,
    type StashSnapshot,
} from "./stash";

// 根交易完整包含 children；开发阶段使用新库，不读取或迁移旧开发库。
export const ACCOUNTING_BOOK_PREFIX = "cent-accounting-book/v6/";
export interface AccountingBook {
    id: string;
    name: string;
    revision: number;
    createdAt: number;
    updatedAt: number;
}
export interface LoadedAccountingBook {
    book: AccountingBook;
    data: AccountingData;
    remoteId?: string;
    remoteProvider?: string;
    pendingSync?: boolean;
}
export type AccountingSnapshot = StashSnapshot<AccountingItem, AccountingMeta>;
export interface AccountingSyncState {
    remoteId: string;
    provider?: string;
    baseline: AccountingSnapshot;
    generation: string;
}
export interface AccountingSyncSnapshot {
    book: AccountingBook;
    current: AccountingSnapshot;
    sync?: AccountingSyncState;
    actions: FullAction<AccountingItem>[];
}
export interface AccountingRepository {
    listBooks(): Promise<AccountingBook[]>;
    loadBook(id: string): Promise<LoadedAccountingBook>;
    createBook(
        id: string,
        name: string,
        now: number,
        data?: AccountingData,
    ): Promise<LoadedAccountingBook>;
    saveBook(
        id: string,
        revision: number,
        data: AccountingData,
        now: number,
    ): Promise<LoadedAccountingBook>;
}
interface AccountingConfig {
    format: "cent-accounting";
    storageVersion: 6;
    book: AccountingBook;
    sync?: AccountingSyncState;
}
export interface AccountingDB extends DBSchema {
    __items: {
        key: string;
        value: AccountingItem;
        indexes: {
            time: number;
            creatorId: string | number;
        };
    };
    __meta: { key: string; value: { id: "metaKey"; value: AccountingMeta } };
    __config: {
        key: string;
        value: { id: "metaKey"; value: AccountingConfig };
    };
    __stashes: {
        key: string;
        value: FullAction<AccountingItem>;
        indexes: { timestamp: number };
    };
}
const stores = [
    StashBucket.ITEM_NAME,
    StashBucket.META_NAME,
    StashBucket.CONFIG_NAME,
    StashBucket.STASH_NAME,
] as const;
type WriteTransaction = IDBPTransaction<
    AccountingDB,
    typeof stores,
    "readwrite"
>;
export class AccountingConflictError extends Error {
    constructor() {
        super("账本已在其他页面更新，请重新加载后再保存。");
    }
}
function checkBook(book: AccountingBook): AccountingBook {
    if (!book.id.trim() || !book.name.trim())
        throw new Error("账本 ID 和名称不能为空。");
    if (!Number.isSafeInteger(book.revision) || book.revision < 0)
        throw new Error("账本版本无效。");
    for (const time of [book.createdAt, book.updatedAt]) {
        if (!Number.isSafeInteger(time) || time < 0)
            throw new Error("账本时间无效。");
    }
    if (book.updatedAt < book.createdAt)
        throw new Error("账本更新时间不能早于创建时间。");
    return book;
}
function configBook(config: AccountingConfig | undefined): AccountingBook {
    if (config?.format !== "cent-accounting" || config.storageVersion !== 6)
        throw new Error("这不是复式账本数据库。");
    return checkBook(config.book);
}
function configRecord(
    book: AccountingBook,
    sync?: AccountingSyncState,
): AccountingDB["__config"]["value"] {
    return {
        id: "metaKey",
        value: {
            format: "cent-accounting",
            storageVersion: 6,
            book,
            ...(sync ? { sync } : {}),
        },
    };
}
async function writeAll(actions: (() => Promise<unknown>)[]) {
    await Promise.all(actions.map(async (write) => write()));
}
async function abortWrite(tx: WriteTransaction) {
    try {
        tx.abort();
    } catch {
        /* 请求失败可能已经中止。 */
    }
    await tx.done.catch(() => {});
}
function actionTarget(action: FullAction<AccountingItem>): string {
    return action.type === "meta"
        ? "meta"
        : `item/${action.type === "delete" ? action.value : action.value.id}`;
}
/** 一账本一库，沿用原版四个存储区；完整分录与增量日志在同一事务内提交。 */
export class IndexedDBAccountingRepository implements AccountingRepository {
    private readonly databasePrefix: string;
    constructor(databasePrefix = ACCOUNTING_BOOK_PREFIX) {
        this.databasePrefix = databasePrefix;
    }
    getBookDatabaseName(id: string): string {
        return `${this.databasePrefix}${encodeURIComponent(id)}`;
    }
    private open(id: string) {
        return openDB<AccountingDB>(this.getBookDatabaseName(id), 1, {
            upgrade(db) {
                const items = db.createObjectStore(StashBucket.ITEM_NAME, {
                    keyPath: "id",
                });
                items.createIndex("time", "time");
                items.createIndex("creatorId", "creatorId");
                db.createObjectStore(StashBucket.META_NAME, {
                    keyPath: "id",
                    autoIncrement: true,
                });
                db.createObjectStore(StashBucket.CONFIG_NAME, {
                    keyPath: "id",
                    autoIncrement: true,
                });
                const stashes = db.createObjectStore(StashBucket.STASH_NAME, {
                    keyPath: "id",
                    autoIncrement: true,
                });
                stashes.createIndex("timestamp", "timestamp");
            },
        });
    }
    async listBooks(): Promise<AccountingBook[]> {
        const books: AccountingBook[] = [];
        for (const database of await indexedDB.databases()) {
            if (!database.name?.startsWith(this.databasePrefix)) continue;
            const db = await openDB<AccountingDB>(database.name);
            try {
                if (!db.objectStoreNames.contains("__config")) continue;
                const config = (await db.get("__config", "metaKey"))?.value;
                // 创建失败留下的空库不属于账本；旧 Bill 库也不会被自动读取。
                if (config?.format !== "cent-accounting") continue;
                const book = configBook(config);
                if (database.name !== this.getBookDatabaseName(book.id))
                    throw new Error("账本数据库名称与标识不匹配。");
                books.push(book);
            } finally {
                db.close();
            }
        }
        return books.sort(
            (left, right) =>
                left.createdAt - right.createdAt ||
                left.id.localeCompare(right.id),
        );
    }
    async loadBook(id: string): Promise<LoadedAccountingBook> {
        if (
            !(await indexedDB.databases()).some(
                (database) => database.name === this.getBookDatabaseName(id),
            )
        )
            throw new Error("找不到账本。");
        const db = await this.open(id);
        try {
            const tx = db.transaction(stores, "readonly");
            const [config, meta, items, actions] = await Promise.all([
                tx.objectStore("__config").get("metaKey"),
                tx.objectStore("__meta").get("metaKey"),
                tx.objectStore("__items").getAll(),
                tx.objectStore("__stashes").getAll(),
            ]);
            await tx.done;
            const book = configBook(config?.value);
            if (book.id !== id || !meta)
                throw new Error("账本元数据缺失或标识不匹配。");
            return {
                book,
                ...(config?.value.sync
                    ? {
                          remoteId: config.value.sync.remoteId,
                          remoteProvider:
                              config.value.sync.provider ?? "github",
                          pendingSync: actions.length > 0,
                      }
                    : {}),
                data: validateAccountingData(
                    fromAccountingRecords(meta.value, items),
                ),
            };
        } finally {
            db.close();
        }
    }
    private async insertBook(
        book: AccountingBook,
        data: AccountingData,
    ): Promise<LoadedAccountingBook> {
        const db = await this.open(book.id);
        const tx = db.transaction(stores, "readwrite");
        try {
            const meta = toAccountingMeta(data);
            const items = getRootTransactions(data.transactions).map((item) =>
                toAccountingItem(item),
            );

            await writeAll([
                () => tx.objectStore("__config").add(configRecord(book)),
                () =>
                    tx
                        .objectStore("__meta")
                        .add({ id: "metaKey", value: meta }),
                () =>
                    tx.objectStore("__stashes").add({
                        id: crypto.randomUUID(),
                        type: "meta",
                        timestamp: book.updatedAt,
                        metaValue: meta,
                    }),
                ...items.flatMap((item) => [
                    () => tx.objectStore("__items").add(item),
                    () =>
                        tx.objectStore("__stashes").add({
                            id: crypto.randomUUID(),
                            type: "update",
                            timestamp: book.updatedAt,
                            value: item,
                        }),
                ]),
            ]);
            await tx.done;
            return { book, data };
        } catch (error) {
            await abortWrite(tx);
            throw error;
        } finally {
            db.close();
        }
    }
    async createBook(
        id: string,
        name: string,
        now: number,
        input: AccountingData = { accounts: [], transactions: [] },
    ): Promise<LoadedAccountingBook> {
        const data = validateAccountingData(input, now);
        const book = checkBook({
            id,
            name: name.trim(),
            revision: 0,
            createdAt: now,
            updatedAt: now,
        });
        return this.insertBook(book, data);
    }
    async saveBook(
        id: string,
        revision: number,
        input: AccountingData,
        now: number,
    ): Promise<LoadedAccountingBook> {
        const data = validateAccountingData(input, now);
        if (!Number.isSafeInteger(now) || now < 0)
            throw new Error("账本时间无效。");
        const db = await this.open(id);
        const tx = db.transaction(stores, "readwrite");
        try {
            const [config, previousMeta, previousItems, previousStashes] =
                await Promise.all([
                    tx.objectStore("__config").get("metaKey"),
                    tx.objectStore("__meta").get("metaKey"),
                    tx.objectStore("__items").getAll(),
                    tx.objectStore("__stashes").getAll(),
                ]);
            const previous = configBook(config?.value);
            if (previous.id !== id || previous.revision !== revision)
                throw new AccountingConflictError();
            const book = checkBook({
                ...previous,
                revision: revision + 1,
                updatedAt: Math.max(now, previous.updatedAt),
            });
            const meta = toAccountingMeta(data);
            const items = getRootTransactions(data.transactions).map((item) =>
                toAccountingItem(item),
            );
            // 比较已存树，覆盖调用方先行归一化或共享对象修改后丢失的变更证据。
            const oldNodes = new Map<string, AccountingItem>();
            const collect = (nodes: AccountingItem[]) => {
                for (const node of nodes) {
                    oldNodes.set(node.id, node);
                    collect(node.children ?? []);
                }
            };
            collect(previousItems);
            const domainNodes = new Map(
                data.transactions.map((item) => [item.id, item]),
            );
            const stampParents = (nodes: AccountingItem[]) => {
                for (const node of nodes) {
                    stampParents(node.children ?? []);
                    if (
                        !isEqual(
                            oldNodes.get(node.id)?.children ?? [],
                            node.children ?? [],
                        )
                    ) {
                        node.__update_at = Math.max(node.__update_at, now);
                        const domain = domainNodes.get(node.id);
                        if (domain) domain.updatedAt = node.__update_at;
                    }
                }
            };
            stampParents(items);
            const old = new Map(previousItems.map((item) => [item.id, item]));
            const ids = new Set(items.map((item) => item.id));
            const changed = items.filter(
                (item) => !isEqual(old.get(item.id), item),
            );
            const removed = previousItems.filter((item) => !ids.has(item.id));
            const metaChanged = !isEqual(previousMeta?.value, meta);
            const actions = createStashActions(
                {
                    items: previousItems,
                    meta: previousMeta?.value ?? { accounts: [] },
                },
                { items, meta },
                book.updatedAt,
            );
            const targets = new Set(actions.map(actionTarget));
            await writeAll([
                () =>
                    tx
                        .objectStore("__config")
                        .put(configRecord(book, config?.value.sync)),
                ...(metaChanged
                    ? [
                          () =>
                              tx
                                  .objectStore("__meta")
                                  .put({ id: "metaKey", value: meta }),
                      ]
                    : []),
                ...removed.map(
                    (item) => () => tx.objectStore("__items").delete(item.id),
                ),
                ...changed.map(
                    (item) => () => tx.objectStore("__items").put(item),
                ),
                // 与原版一样压缩同一目标的待同步日志；不改写其他交易的日志。
                ...previousStashes
                    .filter((action) => targets.has(actionTarget(action)))
                    .map(
                        (action) => () =>
                            tx.objectStore("__stashes").delete(action.id),
                    ),
                ...actions.map(
                    (action) => () => tx.objectStore("__stashes").add(action),
                ),
            ]);
            await tx.done;
            return {
                book,
                data,
                ...(config?.value.sync
                    ? {
                          remoteId: config.value.sync.remoteId,
                          remoteProvider:
                              config.value.sync.provider ?? "github",
                          pendingSync:
                              previousStashes.length > 0 || actions.length > 0,
                      }
                    : {}),
            };
        } catch (error) {
            await abortWrite(tx);
            throw error;
        } finally {
            db.close();
        }
    }

    async getSyncSnapshot(id: string): Promise<AccountingSyncSnapshot> {
        const db = await this.open(id);
        try {
            const tx = db.transaction(stores, "readonly");
            const [config, meta, items, actions] = await Promise.all([
                tx.objectStore("__config").get("metaKey"),
                tx.objectStore("__meta").get("metaKey"),
                tx.objectStore("__items").getAll(),
                tx.objectStore("__stashes").getAll(),
            ]);
            await tx.done;
            const book = configBook(config?.value);
            if (!meta || book.id !== id)
                throw new Error("Missing accounting sync metadata");
            return {
                book,
                current: { items, meta: meta.value },
                actions,
                ...(config?.value.sync ? { sync: config.value.sync } : {}),
            };
        } finally {
            db.close();
        }
    }

    async linkRemote(
        snapshot: AccountingSyncSnapshot,
        remoteId: string,
        baseline: AccountingSnapshot,
        provider?: string,
    ) {
        const db = await this.open(snapshot.book.id);
        const tx = db.transaction(stores, "readwrite");
        try {
            const config = (await tx.objectStore("__config").get("metaKey"))
                ?.value;
            const book = configBook(config);
            if (book.revision !== snapshot.book.revision || config?.sync)
                throw new AccountingConflictError();
            await tx.objectStore("__config").put(
                configRecord(book, {
                    remoteId,
                    ...(provider ? { provider } : {}),
                    baseline,
                    generation: crypto.randomUUID(),
                }),
            );
            await tx.done;
        } catch (error) {
            await abortWrite(tx);
            throw error;
        } finally {
            db.close();
        }
    }

    /** 上传后在同一事务内确认快照，期间的本地写入再次三方合并，不丢弃新增日志。 */
    async completeSync(
        snapshot: AccountingSyncSnapshot,
        remoteId: string,
        remote: AccountingSnapshot,
        now: number,
    ): Promise<LoadedAccountingBook> {
        const db = await this.open(snapshot.book.id);
        const tx = db.transaction(stores, "readwrite");
        try {
            const [config, meta, items] = await Promise.all([
                tx.objectStore("__config").get("metaKey"),
                tx.objectStore("__meta").get("metaKey"),
                tx.objectStore("__items").getAll(),
            ]);
            const previous = configBook(config?.value);
            if (
                !meta ||
                previous.id !== snapshot.book.id ||
                config?.value.sync?.generation !== snapshot.sync?.generation
            )
                throw new AccountingConflictError();
            const merged = mergeStashSnapshots(
                snapshot.current,
                { items, meta: meta.value },
                remote,
            );
            const data = validateAccountingData(
                fromAccountingRecords(merged.meta, merged.items),
            );
            const canonical = {
                meta: toAccountingMeta(data),
                items: getRootTransactions(data.transactions).map(
                    toAccountingItem,
                ),
            };
            const pending = createStashActions(remote, canonical, now);
            const book = checkBook({
                ...previous,
                revision: previous.revision + 1,
                updatedAt: Math.max(now, previous.updatedAt),
            });
            const sync = {
                remoteId,
                ...(snapshot.sync?.provider
                    ? { provider: snapshot.sync.provider }
                    : {}),
                baseline: remote,
                generation: crypto.randomUUID(),
            };
            await tx.objectStore("__items").clear();
            await tx.objectStore("__stashes").clear();
            await writeAll([
                () => tx.objectStore("__config").put(configRecord(book, sync)),
                () =>
                    tx
                        .objectStore("__meta")
                        .put({ id: "metaKey", value: canonical.meta }),
                ...canonical.items.map(
                    (item) => () => tx.objectStore("__items").put(item),
                ),
                ...pending.map(
                    (action) => () => tx.objectStore("__stashes").add(action),
                ),
            ]);
            await tx.done;
            return {
                book,
                data,
                remoteId,
                remoteProvider: sync.provider ?? "github",
                pendingSync: pending.length > 0,
            };
        } catch (error) {
            await abortWrite(tx);
            throw error;
        } finally {
            db.close();
        }
    }
}

export const accountingRepository = new IndexedDBAccountingRepository();
