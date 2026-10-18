import { Scheduler } from "../../database/scheduler";
import { type AccountingBooks, accountingBooks } from "../../sync/accounting";
import type { SyncEndpoint } from "./type";

/** Endpoints configure the SDK-backed book service and schedule synchronization. */
export function createBookEndpoint({
    provider,
    books = accountingBooks,
}: {
    provider: "offline" | "webdav" | "github";
    books?: AccountingBooks;
}): Omit<SyncEndpoint, "deleteBook"> {
    if (provider === "offline") books.setRemote(undefined);
    const scheduler = new Scheduler((signal) => books.syncAll(signal));
    scheduler.onProcess((finished) => {
        void finished.catch(() => {});
    });
    const unsupported = async () => {
        throw new Error(
            "Legacy Bill storage is not supported; use SDK book operations",
        );
    };
    const user = { id: "me", name: "Me", avatar_url: "/icon.png" };
    return {
        books,
        logout: async () => {},
        getUserInfo: async () => user,
        getCollaborators: async () => [user],
        fetchAllBooks: () =>
            books.provider ? books.fetchRemoteBooks() : books.listBooks(),
        createBook: unsupported,
        initBook: unsupported,
        batch: unsupported,
        getMeta: unsupported,
        getAllItems: unsupported,
        onChange: () => () => {},
        getIsNeedSync: () => books.getIsNeedSync(),
        onSync: (listener) => {
            const stopScheduled = scheduler.onProcess(listener);
            const stopAutomatic = books.onSync(listener);
            return () => {
                stopScheduled();
                stopAutomatic();
            };
        },
        toSync: () => scheduler.schedule(),
        forceNeedSync: () => {
            void scheduler.schedule().catch(() => {});
        },
    };
}
