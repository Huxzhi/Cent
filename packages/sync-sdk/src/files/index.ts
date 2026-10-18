import type { SyncEngine } from "../sync/engine";
import type { Manifest } from "../types";
import type { PreparedUpload, SyncFile } from "./types";

export type { PreparedUpload, SyncFile } from "./types";
export interface FileControls {
    /** Generate upload bytes and persist their recovery receipt; manifest must be fully imported. */
    prepareUpload(
        manifest: Manifest,
        baseFiles?: readonly SyncFile[],
    ): Promise<PreparedUpload | undefined>;
    /** Verify and import every changed file atomically; also confirms this device's published files. */
    importFiles(manifest: Manifest, files: readonly SyncFile[]): Promise<void>;
}

export function createFileControls(engine: SyncEngine): FileControls {
    return {
        prepareUpload: (manifest, baseFiles) =>
            engine.prepareUpload(manifest, baseFiles),
        importFiles: (manifest, files) => engine.importFiles(manifest, files),
    };
}
