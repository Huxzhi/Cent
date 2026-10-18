import { ACTIVE_BOOK_KEY } from "../../../store/accounting";
import { accountingBooks } from "../../../sync/accounting";
import {
    type AccountingGitHubConfig,
    createAccountingGitHubRemote,
} from "../../../sync/github";
import { createBookEndpoint } from "../shared";
import type { SyncEndpointFactory } from "../type";

const key = "github-sync-config";
const getConfig = (): AccountingGitHubConfig | undefined => {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : undefined;
};
export const GitHubEndpoint: SyncEndpointFactory = {
    type: "github",
    name: "GitHub",
    login: async ({ modal }) => {
        const config = await modal.githubAuth({
            ...getConfig(),
            check: async (data) => {
                await createAccountingGitHubRemote(data).check();
            },
        });
        if (!config) return;
        localStorage.setItem(key, JSON.stringify(config));
        localStorage.setItem("SYNC_ENDPOINT", "github");
        localStorage.removeItem(ACTIVE_BOOK_KEY);
        location.reload();
    },
    init: ({ modal }) => {
        const config = getConfig();
        if (!config) throw new Error("请先配置 GitHub 同步。");
        accountingBooks.setRemote(createAccountingGitHubRemote(config));
        const user = {
            id: config.owner,
            name: config.owner,
            avatar_url: "/icon.png",
        };
        return {
            ...createBookEndpoint({ provider: "github" }),
            getUserInfo: async () => user,
            getCollaborators: async () => [user],
            deleteBook: async () => {
                await modal.prompt({
                    title: "请在 GitHub 仓库中手动删除对应账本目录。",
                });
            },
        };
    },
};
