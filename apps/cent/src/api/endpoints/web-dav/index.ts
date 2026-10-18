import type { WebDAVEdit } from "@/components/modal/web-dav";
import { ACTIVE_BOOK_KEY } from "../../../store/accounting";
import { accountingBooks } from "../../../sync/accounting";
import {
    checkAccountingWebDAVConfig,
    createAccountingWebDAVRemote,
} from "../../../sync/webdav";
import { createBookEndpoint } from "../shared";
import type { SyncEndpointFactory } from "../type";

const key = "web-dav-config";
const getAuth = () => {
    const data = localStorage.getItem(key);
    return data ? (JSON.parse(data) as WebDAVEdit) : undefined;
};
export const WebDAVEndpoint: SyncEndpointFactory = {
    type: "webdav",
    name: "WebDAV",
    login: async ({ modal }) => {
        const auth = await modal.webDavAuth({
            ...getAuth(),
            check: async (data) => {
                await checkAccountingWebDAVConfig(data).catch((error) => {
                    modal.toast.error(
                        (error as Error)?.message ?? JSON.stringify(error),
                    );
                    throw error;
                });
            },
        });
        if (!auth) return;
        localStorage.setItem("SYNC_ENDPOINT", "webdav");
        localStorage.setItem(key, JSON.stringify(auth));
        localStorage.removeItem(ACTIVE_BOOK_KEY);
        location.reload();
    },
    init: ({ modal }) => {
        const auth = getAuth();
        if (!auth) throw new Error("WebDAV auth not found");
        accountingBooks.setRemote(createAccountingWebDAVRemote(auth));
        const user = {
            id: auth.customUserName || auth.username,
            name: auth.customUserName || auth.username,
            avatar_url: "/icon.png",
        };
        return {
            ...createBookEndpoint({
                provider: "webdav",
            }),
            getUserInfo: async () => user,
            getCollaborators: async () => [user],
            deleteBook: async () => {
                await modal.prompt({
                    title: "Please delete this folder on your WebDAV server/app manually",
                });
            },
        };
    },
};
