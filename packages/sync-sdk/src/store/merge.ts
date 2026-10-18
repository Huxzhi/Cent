import type { DataEntry, SyncState } from "../types";
import { entryVersion, isPending, toEntry } from "./entry";
/** Chunk rewrites preserve every row's actual publication version. */
export function mergeRecord(
    previous: DataEntry | undefined,
    incoming: DataEntry,
    state: SyncState,
): DataEntry {
    const remote = entryVersion(incoming);
    if (!previous) return toEntry(incoming.collection, incoming.id, remote);
    const meta = previous._sync;
    if (isPending(previous, state)) {
        if (
            remote.repoSeq <= meta.repoSeq ||
            remote.repoSeq <= (meta.conflict?.repoSeq ?? 0)
        )
            return previous;
        const next = structuredClone(previous);
        next._sync.conflict = remote;
        return next;
    }
    if (remote.repoSeq <= meta.repoSeq) return previous;
    return toEntry(previous.collection, previous.id, remote);
}
