import {
    type Change,
    type PutManyResult,
    type RecordInput,
    SyncError,
    type SyncState,
} from "../types";
import { assert } from "../utils/codec";
import { createId } from "../utils/id";
import type { RecordChanges } from "./changes";
import { type DatabaseConnection, localKey } from "./database";
import { isPending, toEntry } from "./entry";
import { validateChanges } from "./validation";

interface LocalWriteOptions {
    local?: { key: string; value: unknown }[];
}
/** A conflict decision must be tied to the snapshot shown to its caller. */
export type WriteOptions = LocalWriteOptions &
    (
        | { resolve?: false; expectedRevision?: number }
        | { resolve: true; expectedRevision: number }
    );

/** Allocate missing IDs once per attempt, then commit the complete input atomically. */
export async function putRecords<T>(
    connection: DatabaseConnection,
    notifications: RecordChanges,
    collection: string,
    input: RecordInput<T>[],
    options: WriteOptions = {},
): Promise<PutManyResult> {
    const records = structuredClone(input);
    const capturedOptions = structuredClone(options);
    for (let attempt = 0; ; attempt++) {
        try {
            const reserved = new Set(
                records.flatMap((record) =>
                    record.id === undefined ? [] : [record.id],
                ),
            );
            const generated = new Set<string>();
            const ids = records.map((record) => {
                if (record.id !== undefined) return record.id;
                const id = createId();
                if (reserved.has(id))
                    throw new SyncError(
                        "ID_COLLISION",
                        "Generated record ID already exists",
                    );
                reserved.add(id);
                generated.add(id);
                return id;
            });
            const revision = await batch(
                connection,
                notifications,
                records.map((record, index) => ({
                    type: "put",
                    collection,
                    recordId: ids[index],
                    value: record.value,
                })),
                capturedOptions,
                generated,
            );
            return { ids, revision };
        } catch (error) {
            if (
                !(error instanceof SyncError) ||
                error.code !== "ID_COLLISION" ||
                attempt >= 7
            )
                throw error;
        }
    }
}

export async function batch(
    connection: DatabaseConnection,
    notifications: RecordChanges,
    input: Change[],
    options: WriteOptions = {},
    generatedIds?: ReadonlySet<string>,
) {
    const changes = structuredClone(input);
    const capturedOptions = structuredClone(options);
    validateChanges(changes);
    if (
        capturedOptions.resolve &&
        (!Number.isSafeInteger(capturedOptions.expectedRevision) ||
            capturedOptions.expectedRevision < 0)
    )
        throw new SyncError(
            "LOCAL_CONFLICT",
            "Conflict resolution requires the revision shown to the user; reload before saving",
        );
    const tx = (await connection.db).transaction(
        ["records", "config"],
        "readwrite",
    );
    try {
        const state = (await tx
            .objectStore("config")
            .get("syncState")) as SyncState;
        if (
            capturedOptions.expectedRevision !== undefined &&
            capturedOptions.expectedRevision !== state.revision
        )
            throw new SyncError(
                "LOCAL_CONFLICT",
                "Data changed in another tab; reload before saving",
            );
        assert(
            Number.isSafeInteger(state.writerSeq + (changes.length ? 1 : 0)),
            "Writer sequence exhausted",
        );
        // One sequence per committed business submission, including a whole import batch.
        if (changes.length) state.writerSeq++;
        const store = tx.objectStore("records");
        for (const change of changes) {
            const entry = await store.get([change.collection, change.recordId]);
            if (generatedIds?.has(change.recordId) && entry)
                throw new SyncError(
                    "ID_COLLISION",
                    "Generated record ID already exists",
                );
            if (entry?._sync.conflict && !capturedOptions.resolve)
                throw new SyncError(
                    "RECORD_CONFLICT",
                    "Resolve this record before editing it",
                );
            const repoSeq =
                entry && isPending(entry, state) && !capturedOptions.resolve
                    ? entry._sync.repoSeq
                    : state.repoSeq;
            await store.put(
                toEntry(change.collection, change.recordId, {
                    writerId: state.writerId,
                    writerSeq: state.writerSeq,
                    repoSeq,
                    value: change.type === "put" ? change.value : null,
                }),
            );
        }
        for (const entry of capturedOptions.local ?? [])
            await tx
                .objectStore("config")
                .put({ key: localKey(entry.key), value: entry.value });
        state.revision++;
        await tx.objectStore("config").put(state);
        await tx.done;
        notifications.emit(
            "local",
            changes.map((change) => ({
                collection: change.collection,
                id: change.recordId,
            })),
            state.revision,
        );
        return state.revision;
    } catch (error) {
        try {
            tx.abort();
        } catch {}
        await tx.done.catch(() => {});
        throw error;
    }
}
