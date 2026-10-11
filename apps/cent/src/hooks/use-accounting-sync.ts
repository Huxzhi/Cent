import { useEffect } from "react";
import { useStore } from "zustand";
import { loadStorageAPI } from "../api/storage/dynamic";
import { accountingStore } from "../store/accounting";

/** 已由用户关联的账本保存后同步；未关联的本地账本保持离线可用。 */
export function useAccountingSync() {
    const current = useStore(accountingStore, (state) => state.current);
    const id = current?.book.id;
    const revision = current?.book.revision;
    const remoteId = current?.remoteId;
    const pending = current?.pendingSync;
    useEffect(() => {
        if (!id || revision === undefined || !remoteId || !pending) return;
        void loadStorageAPI()
            .then(({ StorageAPI }) => {
                if (!StorageAPI.accounting) return;
                const sync = StorageAPI.accounting;
                return accountingStore
                    .getState()
                    .synchronize((book) =>
                        book.book.id === id
                            ? sync.syncBook(id)
                            : Promise.resolve(book),
                    );
            })
            .catch(() => {});
    }, [id, revision, remoteId, pending]);
    useEffect(() => {
        if (!id || !remoteId) return;
        let disposed = false;
        let unsubscribe: (() => void) | undefined;
        const pull = () => {
            if (disposed) return;
            void loadStorageAPI()
                .then(({ StorageAPI }) => {
                    const sync = StorageAPI.accounting;
                    if (!sync || disposed) return;
                    return accountingStore
                        .getState()
                        .synchronize((book) =>
                            book.book.id === id
                                ? sync.syncBook(id)
                                : Promise.resolve(book),
                        );
                })
                .catch(() => {});
        };
        void loadStorageAPI().then(({ StorageAPI }) => {
            if (disposed) return;
            unsubscribe = StorageAPI.accounting?.onChange(({ bookId }) => {
                if (bookId === accountingStore.getState().current?.book.id)
                    void accountingStore
                        .getState()
                        .reload()
                        .catch(() => {});
            });
        });
        window.addEventListener("online", pull);
        window.addEventListener("focus", pull);
        pull();
        return () => {
            disposed = true;
            unsubscribe?.();
            window.removeEventListener("online", pull);
            window.removeEventListener("focus", pull);
        };
    }, [id, remoteId]);
}
