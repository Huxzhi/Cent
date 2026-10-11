import type { Modal } from "@/components/modal";
import { accountingRepository } from "@/database/accounting";
import { Scheduler } from "@/database/scheduler";
import { BillIndexedDBStorage } from "@/database/storage";
import { t } from "@/locale";
import { createTidal } from "@/tidal";
import { createGithubSyncer } from "@/tidal/github";
import type { ZenPost } from "@/zen/types";
import {
    ACCOUNTING_ENTRY_NAME,
    ACCOUNTING_REPO_PREFIX,
    createAccountingSync,
    emptyAccountingRemoteMeta,
} from "../../../tidal/accounting";
import type { SyncEndpointFactory } from "../type";
import { createLoginAPI } from "./login";

const ZEN_ENTRY_NAME = "zen";

const config = {
    repoPrefix: ACCOUNTING_REPO_PREFIX,
    entryName: ACCOUNTING_ENTRY_NAME,
    orderKeys: ["time"],
};

const LoginAPI = createLoginAPI();

const manuallyLogin = async ({ modal }: { modal: Modal }) => {
    const token = await modal.prompt({
        title: t("please-enter-your-github-token"),
        input: { type: "text" },
    });
    if (!token) {
        return;
    }
    LoginAPI.manuallySetToken(token as string);
    location.reload();
};

export const GithubEndpoint: SyncEndpointFactory = {
    type: "github",
    name: "Github",
    login: LoginAPI.login,
    manuallyLogin,
    init: ({ modal }) => {
        LoginAPI.afterLogin();
        const syncer = createGithubSyncer({
            auth: LoginAPI.getToken,
            entryName: config.entryName,
            repoPrefix: config.repoPrefix,
            initialMeta: emptyAccountingRemoteMeta,
        });
        const repo = createAccountingSync(syncer, accountingRepository);
        const unsupportedBillOperation = async () => {
            throw new Error(
                "Legacy Bill storage is not supported by accounting GitHub sync",
            );
        };
        const zenRepo = createTidal<ZenPost>({
            storageFactory: (name) =>
                new BillIndexedDBStorage(`book-${name}--${ZEN_ENTRY_NAME}`),
            entryName: ZEN_ENTRY_NAME,
            syncerFactory: () =>
                createGithubSyncer({
                    auth: LoginAPI.getToken,
                    entryName: ZEN_ENTRY_NAME,
                    repoPrefix: config.repoPrefix,
                }),
        });

        const inviteForBook = async (bookId: string) => {
            await modal.prompt({ title: t("invite-tip") });
            window.open(
                `https://github.com/${bookId}/settings/access`,
                "_blank",
            );
        };

        const deleteBook = async (bookId: string) => {
            await modal.prompt({ title: t("delete-book-tip") });
            window.open(`https://github.com/${bookId}/settings`, "_blank");
            return Promise.reject();
        };

        // ledger 与 zen 顺序同步：避免对同一 git ref 并发提交导致 non-fast-forward
        const scheduler = new Scheduler(async (signal) => {
            for (const book of await accountingRepository.listBooks()) {
                const local = await accountingRepository.loadBook(book.id);
                if (local.remoteId)
                    await repo.syncBook(book.id, undefined, signal);
            }
            const [zenFinished, cancelZen] = zenRepo.sync();
            signal.onabort = cancelZen;
            await zenFinished;
        });

        return {
            accounting: repo,
            logout: async () => {
                await zenRepo.detach();
            },
            getUserInfo: syncer.getUserInfo,
            getCollaborators: syncer.getCollaborators,
            getOnlineAsset: (src, store) => syncer.getAsset(src, store),

            fetchAllBooks: async (...args) => {
                return repo.fetchAllBooks(...args);
            },
            createBook: unsupportedBillOperation,
            initBook: unsupportedBillOperation,
            deleteBook,
            inviteForBook,

            batch: unsupportedBillOperation,
            getMeta: unsupportedBillOperation,
            getAllItems: unsupportedBillOperation,
            // 旧 Bill 订阅不能消费复式账本事件；新页面使用 accounting.onChange。
            onChange: () => () => {},

            batchZen: async (...args) => {
                await zenRepo.batch(...args);
                scheduler.schedule();
            },
            getAllZenItems: zenRepo.getAllItems,
            onZenChange: zenRepo.onChange,

            getIsNeedSync: async () =>
                (
                    await Promise.all(
                        (
                            await accountingRepository.listBooks()
                        ).map((book) => accountingRepository.loadBook(book.id)),
                    )
                ).some((book) => book.remoteId && book.pendingSync) ||
                (await zenRepo.hasStashes()),
            onSync: scheduler.onProcess.bind(scheduler),
            toSync: scheduler.schedule.bind(scheduler),

            forceNeedSync: () => {
                void scheduler.schedule();
            },
        };
    },
};
