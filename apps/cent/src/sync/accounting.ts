import {
    type Change,
    createSyncSDK,
    type QueryCursor,
    type RemoteBinding,
    type RemoteTransport,
    type StateVersion,
    type StoredRecord,
    SyncError,
    type SyncOptions,
    sameStateVersion,
    stateVersion,
} from "@glink25/sync-sdk";
import { isEqual } from "lodash-es";
import {
    type AccountingBook,
    AccountingConflictError,
    type LoadedAccountingBook,
} from "../database/accounting";
import {
    type AccountingItem,
    type AccountingMeta,
    fromFlatAccountingRecords,
    toAccountingItem,
    toAccountingMeta,
} from "../database/accounting-record";
import { Scheduler } from "../database/scheduler";
import {
    type AccountingData,
    validateAccountingData,
} from "../ledger/accounting";
import { isBookFolder } from "./book-folder";
import { readLedgerPage } from "./book-page";
import {
    ledgerRecordChanges,
    ledgerValue,
    projectLedgerRecords,
} from "./records";
export const ACCOUNTING_DATABASE_PREFIX = "cent/";
/** Stable short key, with the full identity still checked by syncState binding. */
async function remoteBookId(identity: string) {
    const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(identity),
    );
    return Array.from(new Uint8Array(digest).subarray(0, 8), (byte) =>
        byte.toString(16).padStart(2, "0"),
    ).join("");
}
const BOOK = "book";
const META = "meta";
const LEDGER = "ledger";
interface BookInfo {
    format: "cent-accounting-causal";
    version: 3;
    amountScale: 10000;
    name: string;
    createdAt: number;
}
interface AccountingRemote {
    provider?: "webdav" | "github";
    identity: string;
    transport(id: string): RemoteTransport;
    list(): Promise<string[]>;
    createBookFolder?(name: string): Promise<string>;
}
const matchesRemote = (
    binding: RemoteBinding | undefined,
    target: AccountingRemote,
) =>
    !!binding?.path &&
    binding.identity === target.transport(binding.path).identity;
export class AccountingSyncConflictError extends Error {
    readonly bookId: string;
    readonly records: StoredRecord[];
    readonly version: StateVersion;
    constructor(
        bookId: string,
        records: StoredRecord[],
        version: StateVersion,
    ) {
        super(
            "账本存在并发修改，请逐项选择保留的完整版本。解决前暂停显示账单和统计。",
        );
        this.name = "AccountingSyncConflictError";
        this.bookId = bookId;
        this.records = records;
        this.version = stateVersion(version);
    }
}
export class AccountingProjectionError extends Error {
    constructor(message: string) {
        super(
            `同步后的账本未通过完整业务校验，已暂停显示账单和统计：${message}`,
        );
        this.name = "AccountingProjectionError";
    }
}
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const put = (collection: string, recordId: string, value: unknown): Change => ({
    type: "put",
    collection,
    recordId,
    value: json(
        collection === LEDGER ? ledgerValue(value as AccountingItem) : value,
    ),
});
const infoOf = (record: StoredRecord | undefined): BookInfo => {
    const info = record?.value as BookInfo | undefined;
    if (
        !info ||
        info.format !== "cent-accounting-causal" ||
        info.version !== 3 ||
        info.amountScale !== 10000 ||
        !info.name?.trim() ||
        !Number.isSafeInteger(info.createdAt) ||
        info.createdAt < 0
    )
        throw new Error("账本格式无效或不受支持。");
    return info;
};
const dataOf = (records: StoredRecord[]): AccountingData => {
    try {
        const meta = records.find(
            (r) => r.collection === META && r.id === "info",
        )?.value as AccountingMeta | undefined;
        if (!meta) throw new Error("账本元数据缺失。");
        return validateAccountingData(
            fromFlatAccountingRecords(meta, projectLedgerRecords(records)),
        );
    } catch (error) {
        throw new AccountingProjectionError(
            error instanceof Error ? error.message : "账本数据无效",
        );
    }
};
/** Each transaction is independent and parents also hold complete subtree snapshots. */
export function createAccountingBooks(
    options: {
        prefix?: string;
        sdk?: Omit<SyncOptions, "remote">;
        autoSync?: boolean;
    } = {},
) {
    const prefix = options.prefix ?? ACCOUNTING_DATABASE_PREFIX;
    const handles = new Map<string, ReturnType<typeof createSyncSDK>>();
    const listeners = new Set<
        (event: {
            bookId: string;
            source: "local" | "sync" | "external";
        }) => void | Promise<void>
    >();
    const jobs = new Map<string, Promise<LoadedAccountingBook>>();
    let remote: AccountingRemote | undefined;
    let syncError: unknown;
    const name = (id: string) => `${prefix}${encodeURIComponent(id)}`;
    const handle = (id: string): ReturnType<typeof createSyncSDK> => {
        let sdk = handles.get(id);
        if (!sdk) {
            sdk = createSyncSDK({
                ...options.sdk,
                databaseName: name(id),
                name: async () =>
                    infoOf(await handle(id).store.get(BOOK, "info")).name,
            });
            handles.set(id, sdk);
            sdk.onChange(({ source }) => {
                // One refresh after the complete sync, rather than one per imported file.
                if (source === "remote" && jobs.has(id)) return;
                notify(id, source === "remote" ? "sync" : source);
            });
        }
        return sdk;
    };
    const notify = (bookId: string, source: "local" | "sync" | "external") => {
        for (const listener of listeners) {
            try {
                void Promise.resolve(listener({ bookId, source })).catch(
                    () => {},
                );
            } catch {}
        }
    };
    const read = async (id: string): Promise<LoadedAccountingBook> => {
        const sdk = handle(id);
        const { state, records } = await sdk.store.snapshot();
        const conflicts = records.filter((r) => r._sync.conflicted);
        if (conflicts.length)
            throw new AccountingSyncConflictError(
                id,
                conflicts,
                stateVersion(state),
            );
        const info = infoOf(
            records.find((r) => r.collection === BOOK && r.id === "info"),
        );
        const data = dataOf(records);
        const updatedAt = await sdk.config.get<number>("updatedAt");
        return {
            book: {
                id,
                name: info.name,
                version: stateVersion(state),
                createdAt: info.createdAt,
                updatedAt: Math.max(
                    info.createdAt,
                    updatedAt ?? info.createdAt,
                ),
            },
            data,
            ...(state.remote?.path
                ? {
                      remoteId: state.remote.path,
                      remoteProvider: state.remote.provider,
                  }
                : {}),
            pendingSync: records.some((r) => r._sync.dirty),
        };
    };
    const seed = async (book: AccountingBook, input: AccountingData) => {
        const data = validateAccountingData(input);
        const sdk = handle(book.id);
        const items = data.transactions.map((t) =>
            put(LEDGER, t.id, toAccountingItem(t)),
        );
        const changes = [
            put(BOOK, "info", {
                format: "cent-accounting-causal",
                version: 3,
                amountScale: 10000,
                name: book.name,
                createdAt: book.createdAt,
            } satisfies BookInfo),
            put(META, "info", toAccountingMeta(data)),
            ...items,
        ];
        await sdk.store.batch(changes, {
            expectedVersion: { writerSeq: 0, repoSeq: 0 },
            local: [
                {
                    key: "updatedAt",
                    value: book.updatedAt,
                },
            ],
        });
        return read(book.id);
    };
    const openBook = async (id: string) => {
        if (!(await handle(id).store.get(BOOK, "info")))
            throw new Error("找不到账本。");
        return read(id);
    };
    const listBooks = async () => {
        const result = new Map<string, AccountingBook>();
        for (const db of await indexedDB.databases())
            if (db.name?.startsWith(prefix)) {
                const id = decodeURIComponent(db.name.slice(prefix.length));
                const sdk = handle(id);
                const record = await sdk.store.get(BOOK, "info");
                if (!record) continue;
                // Keep conflicted books discoverable so the user can resolve them.
                const value =
                    record?.value ??
                    record?._sync.versions.find(
                        (version) => version.value !== null,
                    )?.value;
                const info = infoOf({ ...record, value } as StoredRecord);
                result.set(id, {
                    id,
                    name: info.name,
                    version: stateVersion(await sdk.config.getState()),
                    createdAt: info.createdAt,
                    updatedAt: Math.max(
                        info.createdAt,
                        (await sdk.config.get<number>("updatedAt")) ??
                            info.createdAt,
                    ),
                });
            }
        return [...result.values()].sort(
            (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
        );
    };
    const sync = (id: string, _remoteId?: string, signal?: AbortSignal) => {
        const existing = jobs.get(id);
        if (existing) return existing;
        const job = (async () => {
            signal?.throwIfAborted();
            const sdk = handle(id);
            const target = remote;
            const binding = (await sdk.config.getState()).remote;
            if (!target || !binding?.path)
                throw new Error("请先发布账本到已配置的同步服务。");
            if (!matchesRemote(binding, target))
                throw new Error(
                    "当前账本关联到另一个同步位置，请切换回原服务和目录。",
                );
            sdk.sync.setRemote(target.transport(binding.path));
            try {
                await sdk.sync.sync();
                syncError = undefined;
            } catch (error) {
                if (
                    error instanceof SyncError &&
                    error.code === "RECORD_CONFLICT"
                ) {
                    const { state, records } = await sdk.store.snapshot();
                    error = new AccountingSyncConflictError(
                        id,
                        records.filter((r) => r._sync.conflicted),
                        stateVersion(state),
                    );
                }
                syncError = error;
                throw error;
            }
            signal?.throwIfAborted();
            return read(id);
        })().finally(() => {
            jobs.delete(id);
            notify(id, "sync");
        });
        jobs.set(id, job);
        return job;
    };
    const syncAll = async (signal?: AbortSignal) => {
        if (
            !remote ||
            (typeof navigator !== "undefined" && navigator.onLine === false)
        )
            return;
        for (const book of await listBooks()) {
            signal?.throwIfAborted();
            const binding = (await handle(book.id).config.getState()).remote;
            if (matchesRemote(binding, remote))
                await sync(book.id, undefined, signal);
        }
    };
    const scheduler = new Scheduler(syncAll, 1000);
    scheduler.onProcess((job) => {
        void job.catch((error) => {
            syncError = error;
        });
    });
    const changed = (book: LoadedAccountingBook) => {
        if (
            options.autoSync &&
            remote &&
            book.remoteId &&
            !(typeof navigator !== "undefined" && navigator.onLine === false)
        )
            void scheduler.schedule().catch(() => {});
        return book;
    };
    return {
        listBooks,
        openBook,
        async readBookPage(id: string, cursor?: QueryCursor) {
            const sdk = handle(id);
            const state = await sdk.config.getState();
            const [record, meta, updatedAt] = await Promise.all([
                sdk.store.get(BOOK, "info"),
                sdk.store.get<AccountingMeta>(META, "info"),
                sdk.config.get<number>("updatedAt"),
            ]);
            const info = infoOf(record);
            if (!meta?.value) throw new Error("账本元数据缺失。");
            return readLedgerPage(
                sdk,
                {
                    id,
                    name: info.name,
                    version: stateVersion(state),
                    createdAt: info.createdAt,
                    updatedAt: Math.max(
                        info.createdAt,
                        updatedAt ?? info.createdAt,
                    ),
                },
                meta.value,
                cursor,
            );
        },
        sync,
        syncAll,
        get provider() {
            return remote ? (remote.provider ?? "webdav") : undefined;
        },
        get syncError() {
            return syncError;
        },
        setRemote(value?: AccountingRemote) {
            remote = value;
        },
        async createBook(
            id: string,
            bookName: string,
            now: number,
            data: AccountingData = { accounts: [], transactions: [] },
        ) {
            if (
                !id ||
                !bookName.trim() ||
                !Number.isSafeInteger(now) ||
                now < 0
            )
                throw new Error("账本 ID、名称或时间无效。");
            if ((await listBooks()).some((b) => b.id === id))
                throw new DOMException("账本已存在。", "ConstraintError");
            return changed(
                await seed(
                    {
                        id,
                        name: bookName.trim(),
                        createdAt: now,
                        updatedAt: now,
                        version: { writerSeq: 0, repoSeq: 0 },
                    },
                    data,
                ),
            );
        },
        async saveBook(
            id: string,
            version: StateVersion,
            input: AccountingData,
            now: number,
        ) {
            version = stateVersion(version);
            if (!Number.isSafeInteger(now) || now < 0)
                throw new Error("账本时间无效。");
            const previous = await openBook(id);
            if (!sameStateVersion(previous.book.version, version))
                throw new AccountingConflictError();
            const data = validateAccountingData(input, now);
            const sdk = handle(id);
            const snapshot = await sdk.store.snapshot();
            if (!sameStateVersion(snapshot.state, version))
                throw new AccountingConflictError();
            const changes: Change[] = [];
            const meta = json(toAccountingMeta(data));
            if (!isEqual(json(toAccountingMeta(previous.data)), meta))
                changes.push(put(META, "info", meta));
            changes.push(
                ...ledgerRecordChanges(snapshot.records, data.transactions),
            );
            await sdk.store.batch(changes, {
                expectedVersion: version,
                local: [
                    {
                        key: "updatedAt",
                        value: Math.max(now, previous.book.updatedAt),
                    },
                ],
            });
            return changed(await read(id));
        },
        async publishBook(id: string) {
            const target = remote;
            if (!target)
                throw new Error(
                    "请先配置 WebDAV 或 GitHub 同步；本地账本已保存。",
                );
            const book = await openBook(id);
            const sdk = handle(id);
            const bind = (path: string) =>
                sdk.config.bindRemote((current) => {
                    if (current) return current;
                    return {
                        identity: target.transport(path).identity,
                        path,
                        provider: target.provider ?? "webdav",
                    };
                });
            let binding: RemoteBinding;
            if (target.createBookFolder) {
                const reserve = async () => {
                    const existing = (await sdk.config.getState()).remote;
                    if (existing) return existing;
                    return bind(await target.createBookFolder!(book.book.name));
                };
                // Reserve once across tabs before persisting the immutable binding.
                const key = `book-bind:${sdk.store.name}`;
                if (options.sdk?.lock)
                    binding = await options.sdk.lock(key, reserve);
                else if (typeof navigator !== "undefined" && navigator.locks)
                    binding = await navigator.locks.request(key, reserve);
                else
                    throw new SyncError(
                        "CAPABILITY",
                        "Web Locks are required to create a remote book",
                    );
            } else binding = await bind(crypto.randomUUID());
            if (!matchesRemote(binding, target))
                throw new Error(
                    "当前账本关联到另一个同步位置，请切换回原服务和目录。",
                );
            return sync(id);
        },
        async importBook(remoteId: string) {
            const target = remote;
            if (!target) throw new Error("请先配置 WebDAV 或 GitHub 同步。");
            if (!isBookFolder(remoteId)) throw new Error("远端账本 ID 无效。");
            const transport = target.transport(remoteId);
            for (const b of await listBooks()) {
                const binding = (await handle(b.id).config.getState()).remote;
                if (
                    binding?.path === remoteId &&
                    matchesRemote(binding, target)
                )
                    return changed(await openBook(b.id));
            }
            // Deterministic local ID avoids duplicate imports racing in separate tabs.
            const id = await remoteBookId(transport.identity);
            const sdk = handle(id);
            await sdk.config.bindRemote({
                identity: transport.identity,
                path: remoteId,
                provider: target.provider ?? "webdav",
            });
            sdk.sync.setRemote(transport);
            await sdk.sync.pull();
            const info = infoOf(await sdk.store.get(BOOK, "info"));
            await sdk.store.batch([], {
                local: [
                    {
                        key: "updatedAt",
                        value: info.createdAt,
                    },
                ],
            });
            return read(id);
        },
        async fetchRemoteBooks() {
            if (!remote) return [];
            const result = [];
            for (const id of await remote.list()) {
                const file = await remote.transport(id).read("manifest.json");
                // A directory can exist before its first publication.
                if (!file) continue;
                const manifest = JSON.parse(
                    new TextDecoder("utf-8", { fatal: true }).decode(
                        file.bytes,
                    ),
                );
                if (
                    !manifest ||
                    manifest.format !== "record-repo" ||
                    manifest.version !== 4 ||
                    !Number.isSafeInteger(manifest.repoSeq) ||
                    manifest.repoSeq < 0 ||
                    !Array.isArray(manifest.files) ||
                    (manifest.name !== undefined &&
                        (typeof manifest.name !== "string" ||
                            !manifest.name.trim()))
                )
                    throw new Error("远端账本的 Manifest 格式无效。");
                result.push({ id, name: manifest.name?.trim() ?? id });
            }
            return result;
        },
        async getIsNeedSync() {
            if (!remote) return false;
            for (const b of await listBooks()) {
                const sdk = handle(b.id);
                const binding = (await sdk.config.getState()).remote;
                if (
                    matchesRemote(binding, remote) &&
                    (await sdk.sync.getStatus()).dirty
                )
                    return true;
            }
            return false;
        },
        async getConflicts(id: string) {
            const snapshot = await handle(id).store.snapshot();
            return {
                records: snapshot.records.filter((r) => r._sync.conflicted),
                version: stateVersion(snapshot.state),
            };
        },
        async resolveConflict(
            id: string,
            record: StoredRecord,
            choice:
                | {
                      type: "put";
                      value: unknown;
                  }
                | {
                      type: "delete";
                  },
            version: StateVersion,
        ) {
            version = stateVersion(version);
            const sdk = handle(id);
            const snapshot = await sdk.store.snapshot();
            if (!sameStateVersion(snapshot.state, version))
                throw new AccountingConflictError();
            const chosen: Change =
                choice.type === "put"
                    ? put(record.collection, record.id, choice.value)
                    : {
                          type: "delete",
                          collection: record.collection,
                          recordId: record.id,
                      };
            const projected = snapshot.records.map((entry) =>
                entry.collection === record.collection && entry.id === record.id
                    ? {
                          ...entry,
                          value: chosen.type === "put" ? chosen.value : null,
                          _sync: {
                              ...entry._sync,
                              conflicted: false,
                              versions: [],
                          },
                      }
                    : entry,
            );
            const changes = new Map<string, Change>([
                [JSON.stringify([chosen.collection, chosen.recordId]), chosen],
            ]);
            // Keep unresolved versions explicit; rebuild all mirrors with the final choice.
            if (!projected.some((entry) => entry._sync.conflicted)) {
                const data = dataOf(projected);
                for (const change of ledgerRecordChanges(
                    snapshot.records,
                    data.transactions,
                )) {
                    changes.set(
                        JSON.stringify([change.collection, change.recordId]),
                        change,
                    );
                }
            }
            await sdk.store.batch([...changes.values()], {
                resolve: true,
                expectedVersion: version,
            });
        },
        getStore: (id: string) => handle(id).store,
        async closeBook(id: string) {
            await jobs.get(id)?.catch(() => {});
            const sdk = handles.get(id);
            if (sdk) {
                handles.delete(id);
                await sdk.close();
            }
        },
        onChange(
            listener: (event: {
                bookId: string;
                source: "local" | "sync" | "external";
            }) => void | Promise<void>,
        ) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
        onSync: (listener: (job: Promise<void>) => void) =>
            scheduler.onProcess(listener),
        scheduleSync: () => scheduler.schedule(),
    };
}
export const accountingBooks = createAccountingBooks({ autoSync: true });
export type AccountingBooks = typeof accountingBooks;
