import { wrap } from "comlink";
import modal from "@/components/modal";
import { GitHubEndpoint } from "../endpoints/github";
import { OfflineEndpoint } from "../endpoints/offline";
import { WebDAVEndpoint } from "../endpoints/web-dav";
import { getSelectedSyncEndpoint } from "./selection";
import type { Exposed } from "./worker";
import DeferredWorker from "./worker?worker";

const APIS = {
    offline: OfflineEndpoint,
    webdav: WebDAVEndpoint,
    github: GitHubEndpoint,
};

const type = getSelectedSyncEndpoint() ?? "offline";
const _StorageAPI = APIS[type];
const actions = _StorageAPI.init({ modal });

export const StorageAPI = {
    name: _StorageAPI.name,
    type: _StorageAPI.type,
    ...actions,
    loginWith: (type: string) => {
        if (type === "offline") {
            return OfflineEndpoint.login({ modal });
        }
        if (type === "webdav") {
            return WebDAVEndpoint.login({ modal });
        }
        if (type === "github") return GitHubEndpoint.login({ modal });
    },
};

// ComlinkSharedWorker

const workerInstance = new DeferredWorker({
    /* normal Worker options*/
});
const StorageDeferredAPI = wrap<Exposed>(workerInstance);

export { StorageDeferredAPI };
