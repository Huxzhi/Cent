import type { SyncEngine } from "./engine";

export type { SyncOptions } from "./engine";
export type SyncControls = Pick<
    SyncEngine,
    "sync" | "pull" | "cleanup" | "setRemote" | "getStatus" | "getWriters"
>;

export function createSyncControls(engine: SyncEngine): SyncControls {
    return {
        sync: () => engine.sync(),
        pull: () => engine.pull(),
        cleanup: () => engine.cleanup(),
        setRemote: (remote) => engine.setRemote(remote),
        getStatus: () => engine.getStatus(),
        getWriters: () => engine.getWriters(),
    };
}
