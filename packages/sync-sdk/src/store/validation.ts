import type { Change, RecordBatch } from "../types";
import { assert, canonical } from "../utils/codec";
import { CHUNK_SIZE, chunkStart } from "./entry";
export const identifier = (value: unknown): value is string =>
    typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value) &&
    !["__proto__", "constructor", "prototype"].includes(value);
export const sequence = (value: unknown): value is number =>
    Number.isSafeInteger(value) && (value as number) >= 0;
export function validateChanges(changes: Change[]) {
    assert(Array.isArray(changes), "Invalid changes");
    const keys = new Set<string>();
    for (const c of changes) {
        assert(
            c &&
                typeof c.collection === "string" &&
                !!c.collection &&
                typeof c.recordId === "string" &&
                !!c.recordId,
            "Invalid record key",
        );
        const key = canonical([c.collection, c.recordId]);
        assert(!keys.has(key), "Duplicate change in batch");
        keys.add(key);
        assert(c.type === "put" || c.type === "delete", "Unsupported change");
        if (c.type === "put") {
            assert(c.value !== null, "Invalid put");
            canonical(c.value);
        }
    }
}
export function validateBatch(batch: RecordBatch) {
    assert(
        batch?.format === "record-repo" &&
            batch.version === 4 &&
            identifier(batch.writerId) &&
            sequence(batch.fromSeq) &&
            batch.fromSeq > 0 &&
            chunkStart(batch.fromSeq) === batch.fromSeq &&
            sequence(batch.toSeq) &&
            batch.toSeq >= batch.fromSeq &&
            batch.toSeq - batch.fromSeq < CHUNK_SIZE &&
            sequence(batch.repoSeq) &&
            batch.repoSeq > 0 &&
            Array.isArray(batch.records) &&
            batch.records.length > 0,
        "Invalid record chunk",
    );
    const keys = new Set<string>();
    let maxSeq = 0;
    for (const entry of batch.records) {
        canonical(entry);
        assert(
            entry &&
                typeof entry.collection === "string" &&
                !!entry.collection &&
                typeof entry.id === "string" &&
                !!entry.id &&
                Object.hasOwn(entry, "value"),
            "Invalid record identity or value",
        );
        const key = canonical([entry.collection, entry.id]);
        assert(!keys.has(key), "Duplicate record in chunk");
        keys.add(key);
        const meta = entry._sync;
        assert(
            meta &&
                meta.writerId === batch.writerId &&
                sequence(meta.writerSeq) &&
                meta.writerSeq >= batch.fromSeq &&
                meta.writerSeq <= batch.toSeq &&
                sequence(meta.repoSeq) &&
                meta.repoSeq > 0 &&
                meta.repoSeq <= batch.repoSeq,
            "Invalid record version",
        );
        assert(
            Object.keys(meta).every((key) =>
                ["writerId", "writerSeq", "repoSeq"].includes(key),
            ),
            "Unexpected synchronization metadata",
        );
        maxSeq = Math.max(maxSeq, meta.writerSeq);
    }
    assert(
        maxSeq === batch.toSeq &&
            batch.records.some(
                (entry) => entry._sync.repoSeq === batch.repoSeq,
            ),
        "Chunk omits its newest publication",
    );
}
