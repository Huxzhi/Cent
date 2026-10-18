import {
    createGitHubTransport,
    type GitHubOptions,
    type RemoteTransport,
} from "@glink25/sync-sdk";

export type AccountingGitHubConfig = Pick<
    GitHubOptions,
    "owner" | "repo" | "token" | "branch" | "path"
>;
export function createAccountingGitHubRemote(config: AccountingGitHubConfig) {
    const options = { ...config, path: config.path ?? "cent/repo-v6" };
    const root = createGitHubTransport(options);
    const transports = new Map<string, RemoteTransport>();
    return {
        provider: "github" as const,
        identity: root.identity,
        check: () => root.check(),
        list: async () =>
            (await root.listDirectories()).filter((id) =>
                /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(id),
            ),
        transport(id: string): RemoteTransport {
            if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(id))
                throw new Error("远端账本 ID 无效。");
            let transport = transports.get(id);
            if (!transport) {
                transport = createGitHubTransport({
                    ...options,
                    path: [options.path, id].filter(Boolean).join("/"),
                });
                transports.set(id, transport);
            }
            return transport;
        },
    };
}
