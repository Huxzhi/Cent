import type {
    DataEntry,
    Manifest,
    RecordVersion,
    StoredRecord,
    SyncState,
} from "../types";
export const itemKey = (entry: Pick<DataEntry, "collection" | "id">) =>
    JSON.stringify([entry.collection, entry.id]);
export function toEntry<T>(
    collection: string,
    id: string,
    version: RecordVersion<T>,
): DataEntry<T> {
    const { value, writerId, writerSeq, repoSeq } = version;
    return structuredClone({
        collection,
        id,
        value,
        _sync: {
            writerId,
            writerSeq,
            repoSeq,
        },
    });
}
export function entryVersion<T>(entry: DataEntry<T>): RecordVersion<T> {
    const { writerId, writerSeq, repoSeq } = entry._sync;
    return { writerId, writerSeq, repoSeq, value: entry.value };
}
export const CHUNK_SIZE = 1000;
export const chunkStart = (seq: number) =>
    Math.floor((seq - 1) / CHUNK_SIZE) * CHUNK_SIZE + 1;
export const chunkKey = (ref: { writerId: string; fromSeq: number }) =>
    JSON.stringify([ref.writerId, ref.fromSeq]);
export function publishedSeq(manifest: Manifest | undefined, writerId: string) {
    let latest = 0;
    for (const ref of manifest?.files ?? [])
        if (ref.writerId === writerId) latest = Math.max(latest, ref.toSeq);
    return latest;
}
export function isPending(
    entry: DataEntry,
    state: Pick<SyncState, "writerId" | "manifest">,
) {
    return (
        entry._sync.writerId === state.writerId &&
        entry._sync.writerSeq > publishedSeq(state.manifest, state.writerId)
    );
}
export function projectEntry<T = unknown>(
    entry: DataEntry<T> | undefined,
    state: SyncState,
): StoredRecord<T> | undefined {
    if (!entry) return undefined;
    const meta = entry._sync;
    return {
        collection: entry.collection,
        id: entry.id,
        value: meta.conflict ? null : entry.value,
        _sync: {
            writerId: meta.writerId,
            writerSeq: meta.writerSeq,
            repoSeq: meta.repoSeq,
            dirty: isPending(entry, state),
            conflicted: !!meta.conflict,
            versions: meta.conflict
                ? structuredClone([entryVersion(entry), meta.conflict])
                : [],
        },
    };
}
/** Preserve record identity and payload, excluding local synchronization bookkeeping. */
export function wireEntry(entry: DataEntry): DataEntry {
    return toEntry(entry.collection, entry.id, entryVersion(entry));
}
