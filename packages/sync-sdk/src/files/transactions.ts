import type { RecordChanges } from "../store/changes";
import type { DatabaseConnection } from "../store/database";
import {
    chunkKey,
    entryVersion,
    itemKey,
    publishedSeq,
    toEntry,
} from "../store/entry";
import { mergeRecord } from "../store/merge";
import { validateBatch } from "../store/validation";
import {
    type Manifest,
    type PendingSnapshot,
    type Publication,
    type RecordBatch,
    SyncError,
    type SyncState,
} from "../types";
import { assert, canonical } from "../utils/codec";
import { stateVersion } from "../utils/version";
import { assertManifestAdvance, validateManifest } from "./remote";
export async function exportPending(
    connection: DatabaseConnection,
    manifest?: Manifest,
): Promise<PendingSnapshot> {
    const tx = (await connection.db).transaction(["records", "config"]);
    const state = (await tx
        .objectStore("config")
        .get("syncState")) as SyncState;
    if (manifest) {
        validateManifest(manifest);
        assert(
            manifest.repoSeq === state.repoSeq &&
                publishedSeq(manifest, state.writerId) ===
                    publishedSeq(state.manifest, state.writerId),
            "Manifest has not been completely imported",
        );
    }
    const fromSeq = publishedSeq(manifest ?? state.manifest, state.writerId);
    const records =
        state.writerSeq > fromSeq
            ? await tx
                  .objectStore("records")
                  .index("writer")
                  .getAll(
                      IDBKeyRange.bound(
                          [state.writerId, fromSeq + 1],
                          [state.writerId, state.writerSeq],
                      ),
                  )
            : [];
    await tx.done;
    if (records.some((entry) => entry._sync.conflict))
        throw new SyncError(
            "RECORD_CONFLICT",
            "Resolve concurrent changes before uploading",
        );
    return {
        writerId: state.writerId,
        writerSeq: state.writerSeq,
        repoSeq: state.repoSeq,
        records,
    };
}

export async function savePublication(
    connection: DatabaseConnection,
    input: Publication,
): Promise<Publication> {
    const publication = structuredClone(input);
    const tx = (await connection.db).transaction("config", "readwrite");
    try {
        const state = (await tx.store.get("syncState")) as SyncState;
        assert(
            publication.writerId === state.writerId &&
                publication.writerSeq >
                    publishedSeq(state.manifest, state.writerId) &&
                publication.writerSeq <= state.writerSeq &&
                publication.repoSeq === state.repoSeq + 1 &&
                publication.files.length > 0 &&
                publication.files.every(
                    (ref) =>
                        ref.writerId === publication.writerId &&
                        ref.repoSeq === publication.repoSeq,
                ),
            "Stale publication plan",
        );
        state.publication = publication;
        await tx.store.put(state);
        await tx.done;
        return publication;
    } catch (error) {
        try {
            tx.abort();
        } catch {}
        await tx.done.catch(() => {});
        throw error;
    }
}
/** All changed chunks, own-publication recovery and the manifest cursor commit together. */
export async function importManifest(
    connection: DatabaseConnection,
    notifications: RecordChanges,
    manifest: Manifest,
    batches: RecordBatch[],
) {
    validateManifest(manifest);
    const refs = new Map(manifest.files.map((ref) => [chunkKey(ref), ref]));
    const loaded = new Map<string, RecordBatch>();
    for (const batch of batches) {
        validateBatch(batch);
        const ref = refs.get(chunkKey(batch));
        assert(
            ref &&
                ref.toSeq === batch.toSeq &&
                ref.repoSeq === batch.repoSeq &&
                !loaded.has(chunkKey(batch)),
            "Chunk does not match manifest",
        );
        loaded.set(chunkKey(batch), batch);
    }
    const tx = (await connection.db).transaction(
        ["records", "config"],
        "readwrite",
    );
    try {
        const state = (await tx
            .objectStore("config")
            .get("syncState")) as SyncState;
        assertManifestAdvance(state.manifest, manifest);
        assert(
            manifest.repoSeq >= state.repoSeq,
            "Repository progress regressed",
        );
        if (manifest.repoSeq === state.repoSeq) {
            // Names and garbage metadata can change without a data publication.
            // Do not cache the unnamed virtual manifest returned for a missing file.
            if (
                manifest.name !== undefined &&
                canonical(state.manifest ?? null) !== canonical(manifest)
            ) {
                state.manifest = structuredClone(manifest);
                await tx.objectStore("config").put(state);
            }
            await tx.done;
            return;
        }
        const lower = publishedSeq(state.manifest, state.writerId);
        const own = publishedSeq(manifest, state.writerId);
        assert(
            own <= state.writerSeq,
            "Writer identity reused by another database",
        );
        const publication = state.publication;
        const store = tx.objectStore("records");
        const changed = new Map<string, { collection: string; id: string }>();
        const mark = (entry: { collection: string; id: string }) =>
            changed.set(itemKey(entry), {
                collection: entry.collection,
                id: entry.id,
            });
        for (const ref of manifest.files)
            if (ref.repoSeq > state.repoSeq)
                assert(
                    loaded.has(chunkKey(ref)),
                    "Manifest is missing a changed chunk",
                );
        if (own > lower) {
            assert(
                publication &&
                    publication.writerId === state.writerId &&
                    publication.writerSeq === own &&
                    publication.files.every(
                        (ref) =>
                            canonical(refs.get(chunkKey(ref))) ===
                            canonical(ref),
                    ),
                "Writer identity reused or publication receipt does not match",
            );
            const uploaded = new Map(
                batches
                    .flatMap((batch) => batch.records)
                    .filter(
                        (entry) =>
                            entry._sync.writerId === state.writerId &&
                            entry._sync.writerSeq > lower &&
                            entry._sync.writerSeq <= own &&
                            entry._sync.repoSeq === publication.repoSeq,
                    )
                    .map((entry) => [itemKey(entry), entry]),
            );
            const pending = await store
                .index("writer")
                .getAll(
                    IDBKeyRange.bound(
                        [state.writerId, lower + 1],
                        [state.writerId, state.writerSeq],
                    ),
                );
            for (const entry of pending) {
                const remote = uploaded.get(itemKey(entry));
                if (entry._sync.writerSeq <= own) {
                    assert(
                        remote &&
                            remote._sync.writerSeq === entry._sync.writerSeq,
                        "Publication omitted a captured local record",
                    );
                    await store.put(
                        toEntry(
                            entry.collection,
                            entry.id,
                            entryVersion(remote),
                        ),
                    );
                    mark(entry);
                } else if (remote) {
                    entry._sync.repoSeq = publication.repoSeq;
                    await store.put(entry);
                    mark(entry);
                }
            }
            delete state.publication;
        }
        const oldRepoSeq = state.repoSeq;
        // Offline pending classification may now observe this device's recovered publication.
        state.manifest = structuredClone(manifest);
        const entries = batches
            .flatMap((batch) => batch.records)
            .filter((entry) => entry._sync.repoSeq > oldRepoSeq)
            .sort(
                (a, b) =>
                    a._sync.repoSeq - b._sync.repoSeq ||
                    a._sync.writerSeq - b._sync.writerSeq,
            );
        for (const entry of entries) {
            const old = await store.get([entry.collection, entry.id]);
            const merged = mergeRecord(old, entry, state);
            if (merged !== old) {
                await store.put(merged);
                mark(entry);
            }
        }
        state.repoSeq = manifest.repoSeq;
        await tx.objectStore("config").put(state);
        await tx.done;
        notifications.emit(
            own > lower ? "local" : "remote",
            [...changed.values()],
            stateVersion(state),
        );
    } catch (error) {
        try {
            tx.abort();
        } catch {}
        await tx.done.catch(() => {});
        throw error;
    }
}
