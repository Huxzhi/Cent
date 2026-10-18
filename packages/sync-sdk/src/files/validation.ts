import { chunkKey } from "../store/entry";
import { validateBatch } from "../store/validation";
import { type Manifest, type RecordBatch, SyncError } from "../types";
import { assert, decodeCompressed, hash } from "../utils/codec";
import { validateManifest } from "./remote";
import type { SyncFile } from "./types";
/** Parse only files named by this manifest, with hash and identity verification. */
export async function decodeFiles(
    manifest: Manifest,
    input: readonly SyncFile[],
): Promise<RecordBatch[]> {
    validateManifest(manifest);
    const refs = new Map(manifest.files.map((ref) => [ref.file, ref]));
    const seen = new Set<string>();
    const files = input.map(({ file, bytes }) => ({
        file,
        bytes: bytes.slice(),
    }));
    const batches: RecordBatch[] = [];
    for (const file of files) {
        const ref = refs.get(file.file);
        assert(ref && !seen.has(file.file), "Unknown or duplicate sync file");
        seen.add(file.file);
        if ((await hash(file.bytes)) !== ref.hash)
            throw new SyncError("HASH_MISMATCH", "Sync file hash mismatch");
        let batch: RecordBatch;
        try {
            batch = decodeCompressed(file.bytes) as RecordBatch;
        } catch {
            throw new SyncError("INVALID_DATA", "Invalid JSON.gz sync file");
        }
        validateBatch(batch);
        assert(
            chunkKey(batch) === chunkKey(ref) &&
                batch.toSeq === ref.toSeq &&
                batch.repoSeq === ref.repoSeq,
            "Chunk file does not match manifest",
        );
        batches.push(batch);
    }
    return batches;
}
