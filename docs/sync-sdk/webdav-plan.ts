/** Historical WebDAV proposal. Current protocol is in ./spec.ts; no runtime implementation. */
import type {
    AttachmentInfo,
    CallOptions,
    EntityVersion,
    ObjectReference,
    PendingTransaction,
    RootManifest,
} from "./interfaces";

export interface WebDAVManifest extends RootManifest {
    /** Incremented once for each successful conditional manifest commit, including compaction. */
    headSequence: number;
    checkpoint: {
        id: string;
        /** Snapshot includes all transactions at or before this commit sequence. */
        throughSequence: number;
    };
}
export interface WebDAVHead {
    manifest: WebDAVManifest;
    /** Exact quoted strong ETag from GET; never a last-modified timestamp. */
    etag: string;
}
export interface ReplicationCheckpoint {
    remoteIdentity: string;
    syncId: string;
    epoch: string;
    /** Highest complete remote commit applied to the acknowledged local base. */
    throughSequence: number;
}
export type RemoteEntity<Item extends { id: string }, Meta> =
    | { resource: "item"; id: string; version: string; value: Item | null }
    | { resource: "meta"; id: "meta"; version: string; value: Meta }
    | {
          resource: "attachment";
          id: string;
          version: string;
          value: (AttachmentInfo & { blocksIndex: ObjectReference }) | null;
      };
export interface CommittedTransaction<Item extends { id: string }, Meta> {
    transactionId: string;
    replicaId: string;
    localSequence: number;
    commitSequence: number;
    /** Zero-based order within this remote commit. */
    ordinal: number;
    /** Complete atomic transaction; never split across local confirmation boundaries. */
    changes: RemoteEntity<Item, Meta>[];
}
export interface PullWindow {
    syncId: string;
    head: WebDAVHead;
    mode: "snapshot" | "delta";
    from?: ReplicationCheckpoint;
}
export interface PullCursor {
    /** Bound to the window's immutable manifest generation, not to the live head. */
    targetGeneration: string;
    phase: "snapshot" | "delta";
    token: string;
}
export type PullPage<Item extends { id: string }, Meta> =
    | { phase: "snapshot"; entities: RemoteEntity<Item, Meta>[]; next?: PullCursor }
    | {
          phase: "delta";
          transactions: CommittedTransaction<Item, Meta>[];
          next?: PullCursor;
      };
export interface PushOutcome {
    /** Fresh observed head after commit/recovery; may be newer than this client's commit. */
    head: WebDAVHead;
    accepted: { transactionId: string; commitSequence: number }[];
    conflicts: {
        transactionId: string;
        entities: {
            resource: "item" | "meta" | "attachment";
            id: string;
            expectedVersion: EntityVersion;
            actualVersion: EntityVersion;
        }[];
    }[];
}
export interface WebDAVReplicationBackend<Item extends { id: string }, Meta> {
    /** Conditional GET; returns cached head on 304 only when a validated cache exists. */
    getHead(syncId: string, options?: CallOptions): Promise<WebDAVHead | null>;
    openPullWindow(
        syncId: string,
        checkpoint: ReplicationCheckpoint | undefined,
        options?: CallOptions,
    ): Promise<PullWindow>;
    /** Limits bound a page; a whole transaction must still fit the configured hard limit. */
    readPullPage(
        window: PullWindow,
        cursor: PullCursor | undefined,
        limits: { maxItems: number; maxBytes: number },
        options?: CallOptions,
    ): Promise<PullPage<Item, Meta>>;
    /** Receipts first, guards second, immutable uploads third, conditional head commit last. */
    pushTransactions(
        syncId: string,
        transactions: readonly PendingTransaction<Item, Meta>[],
        options?: CallOptions,
    ): Promise<PushOutcome>;
    /** Produces a bounded snapshot and log tail, then conditionally swaps the manifest. */
    compact(syncId: string, options?: CallOptions): Promise<WebDAVHead>;
}

export interface WebDAVHTTPTransport {
    /** All paths are validated SDK paths relative to the configured root. */
    get(
        path: string,
        options?: CallOptions & { ifNoneMatch?: string },
    ): Promise<
        | { status: 200; body: ReadableStream<Uint8Array>; etag?: string }
        | { status: 304 }
        | { status: 404 }
    >;
    put(
        path: string,
        body: Blob,
        condition: { ifMatch: string } | { ifNoneMatch: "*" },
        options?: CallOptions,
    ): Promise<{ status: 200 | 201 | 204; etag?: string }>;
    /** Creates parent collections once; existing collections must be verified as directories. */
    ensureDirectory(path: string, options?: CallOptions): Promise<void>;
}
