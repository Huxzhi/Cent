import type { Change, QueryOptions, RecordInput } from "../types";
import type { IndexedDBStore } from "./runtime";
import type { WriteOptions } from "./write";

export type { ChangeEvent, ChangeListener, RecordKey } from "./changes";
export type { WriteOptions } from "./write";
export type RecordStore = Pick<
    IndexedDBStore,
    | "name"
    | "get"
    | "getMany"
    | "query"
    | "snapshot"
    | "getConflicts"
    | "put"
    | "putMany"
    | "delete"
    | "batch"
>;

/** Expose record operations without leaking internal database methods. */
export function createRecordStore(store: IndexedDBStore): RecordStore {
    return {
        name: store.name,
        get<T>(collection: string, id: string) {
            return store.get<T>(collection, id);
        },
        getMany<T>(collection: string, ids: string[]) {
            return store.getMany<T>(collection, ids);
        },
        query<T>(options: QueryOptions) {
            return store.query<T>(options);
        },
        snapshot: () => store.snapshot(),
        getConflicts: () => store.getConflicts(),
        put<T>(
            collection: string,
            record: RecordInput<T>,
            options?: WriteOptions,
        ) {
            return store.put(collection, record, options);
        },
        putMany<T>(
            collection: string,
            records: RecordInput<T>[],
            options?: WriteOptions,
        ) {
            return store.putMany(collection, records, options);
        },
        delete: (collection, id, options) =>
            store.delete(collection, id, options),
        batch: (changes: Change[], options?: WriteOptions) =>
            store.batch(changes, options),
    };
}
