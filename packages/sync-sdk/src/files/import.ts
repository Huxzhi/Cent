import type { IndexedDBStore } from "../store/runtime";
import type { Manifest } from "../types";
import type { SyncFile } from "./types";
import { decodeFiles } from "./validation";
/** Every file is verified before any record or repository cursor is committed. */
export async function importSyncFiles(
    store: IndexedDBStore,
    input: Manifest,
    files: readonly SyncFile[],
) {
    const manifest = structuredClone(input);
    const batches = await decodeFiles(manifest, files);
    await store.importManifest(manifest, batches);
}
