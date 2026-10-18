import {
    type DataEntry,
    type QueryCursor,
    type QueryOptions,
    type StoredRecord,
    SyncError,
    type SyncState,
} from "../types";
import { assert } from "../utils/codec";
import {
    isStateVersion,
    sameStateVersion,
    stateVersion,
} from "../utils/version";
import type { DatabaseConnection } from "./database";
import { projectEntry } from "./entry";
export async function get<T = unknown>(
    connection: DatabaseConnection,
    collection: string,
    id: string,
) {
    return (await getMany<T>(connection, collection, [id]))[0];
}

export async function getMany<T = unknown>(
    connection: DatabaseConnection,
    collection: string,
    ids: string[],
) {
    const tx = (await connection.db).transaction(["records", "config"]);
    const state = (await tx
        .objectStore("config")
        .get("syncState")) as SyncState;
    const entries = await Promise.all(
        ids.map((id) => tx.objectStore("records").get([collection, id])),
    );
    await tx.done;
    return entries.map((entry) =>
        projectEntry<T>(entry as DataEntry<T> | undefined, state),
    );
}

export async function snapshot(connection: DatabaseConnection) {
    const tx = (await connection.db).transaction(["records", "config"]);
    const entries = await tx.objectStore("records").getAll();
    const state = (await tx
        .objectStore("config")
        .get("syncState")) as SyncState;
    await tx.done;
    return {
        records: entries.map((entry) => projectEntry(entry, state)!),
        state,
    };
}

export async function query<T = unknown>(
    connection: DatabaseConnection,
    options: QueryOptions,
) {
    const {
        collection,
        orderBy = "id",
        direction = "desc",
        limit = 200,
        cursor,
        from = -Number.MAX_VALUE,
        to = Number.MAX_VALUE,
    } = options;
    assert(
        Number.isInteger(limit) &&
            limit > 0 &&
            limit <= 10000 &&
            Number.isFinite(from) &&
            Number.isFinite(to) &&
            from <= to &&
            ["asc", "desc"].includes(direction) &&
            ["id", "time"].includes(orderBy),
        "Invalid query limits",
    );
    assert(
        orderBy === "time" ||
            (options.from === undefined && options.to === undefined),
        "Time bounds require orderBy=time",
    );
    const tx = (await connection.db).transaction(["records", "config"]);
    const state = (await tx
        .objectStore("config")
        .get("syncState")) as SyncState;
    if (
        cursor &&
        (cursor.database !== connection.name ||
            cursor.collection !== collection ||
            cursor.orderBy !== orderBy ||
            cursor.direction !== direction ||
            !isStateVersion(cursor.version) ||
            !sameStateVersion(cursor.version, state) ||
            cursor.from !== from ||
            cursor.to !== to)
    )
        throw new SyncError(
            "CURSOR_EXPIRED",
            "Query changed; start pagination again",
        );
    if (cursor)
        assert(
            typeof cursor.id === "string" &&
                !!cursor.id &&
                (orderBy !== "time" || Number.isFinite(cursor.time)),
            "Invalid query cursor",
        );
    const ascending = direction === "asc";
    const position =
        cursor &&
        (orderBy === "time"
            ? [collection, cursor.time!, cursor.id]
            : [collection, cursor.id]);
    const lower =
        position && ascending
            ? position
            : orderBy === "time"
              ? [collection, from, ""]
              : [collection, ""];
    const upper =
        position && !ascending
            ? position
            : orderBy === "time"
              ? [collection, to, []]
              : [collection, []];
    const range = IDBKeyRange.bound(
        lower,
        upper,
        !!cursor && ascending,
        !!cursor && !ascending,
    );
    const store = tx.objectStore("records");
    const source = orderBy === "time" ? store.index("time") : store;
    let current = await source.openCursor(range, ascending ? "next" : "prev");
    const page: { record: StoredRecord<T>; time?: number }[] = [];
    while (current && page.length <= limit) {
        const record = projectEntry<T>(current.value as DataEntry<T>, state)!;
        if (record.value !== null || record._sync.conflicted)
            page.push({
                record,
                ...(orderBy === "time" ? { time: Number(current.key[1]) } : {}),
            });
        if (page.length > limit) break;
        current = await current.continue();
    }
    await tx.done;
    const more = page.length > limit;
    if (more) page.pop();
    const last = page.at(-1);
    const next: QueryCursor | undefined =
        more && last
            ? {
                  database: connection.name,
                  collection,
                  orderBy,
                  direction,
                  version: stateVersion(state),
                  id: last.record.id,
                  ...(last.time === undefined ? {} : { time: last.time }),
                  from,
                  to,
              }
            : undefined;
    return { records: page.map((item) => item.record), cursor: next };
}

export async function getConflicts(connection: DatabaseConnection) {
    return (await snapshot(connection)).records.filter(
        (r) => r._sync.conflicted,
    );
}
