import { importSyncFiles } from "../files/import";
import {
    assertManifestAdvance,
    readChunkFile,
    readManifest,
} from "../files/remote";
import type { SyncFile } from "../files/types";
import { chunkKey, chunkStart, publishedSeq } from "../store/entry";
import type { IndexedDBStore } from "../store/runtime";
import {
    type Manifest,
    type PendingSnapshot,
    type RemoteTransport,
    SyncError,
} from "../types";
import { assert, canonical } from "../utils/codec";
export async function readUploadBaseFiles(
    remote: RemoteTransport,
    manifest: Manifest,
    snapshot: PendingSnapshot,
) {
    const touched = new Set(
        snapshot.records.map((entry) =>
            chunkKey({
                writerId: snapshot.writerId,
                fromSeq: chunkStart(entry._sync.writerSeq),
            }),
        ),
    );
    const files: SyncFile[] = [];
    for (const ref of manifest.files)
        if (touched.has(chunkKey(ref)))
            files.push({
                file: ref.file,
                bytes: await readChunkFile(remote, ref),
            });
    return files;
}
export async function importFromRemote(
    store: IndexedDBStore,
    remote: RemoteTransport,
) {
    for (let attempt = 0; attempt < 8; attempt++) {
        const manifest = await readManifest(remote);
        const state = await store.getState();
        assertManifestAdvance(state.manifest, manifest.value);
        if (manifest.value.repoSeq < state.repoSeq)
            throw new SyncError(
                "REMOTE_HISTORY_LOST",
                "Repository progress is behind confirmed local progress",
            );
        const own = publishedSeq(manifest.value, state.writerId),
            lower = publishedSeq(state.manifest, state.writerId);
        assert(
            own <= state.writerSeq,
            "Writer identity reused by another database",
        );
        if (own > lower)
            assert(
                state.publication &&
                    state.publication.writerSeq === own &&
                    state.publication.files.every((ref) =>
                        manifest.value.files.some(
                            (current) => canonical(current) === canonical(ref),
                        ),
                    ),
                "Writer identity reused or publication receipt does not match",
            );
        const files: SyncFile[] = [];
        try {
            for (const ref of manifest.value.files)
                if (ref.repoSeq > state.repoSeq)
                    files.push({
                        file: ref.file,
                        bytes: await readChunkFile(remote, ref),
                    });
            await importSyncFiles(store, manifest.value, files);
        } catch (error) {
            if (
                error instanceof SyncError &&
                ["STALE_FILE", "HASH_MISMATCH"].includes(error.code)
            ) {
                const latest = await readManifest(remote);
                if (canonical(latest.value) !== canonical(manifest.value))
                    continue;
            }
            throw error;
        }
        return manifest;
    }
    throw new SyncError(
        "REMOTE_BUSY",
        "Repository changed repeatedly while downloading; retry later",
    );
}
