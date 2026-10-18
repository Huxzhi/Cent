import { prepareUploadFiles } from "../files/export";
import { importSyncFiles } from "../files/import";
import { readManifest, saveManifest, writeImmutable } from "../files/remote";
import type { SyncFile } from "../files/types";
import type { IndexedDBStore } from "../store/runtime";
import type { Manifest } from "../types";
import { type RemoteTransport, SyncError } from "../types";
import { assert } from "../utils/codec";
import { cleanupRemote, DEFAULT_RETENTION_MS } from "./cleanup";
import { importFromRemote, readUploadBaseFiles } from "./download";
import { type RemoteConfig, resolveRemote } from "./transports";
export interface SyncOptions {
    remote?: RemoteTransport | RemoteConfig;
    /** Dataset display name; a resolver can read the latest local business metadata. */
    name?: string | (() => string | Promise<string>);
    /** Grace period for old immutable versions; defaults to 24 hours. */
    garbageRetentionMs?: number;
    /** Host override must provide the same cross-page exclusivity as Web Locks. */
    lock?: <T>(name: string, action: () => Promise<T>) => Promise<T>;
}
export class SyncEngine {
    private remote?: RemoteTransport;
    private error?: unknown;
    private cleanupError?: unknown;
    private queue: Promise<unknown> = Promise.resolve();
    private options: SyncOptions;
    private readonly store: IndexedDBStore;
    constructor(store: IndexedDBStore, options: SyncOptions = {}) {
        this.store = store;
        this.options = options;
        assert(
            Number.isSafeInteger(
                options.garbageRetentionMs ?? DEFAULT_RETENTION_MS,
            ) && (options.garbageRetentionMs ?? DEFAULT_RETENTION_MS) >= 0,
            "Invalid garbage retention period",
        );
        this.remote = resolveRemote(options.remote);
    }
    setRemote(remote?: RemoteTransport | RemoteConfig) {
        this.remote = resolveRemote(remote);
    }
    private exclusive<T>(
        action: (remote: RemoteTransport | undefined) => Promise<T>,
    ): Promise<T> {
        const remote = this.remote;
        const job = this.queue
            .catch(() => {})
            .then(async () => {
                const run = async () => {
                    // The Web Lock is authoritative. A true flag left by a closed page
                    // is safe to reclaim once this callback owns that same lock.
                    await this.store.setSyncing(true);
                    try {
                        return await action(remote);
                    } finally {
                        await this.store.setSyncing(false);
                    }
                };
                const lock =
                    this.options.lock ??
                    (async <V>(name: string, callback: () => Promise<V>) => {
                        if (!globalThis.navigator?.locks)
                            throw new SyncError(
                                "LOCK_UNAVAILABLE",
                                "Web Locks is required for safe multi-tab publishing",
                            );
                        return navigator.locks.request(name, callback);
                    });
                return lock("repo-sync:" + this.store.name, run);
            })
            .then(
                (result) => {
                    this.error = undefined;
                    return result;
                },
                (error) => {
                    this.error = error;
                    throw error;
                },
            );
        this.queue = job;
        return job;
    }
    private withRemote<T>(action: (remote: RemoteTransport) => Promise<T>) {
        return this.exclusive(async (remote) => {
            if (!remote)
                throw new SyncError(
                    "SYNC_DISABLED",
                    "No sync remote configured",
                );
            await this.store.bindRemote({ identity: remote.identity });
            return action(remote);
        });
    }
    prepareUpload(manifest: Manifest, baseFiles: readonly SyncFile[] = []) {
        return this.exclusive(async () =>
            prepareUploadFiles(
                this.store,
                await this.namedManifest(manifest),
                baseFiles,
            ),
        );
    }
    importFiles(manifest: Manifest, files: readonly SyncFile[]) {
        return this.exclusive(() =>
            importSyncFiles(this.store, manifest, files),
        );
    }
    private async namedManifest(manifest: Manifest): Promise<Manifest> {
        const configured =
            typeof this.options.name === "function"
                ? await this.options.name()
                : this.options.name;
        const name = configured ?? manifest.name ?? this.store.name;
        assert(
            typeof name === "string" && !!name.trim(),
            "Invalid repository name",
        );
        return { ...manifest, name: name.trim() };
    }
    private async pushTo(remote: RemoteTransport) {
        for (let attempt = 0; attempt < 8; attempt++) {
            const { value, etag } = await importFromRemote(this.store, remote);
            const snapshot = await this.store.exportPending(value);
            const named = await this.namedManifest(value);
            const bases = await readUploadBaseFiles(remote, value, snapshot);
            const plan = await prepareUploadFiles(
                this.store,
                named,
                bases,
                snapshot,
            );
            if (!plan && etag !== undefined && value.name === named.name)
                return;
            await remote.verify?.();
            await remote.mkdir("");
            if (plan) {
                await remote.mkdir("chunks");
                for (const file of plan.files)
                    await writeImmutable(remote, file.file, file.bytes);
            }
            const nextManifest = plan?.manifest ?? named;
            try {
                await saveManifest(remote, nextManifest, etag);
            } catch (error) {
                if (
                    error instanceof SyncError &&
                    error.code === "PRECONDITION" &&
                    attempt < 7
                )
                    continue;
                throw error;
            }
            await importSyncFiles(this.store, nextManifest, plan?.files ?? []);
            return;
        }
    }
    pull() {
        return this.withRemote(async (remote) => {
            await importFromRemote(this.store, remote);
        });
    }
    sync() {
        return this.withRemote(async (remote) => {
            await this.pushTo(remote);
            try {
                await cleanupRemote(remote, this.options.garbageRetentionMs);
                this.cleanupError = undefined;
            } catch (error) {
                this.cleanupError = error;
            }
        });
    }
    async getStatus() {
        const { state, records } = await this.store.snapshot();
        return {
            running: state.isSyncing,
            error: this.error,
            cleanupError: this.cleanupError,
            state,
            dirty: records.some((r) => r._sync.dirty),
            conflicts: records.filter((r) => r._sync.conflicted).length,
        };
    }
    getWriters() {
        return this.withRemote(async (remote) =>
            [
                ...new Set(
                    (await readManifest(remote)).value.files.map(
                        (c) => c.writerId,
                    ),
                ),
            ].sort(),
        );
    }
    cleanup() {
        return this.withRemote(async (remote) => {
            try {
                const result = await cleanupRemote(
                    remote,
                    this.options.garbageRetentionMs,
                );
                this.cleanupError = undefined;
                return result;
            } catch (error) {
                this.cleanupError = error;
                throw error;
            }
        });
    }
}
