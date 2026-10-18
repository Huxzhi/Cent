import { type DBSchema, type IDBPDatabase, openDB } from "idb";
import type { DataEntry, SyncState } from "../types";
import { createWriterId } from "../utils/id";

export interface Schema extends DBSchema {
    records: {
        key: [string, string];
        value: DataEntry;
        indexes: {
            time: [string, number, string];
            writer: [string, number];
        };
    };
    config: { key: string; value: SyncState | { key: string; value: unknown } };
}
export interface DatabaseConnection {
    name: string;
    db: Promise<IDBPDatabase<Schema>>;
}
export const localKey = (key: string) => `local/${key}`;
export function openDatabase(name: string, blocking: () => void) {
    return openDB<Schema>(name, 1, {
        upgrade(db) {
            const records = db.createObjectStore("records", {
                keyPath: ["collection", "id"],
            });
            records.createIndex("time", ["collection", "value.time", "id"]);
            records.createIndex("writer", [
                "_sync.writerId",
                "_sync.writerSeq",
            ]);
            db.createObjectStore("config", { keyPath: "key" });
        },
        blocking,
    }).then(async (db) => {
        const tx = db.transaction("config", "readwrite");
        const state = (await tx.store.get("syncState")) as
            | SyncState
            | undefined;
        if (!state)
            await tx.store.add({
                key: "syncState",
                writerId: createWriterId(),
                writerSeq: 0,
                repoSeq: 0,
                isSyncing: false,
            });
        else {
            // Persist only the supported state fields while preserving the database identity and progress.
            const current: SyncState = {
                key: "syncState",
                writerId: state.writerId,
                writerSeq: state.writerSeq,
                repoSeq: state.repoSeq,
                isSyncing: state.isSyncing ?? false,
                ...(state.remote ? { remote: state.remote } : {}),
                ...(state.publication
                    ? { publication: state.publication }
                    : {}),
                ...(state.manifest ? { manifest: state.manifest } : {}),
            };
            await tx.store.put(current);
        }
        await tx.done;
        return db;
    });
}
