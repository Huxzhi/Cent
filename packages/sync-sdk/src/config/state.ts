import { type DatabaseConnection, localKey } from "../store/database";
import { type RemoteBinding, SyncError, type SyncState } from "../types";
import { assert } from "../utils/codec";
export async function getState(connection: DatabaseConnection) {
    return (await (
        await connection.db
    ).get("config", "syncState")) as SyncState;
}

/** Caller must hold the database sync lock; this does not change either data sequence. */
export async function setSyncing(
    connection: DatabaseConnection,
    isSyncing: boolean,
) {
    const tx = (await connection.db).transaction("config", "readwrite");
    try {
        const state = (await tx.store.get("syncState")) as SyncState;
        await tx.store.put({ ...state, isSyncing });
        await tx.done;
    } catch (error) {
        try {
            tx.abort();
        } catch {}
        await tx.done.catch(() => {});
        throw error;
    }
}

export async function bindRemote(
    connection: DatabaseConnection,
    binding:
        | RemoteBinding
        | ((current?: Readonly<RemoteBinding>) => RemoteBinding),
) {
    const tx = (await connection.db).transaction("config", "readwrite");
    try {
        const state = (await tx.store.get("syncState")) as SyncState;
        const next =
            typeof binding === "function"
                ? binding(structuredClone(state.remote))
                : binding;
        assert(
            next && typeof next.identity === "string" && !!next.identity,
            "Invalid remote identity",
        );
        for (const field of ["provider", "path"] as const)
            assert(
                next[field] === undefined ||
                    (typeof next[field] === "string" && !!next[field]),
                "Invalid remote binding",
            );
        const current = state.remote;
        if (
            current &&
            (current.identity !== next.identity ||
                ["provider", "path"].some((field) => {
                    const key = field as "provider" | "path";
                    return (
                        current[key] !== undefined &&
                        next[key] !== undefined &&
                        current[key] !== next[key]
                    );
                }))
        )
            throw new SyncError(
                "REMOTE_MISMATCH",
                "Database belongs to another remote; open a separate local database",
            );
        const provider = next.provider ?? current?.provider;
        const path = next.path ?? current?.path;
        const remote: RemoteBinding = {
            identity: next.identity,
            ...(provider === undefined ? {} : { provider }),
            ...(path === undefined ? {} : { path }),
        };
        state.remote = remote;
        await tx.store.put(state);
        await tx.done;
        return remote;
    } catch (error) {
        try {
            tx.abort();
        } catch {}
        await tx.done.catch(() => {});
        throw error;
    }
}

export async function getLocal<T>(connection: DatabaseConnection, key: string) {
    const entry = await (await connection.db).get("config", localKey(key));
    return entry && "value" in entry ? (entry.value as T) : undefined;
}

export async function setLocal(
    connection: DatabaseConnection,
    key: string,
    value: unknown,
) {
    await (await connection.db).put("config", { key: localKey(key), value });
}
