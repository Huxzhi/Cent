import { t } from "@/locale";
import { createBookEndpoint } from "../shared";
import type { SyncEndpointFactory } from "../type";

export const OfflineEndpoint: SyncEndpointFactory = {
    type: "offline",
    name: "offline",
    login: () => {
        localStorage.setItem("SYNC_ENDPOINT", "offline");
        location.reload();
    },
    init: ({ modal }) => ({
        ...createBookEndpoint({ provider: "offline" }),
        deleteBook: async () => {
            await modal.prompt({ title: t("delete-book-offline-tip") });
            throw new Error("Book deletion is not supported by this interface");
        },
    }),
};
