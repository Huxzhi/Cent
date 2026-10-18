import { useEffect } from "react";
import { useStore } from "zustand";
import { loadStorageAPI } from "../api/storage/dynamic";
import { accountingStore } from "../store/accounting";
import { accountingBooks } from "../sync/accounting";

/** 页面响应 SDK 账本事件；聚焦或联网时同步。 */
export function useAccountingSync() {
    const current = useStore(accountingStore, (state) => state.current);
    const id = current?.book.id;
    const remoteId = current?.remoteId;
    const provider = current?.remoteProvider ?? "webdav";
    useEffect(() => {
        if (!id) return;
        let disposed = false;
        let requested = false;
        let reloading = false;
        const reload = async () => {
            requested = true;
            if (reloading) return;
            reloading = true;
            try {
                // Imports can commit many revisions while a refresh is queued.
                // Read again if another commit arrives during the current read.
                while (requested && !disposed) {
                    requested = false;
                    await accountingStore
                        .getState()
                        .reload()
                        .catch(() => {});
                }
            } finally {
                reloading = false;
            }
        };
        const unsubscribe = accountingBooks.onChange(({ bookId }) => {
            if (bookId === accountingStore.getState().current?.book.id)
                void reload();
        });
        const onFocus = () => void reload();
        window.addEventListener("focus", onFocus);
        return () => {
            disposed = true;
            unsubscribe();
            window.removeEventListener("focus", onFocus);
        };
    }, [id]);
    useEffect(() => {
        if (!id || !remoteId) return;
        let disposed = false;
        const pull = () => {
            if (disposed) return;
            void loadStorageAPI()
                .then(({ StorageAPI }) => {
                    const sync = StorageAPI.books;
                    if (!sync || disposed || StorageAPI.type !== provider)
                        return;
                    return accountingStore
                        .getState()
                        .synchronize((book) =>
                            book.book.id === id
                                ? sync.sync(id)
                                : Promise.resolve(book),
                        );
                })
                .catch(() => {});
        };
        window.addEventListener("online", pull);
        window.addEventListener("focus", pull);
        pull();
        return () => {
            disposed = true;
            window.removeEventListener("online", pull);
            window.removeEventListener("focus", pull);
        };
    }, [id, remoteId, provider]);
}
