import * as config from "../config/state";
import * as transactions from "../files/transactions";
import type {
    Change,
    Manifest,
    Publication,
    PutResult,
    QueryOptions,
    RecordBatch,
    RecordInput,
    RemoteBinding,
} from "../types";
import { type ChangeListener, RecordChanges } from "./changes";
import { type DatabaseConnection, openDatabase } from "./database";
import * as query from "./query";
import { batch, putRecords, type WriteOptions } from "./write";

export type { WriteOptions } from "./write";

/** Private database access shared by the four API groups; transactions stay in their owning modules. */
export class IndexedDBStore {
    private connection: DatabaseConnection;
    private changes: RecordChanges;
    readonly name: string;
    constructor(name: string) {
        this.name = name;
        this.changes = new RecordChanges(name);
        this.connection = {
            name,
            db: openDatabase(name, () => {
                void this.close();
            }),
        };
    }
    async close() {
        this.changes.close();
        (await this.connection.db).close();
    }
    onChange(listener: ChangeListener) {
        return this.changes.onChange(listener);
    }
    getState() {
        return config.getState(this.connection);
    }
    setSyncing(isSyncing: boolean) {
        return config.setSyncing(this.connection, isSyncing);
    }
    bindRemote(
        binding:
            | RemoteBinding
            | ((current?: Readonly<RemoteBinding>) => RemoteBinding),
    ) {
        return config.bindRemote(this.connection, binding);
    }
    getLocal<T>(key: string) {
        return config.getLocal<T>(this.connection, key);
    }
    setLocal(key: string, value: unknown) {
        return config.setLocal(this.connection, key, value);
    }
    get<T = unknown>(collection: string, id: string) {
        return query.get<T>(this.connection, collection, id);
    }
    getMany<T = unknown>(collection: string, ids: string[]) {
        return query.getMany<T>(this.connection, collection, ids);
    }
    snapshot() {
        return query.snapshot(this.connection);
    }
    query<T = unknown>(options: QueryOptions) {
        return query.query<T>(this.connection, options);
    }
    getConflicts() {
        return query.getConflicts(this.connection);
    }
    async put<T>(
        collection: string,
        record: RecordInput<T>,
        options?: WriteOptions,
    ): Promise<PutResult> {
        const { ids, version } = await this.putMany(
            collection,
            [record],
            options,
        );
        return { id: ids[0], version };
    }

    async delete(collection: string, recordId: string, options?: WriteOptions) {
        return this.batch([{ type: "delete", collection, recordId }], options);
    }

    async putMany<T>(
        collection: string,
        records: RecordInput<T>[],
        options?: WriteOptions,
    ) {
        return putRecords(
            this.connection,
            this.changes,
            collection,
            records,
            options,
        );
    }
    batch(input: Change[], options: WriteOptions = {}) {
        return batch(this.connection, this.changes, input, options);
    }
    exportPending(manifest?: Manifest) {
        return transactions.exportPending(this.connection, manifest);
    }
    importManifest(manifest: Manifest, batches: RecordBatch[]) {
        return transactions.importManifest(
            this.connection,
            this.changes,
            manifest,
            batches,
        );
    }
    savePublication(publication: Publication) {
        return transactions.savePublication(this.connection, publication);
    }
}
