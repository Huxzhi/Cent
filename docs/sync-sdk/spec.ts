/** Current design declarations only; no runtime implementation. See ../sync-sdk-spec.md. */
export interface BaseItem {
    /** Non-empty stable string, preferably UUIDv7; never changes on checkpoint rotation. */
    id: ItemId;
}
export type ItemId = string;
export type StoredItem<Item extends BaseItem> = Omit<Item, "updatedAt"> & { updatedAt: number };
export type Direction = "asc" | "desc";
export type OrderBy = "id" | "time" | "updatedAt";
export type NumericField<Item> = {
    [Key in keyof Item]-?: Item[Key] extends number ? Key : never;
}[keyof Item] & string;
export type CallOptions = { signal?: AbortSignal };
export interface ReadOptions extends CallOptions {
    ids?: readonly ItemId[];
    /** Lexical string range, not a numeric or business-time range. */
    idRange?: { min?: ItemId; max?: ItemId };
    /** Requires schema.timeField; bounds are UTC Unix milliseconds. */
    timeRange?: { min?: number; max?: number };
    updatedAtRange?: { min?: number; max?: number };
    limit?: number; // Default 100, configured hard limit defaults to 1000.
    orderBy?: OrderBy; // Schema defaultOrder, otherwise id.
    direction?: Direction; // Schema defaultOrder, otherwise asc; ID breaks time ties.
}
export interface PageOptions extends ReadOptions {
    cursor?: string;
}
export interface ItemPage<Item extends BaseItem> {
    items: StoredItem<Item>[];
    nextCursor?: string;
    localRevision: number;
}
export type Credentials<Value> = Value | (() => Promise<Value>);
export interface WebDAVConfig {
    provider: "webdav";
    endpoint: string;
    root: string;
    credentials: Credentials<
        { username: string; password: string } | { bearerToken: string }
    >;
}
export interface SDKOptions {
    namespace: string;
    local?: {
        /** Default namespace + '-'; databaseName overrides this naming convention. */
        databasePrefix?: string;
        databaseName?: string;
        opfsDirectory?: string;
    };
    remote?: WebDAVConfig; // Omitted means local-only.
    autoSync?: boolean;
    limits?: {
        queryItems?: number;
        queryBytes?: number;
        batchItems?: number;
        batchBytes?: number;
        fileBytes?: number;
        transferConcurrency?: number;
    };
}
export interface Schema<Item extends BaseItem> {
    format: string;
    version: number;
    /** Business-owned required numeric field; SDK never changes it during sync or replay. */
    timeField?: Exclude<NumericField<Item>, "id" | "updatedAt">;
    /** 'time' requires timeField. Accounting schemas should select time descending. */
    defaultOrder?: { by: OrderBy; direction: Direction };
    validateItem(value: unknown): asserts value is Item;
}
export interface Origin {
    /** Original position is immutable even when current log position changes. */
    deviceId: string;
    sequence: number;
}
export interface OperationContext {
    checkpointId: string | null;
    /** Causal coverage refers to original operation origins, not reassigned log positions. */
    observed: Record<string, number>;
}
export type ItemOperation<Item extends BaseItem> = {
    operationId: string;
    origin: Origin;
    context: OperationContext;
    clock: number;
    updatedAt: number;
} & (
    | { type: "put"; itemId: ItemId; value: StoredItem<Item> }
    | { type: "delete"; itemId: ItemId }
);
export interface LogRecord<Item extends BaseItem> {
    /** Current log placement; may change on checkpoint rotation. */
    deviceId: string;
    sequence: number;
    operation: ItemOperation<Item>;
}
export interface WriteReceipt {
    localRevision: number;
    deviceId: string;
    coversThrough: number;
    retainedOperationIds: string[];
    pendingSync: boolean;
}
export interface CancelledDelete {
    itemId: ItemId;
    removedDeleteOperationId: string;
    /** Existing put, never a generated restore operation. */
    retainedPutOperationId: string;
}
export interface SyncResult {
    manifestRevision: string;
    checkpointId: string | null;
    submittedThrough: number;
    pendingOperations: number;
    cancelledDeletes: CancelledDelete[];
}
export interface DatasetStatus {
    id: string;
    deviceId: string;
    checkpointId: string | null;
    localRevision: number;
    pendingOperations: number;
    syncing: boolean;
    stale: boolean;
}
export interface AttachmentInfo {
    id: string;
    name: string;
    mediaType: string;
    bytes: number;
    sha256: string;
    updatedAt: number;
}
export interface AttachmentInput {
    id?: string;
    name: string;
    mediaType: string;
    data: Blob | ReadableStream<Uint8Array>;
}
export interface StagedAttachment {
    token: string;
    info: AttachmentInfo;
}
export type Mutation<Item extends BaseItem> =
    | { type: "put"; item: Item }
    | { type: "delete"; itemId: ItemId }
    | { type: "attachment.link"; staged: StagedAttachment }
    | { type: "attachment.delete"; attachmentId: string };
export interface Dataset<Item extends BaseItem> {
    readonly id: string; // syncId
    items: {
        /** Returns arrays, including [] when no ID matches. No unbounded getAll. */
        read(options?: ReadOptions): Promise<StoredItem<Item>[]>;
        readPage(options?: PageOptions): Promise<ItemPage<Item>>;
        put(items: readonly Item[], options?: CallOptions): Promise<WriteReceipt>;
        remove(ids: readonly ItemId[], options?: CallOptions): Promise<WriteReceipt>;
    };
    attachments: {
        stage(inputs: readonly AttachmentInput[], options?: CallOptions): Promise<StagedAttachment[]>;
        readInfo(
            options?: CallOptions & { ids?: readonly string[]; limit?: number },
        ): Promise<AttachmentInfo[]>;
        read(
            ids: readonly string[],
            options?: CallOptions,
        ): Promise<{ id: string; data: ReadableStream<Uint8Array> }[]>;
        prefetch(ids: readonly string[], options?: CallOptions): Promise<void>;
    };
    /** Bounded atomic group; compaction must preserve group effects and dependencies. */
    batch(mutations: readonly Mutation<Item>[], options?: CallOptions): Promise<WriteReceipt>;
    sync(options?: CallOptions): Promise<SyncResult>;
    checkpoint(options?: CallOptions): Promise<{ checkpointId: string; manifestRevision: string }>;
    status(): Promise<DatasetStatus>;
    subscribe(listener: (event: {
        type: "change" | "sync";
        localRevision: number;
        changedItemIds: ItemId[];
    }) => void): () => void;
    close(): Promise<void>;
}
export interface SyncSDK {
    /** Remote mode pulls an existing dataset; local mode may initialize an empty dataset. */
    openDataset<Item extends BaseItem>(
        options: CallOptions & { id: string; schema: Schema<Item>; allowStale?: boolean },
    ): Promise<Dataset<Item>>;
    /** Explicit remote create-if-absent; auth/network errors are never interpreted as missing. */
    createDataset<Item extends BaseItem>(
        options: CallOptions & { id: string; schema: Schema<Item> },
    ): Promise<Dataset<Item>>;
    listDatasets(options?: CallOptions & { limit?: number }): Promise<DatasetStatus[]>;
    pauseSync(): Promise<void>;
    resumeSync(): Promise<void>;
    updateCredentials(remote: WebDAVConfig): Promise<void>;
    close(): Promise<void>;
}
export declare function createSyncSDK(options: SDKOptions): Promise<SyncSDK>;

// Protocol roots are paged; identifiers and watermarks are not array offsets.
export interface ObjectReference {
    path: string;
    sha256: string;
    bytes: number;
}
export interface DeviceLogHead {
    deviceId: string;
    submittedThrough: number;
    revision: string;
    operationsIndex: ObjectReference;
    /** Proves skipped sequence positions are represented by compaction, not missing data. */
    coverageIndex: ObjectReference;
}
export interface Progress {
    deviceId: string;
    downloadedThrough: number;
    downloadedRevision: string;
    effectiveIndexHash: string;
}
export interface CheckpointCoverage {
    deviceId: string;
    throughSequence: number;
    logRevision: string;
    coverageIndex: ObjectReference;
}
export interface Manifest {
    protocol: "browser-sync";
    version: 1;
    namespace: string;
    syncId: string;
    schema: { format: string; version: number };
    generation: string;
    checkpoint: {
        id: string;
        itemsIndex: ObjectReference;
        coverageIndex: ObjectReference;
        causalIndex: ObjectReference;
    };
    devicesIndex: ObjectReference;
    /** Tracks effective-set removal/replacement even when per-device sequence does not grow. */
    effectiveIndex: ObjectReference;
    attachmentsIndex: ObjectReference;
    receiptsIndex: ObjectReference;
}

// Durable local state proposal. Observed remote state and applied state are distinct.
export interface AppliedRemoteState {
    manifestGeneration: string;
    etag: string;
    effectiveIndexHash: string;
}
export interface DatasetLocalState {
    datasetKey: string;
    namespace: string;
    syncId: string;
    remoteIdentity?: string;
    initialized: boolean;
    activeGeneration: string;
    appliedCheckpointId: string | null;
    device: { id: string; nextSequence: number; logicalClock: number };
    localRevision: number;
    appliedRemote?: AppliedRemoteState;
    lastSyncedAt?: number;
}
export interface ManifestCacheRecord {
    datasetKey: string;
    generation: string;
    etag: string;
    fetchedAt: number;
    manifest: Manifest;
}
export interface LocalStreamProgress {
    datasetKey: string;
    deviceId: string;
    submitted?: {
        throughSequence: number;
        logRevision: string;
        manifestGeneration: string;
    };
    downloaded?: {
        throughSequence: number;
        logRevision: string;
        manifestGeneration: string;
        effectiveIndexHash: string;
    };
}
export interface OperationPosition {
    datasetKey: string;
    deviceId: string;
    sequence: number;
    operationId: string;
    state: "pending" | "inflight" | "published" | "downloaded" | "retired";
    frozenByJobId?: string;
}
export type ReceiptEvidence = {
    datasetKey: string;
    operationId: string;
} & (
    | { kind: "published"; manifestGeneration: string; logRevision: string }
    | { kind: "checkpoint-covered"; manifestGeneration: string; checkpointId: string }
    | { kind: "locally-superseded"; byOperationId: string }
);
export type LocalJob = {
    datasetKey: string;
    jobId: string;
    state: "prepared" | "running" | "awaiting-confirmation" | "completed" | "failed";
    createdAt: number;
    lastError?: string;
} & (
    | {
          kind: "pull";
          source: AppliedRemoteState;
          targetCheckpointId: string;
          stagingGeneration: string;
          cursor?: string;
      }
    | {
          kind: "push";
          source: AppliedRemoteState;
          deviceId: string;
          frozenThrough: number;
          /** Bounded batch; stable payloads remain pinned while this job exists. */
          candidates: { sequence: number; operationId: string }[];
          candidateManifestGeneration: string;
      }
    | {
          kind: "checkpoint";
          source: AppliedRemoteState;
          candidateCheckpointId: string;
          stagingGeneration: string;
          cursor?: string;
      }
    | {
          kind: "attachment";
          attachmentId: string;
          contentHash: string;
          direction: "download" | "upload";
          nextBlock: number;
      }
    | {
          kind: "rotation";
          oldDeviceId: string;
          newDeviceId: string;
          checkpointId: string;
          coveredThrough: number;
          stagingGeneration: string;
          cursor?: string;
      }
);
