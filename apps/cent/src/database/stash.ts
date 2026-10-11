import { isEqual, isPlainObject, sortBy } from "lodash-es";
import { v4 } from "uuid";
import { diff, merge } from "./patch";

export type BaseItem = {
    id: string;
    [key: string]: any;
};

export type Update<T extends BaseItem> = {
    type: "update";
    timestamp: number;
    id: string;
    value: T;
    metaValue?: undefined;
    overlap?: number;
};

export type Delete<T extends BaseItem> = {
    type: "delete";
    timestamp: number;
    id: string;
    value: T["id"];
    metaValue?: undefined;
    overlap?: number;
};

export type MetaUpdate = {
    type: "meta";
    timestamp: number;
    id: string;
    value?: undefined;
    metaValue: any;
    overlap?: number;
};

export type FullAction<T extends BaseItem> = Update<T> | Delete<T> | MetaUpdate;

export type Action<T extends BaseItem> = Omit<
    FullAction<T>,
    "timestamp" | "id"
> & {
    timestamp?: number;
};

export type Full<T extends BaseItem> = T & {
    __delete_at?: number;
    __create_at: number;
    __update_at: number;
};

export type OutputType<T> = T;

export type Arrayable<T extends BaseItem> = {
    put: (...v: T[]) => Promise<void>;
    delete: (...ids: T["id"][]) => Promise<void>;
    clear: () => Promise<void>;
    toArray: (limit?: number) => Promise<T[]>;
};

export type FactoryNames =
    | typeof StashBucket.STASH_NAME
    | typeof StashBucket.ITEM_NAME;

export type ArrayableStorageFactory = <T extends BaseItem>(
    name: FactoryNames,
) => Arrayable<T>;

export type StorageFactory<V = any> = (
    name: typeof StashBucket.META_NAME | typeof StashBucket.CONFIG_NAME,
) => {
    setValue: (v: V) => Promise<void>;
    getValue: () => Promise<V | undefined>;
};

export abstract class StashStorage {
    abstract createArrayableStorage: ArrayableStorageFactory;
    abstract createStorage: StorageFactory;
    abstract clearStorages: () => Promise<void>;
    abstract dangerousClearAll: () => Promise<void>;
    static getArrableStorageNames: () => Promise<string[]>;
}

export class StashBucket<T extends BaseItem, Meta = any, Config = any> {
    static STASH_NAME = "__stashes" as const;
    static ITEM_NAME = "__items" as const;
    static META_NAME = "__meta" as const;
    static CONFIG_NAME = "__config" as const;
    private readonly factory: ArrayableStorageFactory;
    private readonly metaFactory: StorageFactory;

    constructor(factory: ArrayableStorageFactory, metaFactory: StorageFactory) {
        this.factory = factory;
        this.metaFactory = metaFactory;
    }

    // 用于存储全局信息
    get metaStorage() {
        return this.metaFactory(StashBucket.META_NAME) as ReturnType<
            StorageFactory<Meta>
        >;
    }
    // 用于存储数组增量信息
    get stashStorage() {
        return this.factory<FullAction<T>>(StashBucket.STASH_NAME);
    }
    // 用于存储完整数组
    get itemStorage() {
        return this.factory<Full<T>>(StashBucket.ITEM_NAME);
    }
    // 用于保存本地额外信息
    get configStorage() {
        return this.metaFactory(StashBucket.CONFIG_NAME) as ReturnType<
            StorageFactory<Config>
        >;
    }

    async init(items: FullAction<T>[], meta?: any) {
        if (meta !== undefined) {
            await this.metaStorage.setValue(meta);
        }
        await this.itemStorage.clear();
        await this.applyStash(items);
        const localStashes = await this.getStashes();
        await this.applyStash(localStashes);
    }

    async patch(items: FullAction<T>[], meta?: any) {
        if (meta !== undefined) {
            await this.metaStorage.setValue(meta);
        }
        // await this.itemStorage.clear()
        await this.applyStash(items);
        const localStashes = await this.getStashes();
        await this.applyStash(localStashes);
    }

    getItems(limit?: number) {
        return this.itemStorage.toArray(limit);
    }

    getStashes() {
        return this.stashStorage.toArray();
    }

    async getMeta() {
        const remoteMeta = await this.metaStorage.getValue();
        const stashes = await this.getStashes();
        const metaChange = stashes.find((v) => v.type === "meta");
        if (!metaChange) {
            return remoteMeta;
        }
        const fullMeta = mergeMeta(remoteMeta, metaChange.metaValue);
        return fullMeta;
    }

    async batch(actions: Action<T>[], overlap = false) {
        const now = Date.now();
        const fullActions = actions.map(
            (ac) =>
                ({
                    ...ac,
                    id: v4(),
                    timestamp: ac.timestamp ?? now,
                }) as FullAction<T>,
        );
        const metaOption = fullActions.find((action) => action.type === "meta");
        if (metaOption) {
            const remoteMeta = await this.metaStorage.getValue();
            metaOption.metaValue = diffMeta(
                remoteMeta ?? {},
                metaOption.metaValue,
            );
        }
        const prevActions = await this.getStashes();
        const densed = denseStashes([
            ...fullActions,
            ...(overlap ? [] : prevActions),
        ]);

        if (overlap) {
            const now = Date.now();
            densed[0].overlap = now;
            if (densed[densed.length - 1]) {
                densed[densed.length - 1].overlap = now;
            }
            if (densed[densed.length - 2]) {
                densed[densed.length - 2].overlap = now;
            }
            await this.itemStorage.clear();
        }
        await this.stashStorage.clear();
        await this.stashStorage.put(...densed);
        const stashed = await this.stashStorage.toArray();
        // apply stash
        await this.applyStash(stashed);
    }

    private async applyStash(stashed: FullAction<T>[]) {
        // Replay in timestamp order so the last action per item id wins
        // (last-write-wins). Otherwise a `delete` could remove an item that a
        // chronologically-later `update` re-created (data loss). Collapsing per
        // id also removes the put/delete race inside the Promise.all below.
        const lastById = new Map<string, Update<T> | Delete<T>>();
        for (const ac of sortBy(stashed, (a) => a.timestamp)) {
            if (ac.type === "meta") continue;
            const itemId = ac.type === "delete" ? ac.value : ac.value.id;
            lastById.set(itemId, ac);
        }
        const updates: Update<T>[] = [];
        const deletes: Delete<T>[] = [];
        for (const ac of lastById.values()) {
            if (ac.type === "update") {
                updates.push(ac);
            } else {
                deletes.push(ac);
            }
        }
        await Promise.all([
            this.itemStorage.put(
                ...updates.map((ac) => ({
                    __create_at: ac.timestamp,
                    __update_at: ac.timestamp,
                    ...ac.value,
                })),
            ),
            this.itemStorage.delete(...deletes.map((ac) => ac.value)),
        ]);
    }

    async deleteStashes(...ids: FullAction<T>["id"][]) {
        await this.stashStorage.delete(...ids);
    }
}

// 对多个相同id的操作，只保留最新的
function denseStashes<T extends BaseItem>(stashes: FullAction<T>[]) {
    const ids = new Set<string>();
    return stashes.filter((ac) => {
        const targetId =
            ac.type === "meta"
                ? "_meta"
                : ac.type === "delete"
                  ? ac.value
                  : ac.value.id;
        if (ids.has(targetId)) {
            return false;
        }
        ids.add(targetId);
        return true;
    });
}

const diffMeta = (prev: any, current: any) => {
    const diffs = diff(prev, current, { timestamp: Date.now() });
    return diffs;
};

export const mergeMeta = (prev: any, diff: any) => {
    if (diff.$$patch) {
        const result = merge(prev, diff);
        result.__updated_at = diff.$$patch.timestamp;
        delete result.$$patch;
        return result;
    }
    return diff;
};

export class StashMergeConflictError extends Error {
    readonly path: string;
    constructor(path: string) {
        super(`Sync conflict at ${path}`);
        this.path = path;
        this.name = "StashMergeConflictError";
    }
}

const missing = Symbol("missing");
// JSON 传输省略 undefined 属性；缺省字段与本地可选空字段必须使用相同语义。
function syncValue(value: unknown): any {
    if (Array.isArray(value)) return value.map(syncValue);
    if (isPlainObject(value))
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .filter(([, item]) => item !== undefined)
                .map(([key, item]) => [key, syncValue(item)]),
        );
    return value;
}
/** 三方合并：只应用相对于基线的修改；同字段冲突拒绝，不按设备时钟覆盖。 */
export function mergeStashValue(
    base: unknown,
    local: unknown,
    remote: unknown,
    path = "meta",
): any {
    return mergeSyncValue(
        syncValue(base),
        syncValue(local),
        syncValue(remote),
        path,
    );
}
function mergeSyncValue(
    base: unknown,
    local: unknown,
    remote: unknown,
    path: string,
): any {
    if (isEqual(local, remote))
        return local === missing ? missing : structuredClone(local);
    if (isEqual(base, local))
        return remote === missing ? missing : structuredClone(remote);
    if (isEqual(base, remote))
        return local === missing ? missing : structuredClone(local);
    if (
        ["updatedAt", "__update_at"].includes(path.split(".").at(-1) ?? "") &&
        typeof local === "number" &&
        typeof remote === "number"
    )
        return Math.max(local, remote);
    if (
        Array.isArray(local) &&
        Array.isArray(remote) &&
        (base === missing || Array.isArray(base)) &&
        !path.endsWith(".entries") &&
        [
            ...(base === missing ? [] : (base as unknown[])),
            ...local,
            ...remote,
        ].every((value) => isPlainObject(value) && typeof value.id === "string")
    ) {
        const index = (values: any[]) => {
            const result = new Map(values.map((value) => [value.id, value]));
            if (result.size !== values.length)
                throw new StashMergeConflictError(`${path}.duplicateId`);
            return result;
        };
        const before = index(base === missing ? [] : (base as any[])),
            ours = index(local),
            theirs = index(remote);
        return [
            ...new Set([...before.keys(), ...ours.keys(), ...theirs.keys()]),
        ]
            .sort()
            .flatMap((id) => {
                const value = mergeSyncValue(
                    before.get(id) ?? missing,
                    ours.get(id) ?? missing,
                    theirs.get(id) ?? missing,
                    `${path}[${id}]`,
                );
                return value === missing ? [] : [value];
            });
    }
    if (
        isPlainObject(local) &&
        isPlainObject(remote) &&
        (base === missing || isPlainObject(base))
    ) {
        const before =
            base === missing ? {} : (base as Record<string, unknown>);
        const ours = local as Record<string, unknown>,
            theirs = remote as Record<string, unknown>;
        const result: Record<string, unknown> = {};
        for (const key of new Set([
            ...Object.keys(before),
            ...Object.keys(ours),
            ...Object.keys(theirs),
        ])) {
            const value = mergeSyncValue(
                Object.hasOwn(before, key) ? before[key] : missing,
                Object.hasOwn(ours, key) ? ours[key] : missing,
                Object.hasOwn(theirs, key) ? theirs[key] : missing,
                `${path}.${key}`,
            );
            if (value !== missing) result[key] = value;
        }
        return result;
    }
    throw new StashMergeConflictError(path);
}

export interface StashSnapshot<T extends { id: string }, M> {
    items: T[];
    meta: M;
}
export function mergeStashSnapshots<T extends { id: string }, M>(
    base: StashSnapshot<T, M>,
    local: StashSnapshot<T, M>,
    remote: StashSnapshot<T, M>,
): StashSnapshot<T, M> {
    return {
        items: mergeStashValue(base.items, local.items, remote.items, "items"),
        meta: mergeStashValue(base.meta, local.meta, remote.meta),
    };
}

/** 待传输日志只包含相对远端快照的变更，仍使用 update/delete/meta 协议。 */
export function createStashActions<T extends BaseItem, M>(
    base: StashSnapshot<T, M>,
    next: StashSnapshot<T, M>,
    timestamp: number,
): FullAction<T>[] {
    if (!Number.isSafeInteger(timestamp) || timestamp < 0)
        throw new Error("Invalid stash timestamp");
    const before = new Map(base.items.map((item) => [item.id, item]));
    const ids = new Set(next.items.map((item) => item.id));
    return [
        ...next.items
            .filter((item) => !isEqual(before.get(item.id), item))
            .map((value) => ({
                id: crypto.randomUUID(),
                type: "update" as const,
                timestamp,
                value,
            })),
        ...base.items
            .filter((item) => !ids.has(item.id))
            .map((item) => ({
                id: crypto.randomUUID(),
                type: "delete" as const,
                timestamp,
                value: item.id,
            })),
        ...(isEqual(base.meta, next.meta)
            ? []
            : [
                  {
                      id: crypto.randomUUID(),
                      type: "meta" as const,
                      timestamp,
                      metaValue: next.meta,
                  },
              ]),
    ];
}

export function replayStashActions<T extends BaseItem>(
    actions: FullAction<T>[],
): T[] {
    const items = new Map<string, T>();
    const seen = new Map<string, FullAction<T>>();
    for (const action of [...actions].sort(
        (a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id),
    )) {
        const previous = seen.get(action.id);
        if (previous) {
            if (!isEqual(previous, action))
                throw new StashMergeConflictError(`actions[${action.id}]`);
            continue;
        }
        seen.set(action.id, action);
        if (action.type === "update") items.set(action.value.id, action.value);
        else if (action.type === "delete") items.delete(action.value);
        else throw new Error("Item chunks cannot contain metadata actions");
    }
    return [...items.values()];
}
