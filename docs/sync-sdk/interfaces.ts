/**
 * Historical proposal. Current numeric-ID/array API is in ./spec.ts.
 * Browser Sync SDK API proposal. Declarations only; no runtime implementation.
 * See ../sync-sdk-design.md for transaction, conflict and recovery semantics.
 */
export type JsonValue =
    | null
    | boolean
    | number
    | string
    | JsonValue[]
    | { [key: string]: JsonValue };

export type Credentials<T> = T | (() => Promise<T>);
export type RemoteConfig =
    | {
          provider: "webdav";
          endpoint: string;
          root: string;
          credentials: Credentials<
              | { username: string; password: string }
              | { bearerToken: string }
          >;
      }
    | {
          provider: "github";
          owner: string;
          repo: string;
          branch: string;
          root: string;
          credentials: Credentials<{ token: string }>;
      };

export interface SDKOptions {
    /** Stable application namespace; not a secret or an authorization boundary. */
    namespace: string;
    local: { databaseName: string; opfsDirectory: string };
    sync:
        | { enabled: false }
        | {
              enabled: true;
              remote: RemoteConfig;
              autoSync?: boolean; // Default true while the app is running.
              debounceMs?: number; // Default 1000.
          };
    limits?: {
        readPageItems?: number; // Default 500.
        transactionItems?: number; // Default 1000; also enforce byte limits.
        transactionBytes?: number; // Default 4 MiB.
        remoteFileBytes?: number; // Default 4 MiB.
        transferConcurrency?: number; // Default 3, per remote endpoint.
    };
}

export type CallOptions = { signal?: AbortSignal };
/** null means this entity has never existed in the acknowledged remote base. */
export type EntityVersion = string | null;
export interface Schema<Item extends { id: string }, Meta> {
    format: string;
    version: number;
    /** Must be synchronous and throw on invalid input. SDK also checks JSON safety. */
    validateItem(value: unknown): asserts value is Item;
    validateMeta(value: unknown): asserts value is Meta;
    /** Validate one bounded transaction, including domain invariants if needed. */
    validateBatch?(mutations: readonly Mutation<Item, Meta>[]): void;
}

export type Mutation<Item extends { id: string }, Meta> =
    | { type: "item.put"; value: Item }
    | { type: "item.delete"; id: string }
    | { type: "meta.put"; value: Meta }
    | { type: "attachment.link"; attachment: StagedAttachment }
    | { type: "attachment.delete"; id: string };

export interface AttachmentInfo {
    id: string;
    name: string;
    mediaType: string;
    size: number;
    /** SHA-256 of the complete binary; physical blocks have separate hashes. */
    contentHash: string;
}
export interface StagedAttachment {
    /** Opaque token bound to one dataset. Binary is closed and verified before return. */
    token: string;
    info: AttachmentInfo;
}
export interface AttachmentInput {
    id?: string; // SDK generates a UUID if omitted.
    name: string;
    mediaType: string;
    data: Blob | ReadableStream<Uint8Array>;
}

export interface WriteReceipt {
    transactionId: string;
    localRevision: number;
    lastSequence: number;
    /** Local commit success; remote acceptance is reported separately. */
    pendingSync: boolean;
}
export interface ReadPage<T> {
    values: T[];
    nextCursor?: string;
    localRevision: number;
}
export interface PageOptions extends CallOptions {
    cursor?: string;
    limit?: number;
}
export type SyncPhase =
    | "idle"
    | "pulling"
    | "rebasing"
    | "pushing"
    | "confirming"
    | "error"
    | "closed";
export interface DatasetStatus {
    syncId: string;
    initialized: boolean;
    mode: "local" | "remote";
    stale: boolean;
    phase: SyncPhase;
    localRevision: number;
    remoteRevision?: string;
    pendingTransactions: number;
    conflictTransactions: number;
    lastSyncedAt?: number;
    lastError?: { code: SDKErrorCode; message: string };
}
export interface ConflictInfo {
    id: string;
    transactionId: string;
    resource: "item" | "meta" | "attachment";
    entityId: string;
    reason: "remote-changed" | "remote-deleted" | "base-expired";
    baseVersion: EntityVersion;
    remoteVersion: EntityVersion;
    occurredAt: number;
    /** Archived attempted writes, suitable for export; never automatically resent. */
    attempted: JsonValue;
}
export interface SyncResult {
    remoteRevision: string;
    acceptedTransactions: number;
    conflictedTransactions: number;
    pendingTransactions: number;
}
export type DatasetEvent =
    | { type: "change"; source: "local" | "remote"; localRevision: number }
    | { type: "status"; status: DatasetStatus }
    | { type: "conflict"; conflict: ConflictInfo };

export interface Dataset<Item extends { id: string }, Meta> {
    readonly syncId: string;
    items: {
        get(id: string, options?: CallOptions): Promise<Item | undefined>;
        getMany(ids: readonly string[], options?: CallOptions): Promise<(Item | undefined)[]>;
        /** Stable lexical order by item ID; cursors reject after localRevision changes. */
        page(options?: PageOptions): Promise<ReadPage<Item>>;
        iterate(options?: CallOptions & { pageSize?: number }): AsyncIterable<Item>;
        put(value: Item, options?: CallOptions): Promise<WriteReceipt>;
        delete(id: string, options?: CallOptions): Promise<WriteReceipt>;
        /** Bounded atomic transaction; oversize input rejects before any mutation. */
        putMany(values: readonly Item[], options?: CallOptions): Promise<WriteReceipt>;
        /** Multiple atomic batches; earlier batches survive a later failure. */
        import(
            values: AsyncIterable<Item>,
            options?: CallOptions & { batchSize?: number },
        ): AsyncIterable<WriteReceipt>;
    };
    meta: {
        get(options?: CallOptions): Promise<Meta>;
        put(value: Meta, options?: CallOptions): Promise<WriteReceipt>;
    };
    attachments: {
        stage(input: AttachmentInput, options?: CallOptions): Promise<StagedAttachment>;
        put(input: AttachmentInput, options?: CallOptions): Promise<AttachmentInfo>;
        info(id: string, options?: CallOptions): Promise<AttachmentInfo | undefined>;
        page(options?: PageOptions): Promise<ReadPage<AttachmentInfo>>;
        /** OPFS first; download verified blocks if absent. Offline miss rejects. */
        read(id: string, options?: CallOptions): Promise<ReadableStream<Uint8Array>>;
        prefetch(ids: readonly string[], options?: CallOptions): Promise<void>;
        delete(id: string, options?: CallOptions): Promise<WriteReceipt>;
    };
    /** All mutations and outbox entries are committed in one IndexedDB transaction. */
    batch(mutations: readonly Mutation<Item, Meta>[], options?: CallOptions): Promise<WriteReceipt>;
    sync(options?: CallOptions): Promise<SyncResult>;
    status(): Promise<DatasetStatus>;
    conflicts(options?: PageOptions): Promise<ReadPage<ConflictInfo>>;
    subscribe(listener: (event: DatasetEvent) => void): () => void;
    /** Cancels this handle's jobs and releases resources; does not remove local data. */
    close(): Promise<void>;
}

export interface OpenDatasetOptions<Item extends { id: string }, Meta> extends CallOptions {
    syncId: string;
    schema: Schema<Item, Meta>;
    /** Required for new local-only datasets; rejects if provided in remote mode. */
    initialMeta?: Meta;
    /** Local cache may open after a failed pull only when this is explicitly true. */
    allowStale?: boolean; // Default false in remote mode.
    attachments?: "lazy" | "eager"; // Default lazy.
}
export interface SyncSDK {
    /** Remote mode: pulls an existing dataset before resolving. Missing remote rejects. */
    openDataset<Item extends { id: string }, Meta>(
        options: OpenDatasetOptions<Item, Meta>,
    ): Promise<Dataset<Item, Meta>>;
    /** Explicit remote creation with create-if-absent; does not upload an existing cache. */
    createDataset<Item extends { id: string }, Meta>(
        options: CallOptions & { syncId: string; schema: Schema<Item, Meta>; meta: Meta },
    ): Promise<Dataset<Item, Meta>>;
    /** Explicitly publish a purely local dataset; remote must not already exist. */
    publishDataset(syncId: string, remote: RemoteConfig, options?: CallOptions): Promise<void>;
    listLocalDatasets(options?: PageOptions): Promise<ReadPage<DatasetStatus>>;
    listRemoteDatasets(options?: PageOptions): Promise<ReadPage<{ syncId: string; format: string }>>;
    /** Network pause only; reads, writes and durable outbox continue. */
    pauseSync(): Promise<void>;
    resumeSync(): Promise<void>;
    /** Memory only; the new remote identity must match the existing binding. */
    updateCredentials(remote: RemoteConfig): Promise<void>;
    close(): Promise<void>;
}
export declare function createSyncSDK(options: SDKOptions): Promise<SyncSDK>;

export type SDKErrorCode =
    | "AUTH_REQUIRED"
    | "REMOTE_NOT_FOUND"
    | "REMOTE_VERSION_CONFLICT"
    | "REMOTE_CAPABILITY_MISSING"
    | "REMOTE_IDENTITY_MISMATCH"
    | "SYNC_DISABLED"
    | "SCHEMA_MISMATCH"
    | "INVALID_DATA"
    | "INTEGRITY_ERROR"
    | "BATCH_TOO_LARGE"
    | "CURSOR_EXPIRED"
    | "ATTACHMENT_NOT_CACHED"
    | "STORAGE_QUOTA_EXCEEDED"
    | "STORAGE_UNAVAILABLE"
    | "NETWORK_ERROR"
    | "RATE_LIMITED"
    | "CANCELLED";

// Internal protocol proposals. Provider implementations depend on these types,
// never on business objects, React stores, user profiles or application routes.
export interface ObjectReference {
    /** Relative to one syncId directory. */
    path: string;
    sha256: string;
    bytes: number;
}
/** Durable attachment mutation; public stage tokens never appear in remote logs. */
export type StoredMutation<Item extends { id: string }, Meta> =
    | Exclude<Mutation<Item, Meta>, { type: "attachment.link" }>
    | {
          type: "attachment.put";
          info: AttachmentInfo;
          blocksIndex: ObjectReference;
      };
export type ExpectedEntityVersion =
    | { kind: "remote"; version: EntityVersion }
    | { kind: "transaction"; transactionId: string };
export interface RootManifest {
    protocol: "browser-sync";
    version: 1;
    namespace: string;
    syncId: string;
    schema: { format: string; version: number };
    generation: string;
    /** Expired epochs cannot replay old pending writes against a compacted base. */
    epoch: string;
    snapshotIndex: ObjectReference;
    attachmentIndex: ObjectReference;
    receiptIndex: ObjectReference;
    /** Index pages reference bounded immutable log segments, not an unbounded array. */
    logIndex: ObjectReference;
}
export interface PendingTransaction<Item extends { id: string }, Meta> {
    transactionId: string;
    replicaId: string;
    sequence: number;
    baseEpoch: string;
    /** One guard per touched resource; version is a UUID, not a timestamp. */
    guards: {
        resource: "item" | "meta" | "attachment";
        id: string;
        expected: ExpectedEntityVersion;
    }[];
    dependsOn: string[];
    mutations: StoredMutation<Item, Meta>[];
    state: "pending" | "inflight";
}
export interface RemoteDriver {
    readonly identity: string; // Provider + canonical target + branch/root; no credentials.
    capabilities(options?: CallOptions): Promise<{
        conditionalCommit: boolean;
        maxObjectBytes: number;
    }>;
    /** null means a verifiable missing manifest, never an auth or network failure. */
    readHead(syncId: string, options?: CallOptions): Promise<{
        manifest: RootManifest;
        revision: string;
    } | null>;
    readObject(
        syncId: string,
        reference: ObjectReference,
        revision: string,
        options?: CallOptions,
    ): Promise<ReadableStream<Uint8Array>>;
    /** Stage immutable data; reuse an existing object only after verifying its hash. */
    writeObject(
        syncId: string,
        reference: ObjectReference,
        data: Blob,
        options?: CallOptions,
    ): Promise<void>;
    /** The sole visibility point: expected=null creates; otherwise compare against head. */
    commit(
        syncId: string,
        manifest: RootManifest,
        expectedRevision: string | null,
        options?: CallOptions,
    ): Promise<{ revision: string }>;
}
