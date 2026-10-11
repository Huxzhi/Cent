import { isEqual } from "lodash-es";
import type {
    AccountingSnapshot,
    IndexedDBAccountingRepository,
    LoadedAccountingBook,
} from "../database/accounting";
import type {
    AccountingItem,
    AccountingMeta,
} from "../database/accounting-record";
import {
    fromAccountingRecords,
    toAccountingItem,
    toAccountingMeta,
} from "../database/accounting-record";
import {
    createStashActions,
    type FullAction,
    mergeStashSnapshots,
    replayStashActions,
} from "../database/stash";
import {
    getRootTransactions,
    validateAccountingData,
} from "../ledger/accounting";
import type { Syncer } from ".";
import { RemoteVersionConflictError } from "./remote-conflict";

export const ACCOUNTING_REPO_PREFIX = "cent2-booking";
export const ACCOUNTING_ENTRY_NAME = "ledger";
export interface AccountingRemoteMeta {
    format: "cent-accounting-sync";
    schemaVersion: 1;
    amountScale: 10000;
    name: string;
    meta: AccountingMeta;
}
export const emptyAccountingRemoteMeta: AccountingRemoteMeta = {
    format: "cent-accounting-sync",
    schemaVersion: 1,
    amountScale: 10000,
    name: "",
    meta: { accounts: [] },
};
const emptySnapshot: AccountingSnapshot = { items: [], meta: { accounts: [] } };
function canonical(snapshot: AccountingSnapshot): AccountingSnapshot {
    const data = validateAccountingData(
        fromAccountingRecords(snapshot.meta, snapshot.items),
    );
    const meta = toAccountingMeta(data);
    if (snapshot.meta.timeZone === undefined) delete meta.timeZone;
    // 校验时填充的设备默认值不回写同步快照；时区只有显式修改时才同步。
    return {
        items: getRootTransactions(data.transactions).map(toAccountingItem),
        meta,
    };
}
function remoteHeader(value: unknown): AccountingRemoteMeta {
    const header = value as AccountingRemoteMeta;
    if (
        !header ||
        header.format !== "cent-accounting-sync" ||
        header.schemaVersion !== 1 ||
        header.amountScale !== 10000 ||
        typeof header.name !== "string" ||
        !header.meta ||
        !Array.isArray(header.meta.accounts)
    )
        throw new Error("Unsupported accounting sync format");
    return header;
}
function remoteActions(value: unknown): FullAction<AccountingItem>[] {
    if (!Array.isArray(value)) throw new Error("Invalid accounting sync chunk");
    for (const action of value) {
        if (
            !action ||
            typeof action.id !== "string" ||
            !Number.isSafeInteger(action.timestamp) ||
            action.timestamp < 0 ||
            !["update", "delete"].includes(action.type) ||
            (action.type === "delete"
                ? typeof action.value !== "string"
                : !action.value ||
                  typeof action.value.id !== "string" ||
                  action.value.parentTransactionId !== undefined)
        )
            throw new Error("Invalid accounting sync action");
    }
    return value;
}

/** 沿用 Tidal 的 meta.json 和分块操作日志，账务合并统一委托给 stash。 */
export function createAccountingSync(
    syncer: Syncer,
    repository: IndexedDBAccountingRepository,
    itemsPerChunk = 1000,
) {
    if (!Number.isSafeInteger(itemsPerChunk) || itemsPerChunk < 1)
        throw new Error("Invalid sync chunk size");
    const jobs = new Map<string, Promise<LoadedAccountingBook>>();
    const listeners = new Set<(args: { bookId: string }) => void>();
    const cachedFiles = new Map<
        string,
        Map<string, { sha: string; content: unknown }>
    >();
    const readRemote = async (remoteId: string, signal?: AbortSignal) => {
        if (!remoteId.split("/")[1]?.startsWith(`${ACCOUNTING_REPO_PREFIX}-`))
            throw new Error("Unsupported accounting repository");
        const structure = await syncer.fetchStructure(remoteId, signal);
        if (!structure.revision || !structure.meta.sha)
            throw new Error("Missing accounting remote version");
        const cache =
            cachedFiles.get(remoteId) ??
            new Map<string, { sha: string; content: unknown }>();
        const paths = [structure.meta, ...structure.chunks];
        const changed = paths.filter(
            (file) => cache.get(file.path)?.sha !== file.sha,
        );
        const fetched = changed.length
            ? await syncer.fetchContent(remoteId, changed, signal)
            : [];
        const files = paths.map((file) => {
            const incoming = fetched.find((item) => item.path === file.path);
            if (
                changed.some((item) => item.path === file.path) &&
                (!incoming || incoming.sha !== file.sha)
            )
                throw new Error("Missing accounting remote file");
            return {
                ...file,
                content: incoming
                    ? incoming.content
                    : cache.get(file.path)?.content,
            };
        });
        const header = remoteHeader(
            files.find((file) => file.path === structure.meta.path)?.content,
        );
        const actions = [...structure.chunks]
            .sort((a, b) => a.startIndex - b.startIndex)
            .flatMap((chunk) =>
                remoteActions(
                    files.find((file) => file.path === chunk.path)?.content,
                ),
            );
        const snapshot = canonical({
            items: replayStashActions(actions),
            meta: header.meta,
        });
        cachedFiles.set(
            remoteId,
            new Map(
                files.map((file) => [
                    file.path,
                    { sha: file.sha, content: structuredClone(file.content) },
                ]),
            ),
        );
        return { structure, header, actions, files, snapshot };
    };
    const synchronize = async (
        localId: string,
        remoteId?: string,
        signal?: AbortSignal,
    ) => {
        const local = await repository.getSyncSnapshot(localId);
        const target = remoteId ?? local.sync?.remoteId;
        if (!target || (local.sync && local.sync.remoteId !== target))
            throw new Error("Book is not linked to this repository");
        for (let attempt = 0; attempt < 3; attempt++) {
            signal?.throwIfAborted();
            const remote = await readRemote(target, signal);
            signal?.throwIfAborted();
            const merged = canonical(
                mergeStashSnapshots(
                    local.sync?.baseline ?? emptySnapshot,
                    local.current,
                    remote.snapshot,
                ),
            );
            const now = remote.actions.reduce(
                (time, action) => Math.max(time, action.timestamp + 1),
                Math.max(Date.now(), local.book.updatedAt),
            );
            const actions = createStashActions(
                remote.snapshot,
                merged,
                now,
            ).filter((action) => action.type !== "meta");
            const uploads: { path: string; content: any }[] = [];
            if (
                !isEqual(remote.snapshot.meta, merged.meta) ||
                !remote.header.name
            ) {
                uploads.push({
                    path: "meta.json",
                    content: {
                        ...remote.header,
                        name: remote.header.name || local.book.name,
                        meta: merged.meta,
                    },
                });
            }
            if (actions.length) {
                const latest = [...remote.structure.chunks]
                    .sort((a, b) => a.startIndex - b.startIndex)
                    .at(-1);
                const previous = latest
                    ? remoteActions(
                          remote.files.find((file) => file.path === latest.path)
                              ?.content,
                      )
                    : [];
                const combined = [...previous, ...actions];
                const offset = latest?.startIndex ?? 0;
                for (let i = 0; i < combined.length; i += itemsPerChunk)
                    uploads.push({
                        path: `${ACCOUNTING_ENTRY_NAME}-${offset + i}.json`,
                        content: combined.slice(i, i + itemsPerChunk),
                    });
            }
            try {
                if (uploads.length)
                    await syncer.uploadContent(
                        target,
                        uploads,
                        signal,
                        remote.structure.revision,
                    );
                signal?.throwIfAborted();
                const result = await repository.completeSync(
                    local,
                    target,
                    merged,
                    now,
                );
                listeners.forEach((listener) => listener({ bookId: localId }));
                return result;
            } catch (error) {
                if (
                    !(error instanceof RemoteVersionConflictError) ||
                    attempt === 2
                )
                    throw error;
            }
        }
        throw new RemoteVersionConflictError();
    };
    const syncBook = (
        localId: string,
        remoteId?: string,
        signal?: AbortSignal,
    ) => {
        const existing = jobs.get(localId);
        if (existing) return existing;
        const job = synchronize(localId, remoteId, signal).finally(() =>
            jobs.delete(localId),
        );
        jobs.set(localId, job);
        return job;
    };
    return {
        syncBook,
        publishBook: async (localId: string) => {
            const local = await repository.getSyncSnapshot(localId);
            if (local.sync) return syncBook(localId);
            const remote = await syncer.createStore(crypto.randomUUID());
            // 先保存关联；首次上传失败也能重试原仓库，不重复创建。
            await repository.linkRemote(local, remote.id, emptySnapshot);
            return syncBook(localId);
        },
        importBook: async (remoteId: string) => {
            for (const book of await repository.listBooks()) {
                const local = await repository.loadBook(book.id);
                if (local.remoteId === remoteId) return syncBook(book.id);
            }
            const remote = await readRemote(remoteId);
            const id = crypto.randomUUID();
            await repository.createBook(
                id,
                remote.header.name || remoteId,
                Date.now(),
                fromAccountingRecords(
                    remote.snapshot.meta,
                    remote.snapshot.items,
                ),
            );
            const local = await repository.getSyncSnapshot(id);
            await repository.linkRemote(local, remoteId, remote.snapshot);
            return syncBook(id);
        },
        fetchAllBooks: async () =>
            Promise.all(
                (await syncer.fetchAllStore()).map(async (id) => {
                    const remote = await readRemote(id);
                    return { id, name: remote.header.name || id };
                }),
            ),
        onChange: (listener: (args: { bookId: string }) => void) => {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },
    };
}
