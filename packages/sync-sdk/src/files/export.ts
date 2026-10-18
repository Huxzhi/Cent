import {
    chunkKey,
    chunkStart,
    itemKey,
    publishedSeq,
    wireEntry,
} from "../store/entry";
import type { IndexedDBStore } from "../store/runtime";
import { validateBatch } from "../store/validation";
import {
    type ChunkRef,
    type Manifest,
    type PendingSnapshot,
    type Publication,
    type RecordBatch,
    SyncError,
} from "../types";
import { assert, encodeCompressed, hash } from "../utils/codec";
import { assertManifestAdvance, chunkPath, validateManifest } from "./remote";
import type { PreparedUpload, SyncFile } from "./types";
import { decodeFiles } from "./validation";
export function packBatch(batch: RecordBatch) {
    validateBatch(batch);
    return encodeCompressed(batch);
}
export interface PlannedUpload extends ChunkRef {
    bytes: Uint8Array;
    batch: RecordBatch;
}
export interface UploadPlan {
    files: PlannedUpload[];
    manifest: Manifest;
    publication: Publication;
}
/** Merge new states into each affected logical chunk; never mutate the old object. */
export async function planUpload(
    manifest: Manifest,
    snapshot: PendingSnapshot,
    bases: RecordBatch[] = [],
    retiredAt = Date.now(),
): Promise<UploadPlan | undefined> {
    validateManifest(manifest);
    assert(
        snapshot.repoSeq === manifest.repoSeq &&
            Number.isSafeInteger(manifest.repoSeq + 1),
        "Repository progress changed",
    );
    const lower = publishedSeq(manifest, snapshot.writerId);
    assert(
        Number.isSafeInteger(snapshot.writerSeq) && snapshot.writerSeq >= lower,
        "Invalid local sequence",
    );
    if (!snapshot.records.length) return;
    const groups = new Map<number, typeof snapshot.records>();
    for (const entry of snapshot.records) {
        if (entry._sync.conflict)
            throw new SyncError(
                "RECORD_CONFLICT",
                "Resolve concurrent changes before uploading",
            );
        assert(
            entry._sync.writerId === snapshot.writerId &&
                Number.isSafeInteger(entry._sync.writerSeq) &&
                entry._sync.writerSeq > lower &&
                entry._sync.writerSeq <= snapshot.writerSeq &&
                entry._sync.repoSeq <= snapshot.repoSeq,
            "Invalid pending snapshot",
        );
        const from = chunkStart(entry._sync.writerSeq);
        const rows = groups.get(from) ?? [];
        rows.push(entry);
        groups.set(from, rows);
    }
    assert(
        snapshot.records.some(
            (entry) => entry._sync.writerSeq === snapshot.writerSeq,
        ),
        "Snapshot omits its cutoff record",
    );
    const repoSeq = manifest.repoSeq + 1;
    const previous = new Map(manifest.files.map((ref) => [chunkKey(ref), ref]));
    const files: PlannedUpload[] = [];
    const retired = new Map(manifest.retired.map((ref) => [ref.file, ref]));
    for (const [fromSeq, changes] of groups) {
        const key = chunkKey({ writerId: snapshot.writerId, fromSeq });
        const old = previous.get(key);
        const base = bases.find((batch) => chunkKey(batch) === key);
        if (old) {
            assert(base, "Missing base chunk for merge");
            validateBatch(base);
            assert(
                base.repoSeq === old.repoSeq && base.toSeq === old.toSeq,
                "Base chunk does not match manifest",
            );
        }
        assert(old || !base, "Unexpected base chunk");
        const rows = new Map(
            (base?.records ?? []).map((entry) => [
                itemKey(entry),
                wireEntry(entry),
            ]),
        );
        for (const entry of changes) {
            const next = wireEntry(entry);
            next._sync.repoSeq = repoSeq;
            rows.set(itemKey(entry), next);
        }
        const batch: RecordBatch = {
            format: "record-repo",
            version: 4,
            writerId: snapshot.writerId,
            fromSeq,
            toSeq: changes.reduce(
                (seq, entry) => Math.max(seq, entry._sync.writerSeq),
                0,
            ),
            repoSeq,
            records: [...rows.values()].sort((a, b) =>
                itemKey(a) < itemKey(b) ? -1 : itemKey(a) > itemKey(b) ? 1 : 0,
            ),
        };
        const bytes = packBatch(batch);
        const digest = await hash(bytes);
        const ref: ChunkRef = {
            writerId: batch.writerId,
            fromSeq,
            toSeq: batch.toSeq,
            repoSeq,
            hash: digest,
            file: chunkPath({
                writerId: batch.writerId,
                fromSeq,
                hash: digest,
            }),
        };
        files.push({ ...ref, bytes, batch });
        previous.set(key, ref);
        if (old)
            retired.set(old.file, {
                file: old.file,
                hash: old.hash,
                retiredAt,
            });
    }
    files.sort((a, b) => a.fromSeq - b.fromSeq);
    const next: Manifest = {
        ...manifest,
        repoSeq,
        files: [...previous.values()].sort(
            (a, b) =>
                a.repoSeq - b.repoSeq ||
                a.writerId.localeCompare(b.writerId, "en") ||
                a.fromSeq - b.fromSeq,
        ),
        retired: [...retired.values()],
    };
    validateManifest(next);
    return {
        files,
        manifest: next,
        publication: {
            writerId: snapshot.writerId,
            writerSeq: snapshot.writerSeq,
            repoSeq,
            files: files.map(({ bytes: _bytes, batch: _batch, ...ref }) => ref),
        },
    };
}

/** Persist the small recovery receipt before callers can publish these bytes. */
export async function prepareUploadFiles(
    store: IndexedDBStore,
    input: Manifest,
    baseFiles: readonly SyncFile[] = [],
    captured?: PendingSnapshot,
): Promise<PreparedUpload | undefined> {
    const manifest = structuredClone(input);
    const state = await store.getState();
    assertManifestAdvance(state.manifest, manifest);
    const snapshot = captured ?? (await store.exportPending(manifest));
    const bases = await decodeFiles(manifest, baseFiles);
    const plan = await planUpload(manifest, snapshot, bases);
    if (!plan) return;
    const abandoned = (await store.getState()).publication;
    if (abandoned) {
        const known = new Set(
            [...plan.manifest.files, ...plan.manifest.retired].map(
                (ref) => ref.file,
            ),
        );
        const leftovers = [
            ...(abandoned.abandoned ?? []),
            ...abandoned.files.map((ref) => ({
                file: ref.file,
                hash: ref.hash,
                retiredAt: Date.now(),
            })),
        ];
        const deferred = new Map<string, (typeof leftovers)[number]>();
        for (const ref of leftovers) {
            if (!known.has(ref.file)) {
                plan.manifest.retired.push(ref);
                known.add(ref.file);
            }
            if (!plan.manifest.files.some((live) => live.file === ref.file))
                deferred.set(ref.file, ref);
        }
        if (deferred.size) plan.publication.abandoned = [...deferred.values()];
    }
    validateManifest(plan.manifest);
    await store.savePublication(plan.publication);
    return {
        manifest: plan.manifest,
        files: plan.files.map(({ file, bytes }) => ({ file, bytes })),
    };
}
