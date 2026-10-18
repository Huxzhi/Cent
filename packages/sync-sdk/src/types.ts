export type WriterId = string;
export type CollectionId = string;
export type RecordId = string;
export interface RecordInput<T = unknown> {
    id?: RecordId;
    value: T;
}
export interface PutResult {
    id: RecordId;
    revision: number;
}
export interface PutManyResult {
    ids: RecordId[];
    revision: number;
}
/** Confirmed version, or the baseline of an unpublished local edit. */
export interface RecordVersion<T = unknown> {
    writerId: WriterId;
    writerSeq: number;
    repoSeq: number;
    value: T | null;
}
export interface StoredRecord<T = unknown> {
    collection: CollectionId;
    id: RecordId;
    value: T | null;
    _sync: {
        writerId: WriterId;
        writerSeq: number;
        repoSeq: number;
        dirty: boolean;
        conflicted: boolean;
        versions: RecordVersion<T>[];
    };
}
/** One current payload. Only an unresolved remote candidate adds another value. */
export interface DataEntry<T = unknown> {
    collection: CollectionId;
    id: RecordId;
    value: T | null;
    _sync: {
        writerId: WriterId;
        writerSeq: number;
        repoSeq: number;
        conflict?: RecordVersion<T>;
    };
}
export interface PutChange<T = unknown> {
    type: "put";
    collection: CollectionId;
    recordId: RecordId;
    value: T;
}
export interface DeleteChange {
    type: "delete";
    collection: CollectionId;
    recordId: RecordId;
}
export type Change<T = unknown> = PutChange<T> | DeleteChange;
export interface RemoteBinding {
    identity: string;
    provider?: string;
    /** Dataset directory relative to the host's configured remote root. */
    path?: string;
}
export interface ChunkRef {
    writerId: WriterId;
    fromSeq: number;
    toSeq: number;
    /** Last publication that changed this logical chunk. */
    repoSeq: number;
    file: string;
    hash: string;
}
export interface RetiredFile {
    file: string;
    hash: string;
    retiredAt: number;
}
export interface Publication {
    /** Unpublished objects from earlier interrupted attempts, to retire after publication. */
    abandoned?: RetiredFile[];
    writerId: WriterId;
    writerSeq: number;
    repoSeq: number;
    files: ChunkRef[];
}
export interface SyncState {
    key: "syncState";
    writerId: WriterId;
    /** Latest local record-write transaction; starts at 0. */
    writerSeq: number;
    /** Last completely imported repository commit. */
    repoSeq: number;
    /** Shared local sync activity; managed while holding the database's exclusive sync lock. */
    isSyncing: boolean;
    /** Local transaction revision, also used by optimistic saves and query cursors. */
    revision: number;
    remote?: RemoteBinding;
    publication?: Publication;
    /** Last completely imported manifest, used for offline reads and conflict detection. */
    manifest?: Manifest;
}
export interface PendingSnapshot {
    writerId: WriterId;
    writerSeq: number;
    repoSeq: number;
    revision: number;
    records: DataEntry[];
}
export interface RecordBatch {
    format: "record-repo";
    version: 4;
    writerId: WriterId;
    fromSeq: number;
    toSeq: number;
    repoSeq: number;
    records: DataEntry[];
}
export interface Manifest {
    format: "record-repo";
    version: 4;
    /** Human-readable dataset name; optional when reading older manifests. */
    name?: string;
    repoSeq: number;
    files: ChunkRef[];
    retired: RetiredFile[];
}
export interface QueryCursor {
    database: string;
    collection: string;
    orderBy: "id" | "time";
    direction: "asc" | "desc";
    revision: number;
    id: string;
    time?: number;
    from: number;
    to: number;
}
export interface QueryOptions {
    collection: string;
    orderBy?: "id" | "time";
    direction?: "asc" | "desc";
    limit?: number;
    cursor?: QueryCursor;
    from?: number;
    to?: number;
}
export interface RemoteFile {
    bytes: Uint8Array;
    etag: string;
}
/** Dataset-relative paths. Credentials never enter records or the manifest. */
export interface RemoteTransport {
    identity: string;
    read(path: string): Promise<RemoteFile | undefined>;
    write(
        path: string,
        bytes: Uint8Array,
        condition: { etag: string } | { create: true },
    ): Promise<void>;
    mkdir(path: string): Promise<void>;
    /** Conditional removal; omit to keep retired files on custom transports. */
    remove?(path: string, condition: { etag: string }): Promise<void>;
    verify?(): Promise<void>;
}
export class SyncError extends Error {
    readonly code: string;
    constructor(code: string, message: string) {
        super(message);
        this.code = code;
        this.name = "SyncError";
    }
}
