import type { Manifest } from "../types";
/** A dataset-relative immutable path and its gzip JSON content. */
export interface SyncFile {
    file: string;
    bytes: Uint8Array;
}
export interface PreparedUpload {
    manifest: Manifest;
    files: SyncFile[];
}
