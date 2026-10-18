import type { StateVersion } from "../types";
import { isStateVersion, stateVersion } from "../utils/version";
export interface RecordKey {
    collection: string;
    id: string;
}

export interface ChangeEvent {
    /** external means another connection to this database (usually another tab). */
    source: "local" | "remote" | "external";
    keys: RecordKey[];
    /** Committed sequence pair; a reload hint, not a delivery cursor. */
    version: StateVersion;
}

export type ChangeListener = (event: ChangeEvent) => void | Promise<void>;

/** Notifications are hints to re-read IndexedDB, never another copy of the data. */
export class RecordChanges {
    private listeners = new Set<ChangeListener>();
    private channel?: BroadcastChannel;
    private closed = false;

    constructor(databaseName: string) {
        try {
            if (typeof BroadcastChannel === "undefined") return;
            this.channel = new BroadcastChannel(
                `causal-sync:changes:${databaseName}`,
            );
            // Node-based hosts should not stay alive just for notifications.
            (
                this.channel as BroadcastChannel & { unref?: () => void }
            ).unref?.();
            this.channel.onmessage = ({ data }: MessageEvent<unknown>) => {
                if (!data || typeof data !== "object") return;
                const message = data as Record<string, unknown>;
                if (
                    message.protocol !== 1 ||
                    !isStateVersion(message.version) ||
                    !Array.isArray(message.keys) ||
                    !message.keys.length ||
                    !message.keys.every(
                        (key) =>
                            key &&
                            typeof key.collection === "string" &&
                            typeof key.id === "string",
                    )
                )
                    return;
                this.dispatch({
                    source: "external",
                    version: stateVersion(message.version),
                    keys: message.keys.map(({ collection, id }) => ({
                        collection,
                        id,
                    })),
                });
            };
        } catch {
            // Restricted/unsupported hosts still get local subscriptions.
            this.channel?.close();
            this.channel = undefined;
        }
    }

    onChange(listener: ChangeListener) {
        if (!this.closed) this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    emit(source: "local" | "remote", keys: RecordKey[], version: StateVersion) {
        if (this.closed || !keys.length) return;
        const unique = [
            ...new Map(
                keys.map((key) => [
                    JSON.stringify([key.collection, key.id]),
                    key,
                ]),
            ).values(),
        ];
        // Queue the cross-tab hint before invoking user code, which may close us.
        try {
            this.channel?.postMessage({
                protocol: 1,
                keys: unique,
                version: stateVersion(version),
            });
        } catch {}
        this.dispatch({ source, keys: unique, version: stateVersion(version) });
    }

    private dispatch(event: ChangeEvent) {
        if (this.closed) return;
        for (const listener of [...this.listeners]) {
            try {
                // Isolate both mutations and sync/async failures between listeners.
                void Promise.resolve(listener(structuredClone(event))).catch(
                    () => {},
                );
            } catch {}
        }
    }

    close() {
        this.closed = true;
        this.listeners.clear();
        this.channel?.close();
        this.channel = undefined;
    }
}
