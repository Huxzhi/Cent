import { type Configuration, createConfiguration } from "./config";
import { createFileControls, type FileControls } from "./files";
import { createRecordStore, type RecordStore } from "./store";
import type { ChangeListener } from "./store/changes";
import { IndexedDBStore } from "./store/runtime";
import { createSyncControls, type SyncControls } from "./sync";
import { SyncEngine, type SyncOptions } from "./sync/engine";
export interface SyncSDK {
    store: RecordStore;
    config: Configuration;
    sync: SyncControls;
    files: FileControls;
    onChange(listener: ChangeListener): () => void;
    close(): Promise<void>;
}

/** One factory owns the private database and engine. */
export function createSyncSDK(
    options: SyncOptions & { databaseName: string },
): SyncSDK {
    const store = new IndexedDBStore(options.databaseName);
    const engine = new SyncEngine(store, options);
    return {
        store: createRecordStore(store),
        config: createConfiguration(store),
        sync: createSyncControls(engine),
        files: createFileControls(engine),
        onChange: (listener) => store.onChange(listener),
        close: () => store.close(),
    };
}
