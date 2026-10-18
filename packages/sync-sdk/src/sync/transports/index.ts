import type { RemoteTransport } from "../../types";
import { createGitHubTransport, type GitHubOptions } from "./github";
import { createWebDAVTransport, type WebDAVOptions } from "./webdav";

export type RemoteConfig =
    | ({ provider: "github" } & GitHubOptions)
    | ({ provider: "webdav" } & WebDAVOptions);

export function createRemoteTransport(config: RemoteConfig): RemoteTransport {
    switch (config.provider) {
        case "github":
            return createGitHubTransport(config);
        case "webdav":
            return createWebDAVTransport(config);
        default:
            throw new Error("Unsupported sync provider");
    }
}
export function resolveRemote(remote?: RemoteTransport | RemoteConfig) {
    return (
        remote &&
        ("provider" in remote ? createRemoteTransport(remote) : remote)
    );
}
