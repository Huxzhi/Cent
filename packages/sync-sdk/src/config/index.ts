import type { IndexedDBStore } from "../store/runtime";
export type Configuration = Pick<IndexedDBStore, "getState" | "bindRemote"> & {
    get: IndexedDBStore["getLocal"];
    set: IndexedDBStore["setLocal"];
};

export function createConfiguration(store: IndexedDBStore): Configuration {
    return {
        getState: () => store.getState(),
        bindRemote: (binding) => store.bindRemote(binding),
        get<T>(key: string) {
            return store.getLocal<T>(key);
        },
        set: (key, value) => store.setLocal(key, value),
    };
}
