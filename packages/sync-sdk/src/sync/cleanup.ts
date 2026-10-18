import { readManifest, saveManifest } from "../files/remote";
import { type RemoteTransport, SyncError } from "../types";
import { assert, hash } from "../utils/codec";
export const DEFAULT_RETENTION_MS = 24 * 60 * 60 * 1000;
/** Retired objects cannot become current again: publication always creates new hash paths. */
export async function cleanupRemote(
    remote: RemoteTransport,
    retentionMs = DEFAULT_RETENTION_MS,
    now = Date.now(),
) {
    if (!remote.remove) return { supported: false, deleted: 0, remaining: 0 };
    const current = await readManifest(remote);
    const live = new Set(current.value.files.map((ref) => ref.file));
    const eligible = current.value.retired
        .filter((ref) => now - ref.retiredAt >= retentionMs)
        .slice(0, 32);
    const removed = new Set<string>();
    for (const ref of eligible) {
        assert(!live.has(ref.file), "Cannot delete a live chunk");
        const file = await remote.read(ref.file);
        if (file) {
            assert(
                (await hash(file.bytes)) === ref.hash,
                "Retired file hash mismatch",
            );
            await remote.remove(ref.file, { etag: file.etag });
        }
        removed.add(ref.file);
    }
    let remaining = current.value.retired.length - removed.size;
    if (removed.size) {
        try {
            await saveManifest(
                remote,
                {
                    ...current.value,
                    retired: current.value.retired.filter(
                        (ref) => !removed.has(ref.file),
                    ),
                },
                current.etag,
            );
        } catch (error) {
            if (!(error instanceof SyncError) || error.code !== "PRECONDITION")
                throw error;
            remaining = (await readManifest(remote)).value.retired.length;
        }
    }
    return {
        supported: true,
        deleted: removed.size,
        remaining,
    };
}
