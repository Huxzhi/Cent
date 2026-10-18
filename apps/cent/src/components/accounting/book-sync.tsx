import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { loadStorageAPI } from "../../api/storage/dynamic";
import { useIntl } from "../../locale";
import { accountingStore } from "../../store/accounting";
import { Button } from "../ui/button";
import { FormError, selectClass, useFormAction } from "./shared";

export default function AccountingBookSync() {
    const t = useIntl();
    const { current, busy, syncing, syncError } = useStore(accountingStore);
    const { error, submitting, run } = useFormAction();
    const [remoteBooks, setRemoteBooks] = useState<
        { id: string; name: string }[]
    >([]);
    const [remoteId, setRemoteId] = useState("");
    const [listed, setListed] = useState(false);
    const [provider, setProvider] = useState("");
    useEffect(() => {
        let active = true;
        void loadStorageAPI()
            .then(({ StorageAPI }) => {
                if (active) setProvider(StorageAPI.name);
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, []);
    const api = async () => {
        const { StorageAPI } = await loadStorageAPI();
        if (!StorageAPI.books.provider)
            throw new Error("请先配置 WebDAV 或 GitHub 同步。本地账本已保存。");
        return StorageAPI.books;
    };
    if (!current) return null;
    return (
        <fieldset className="border rounded-md p-3 space-y-3">
            <legend className="px-1 text-sm">
                {provider
                    ? t("accounting-sync-provider", { provider })
                    : t("accounting-sync-title")}
            </legend>
            <p className="text-xs text-muted-foreground">
                {t("accounting-sync-help")}
            </p>
            <div className="flex gap-2 flex-wrap">
                <Button
                    variant="outline"
                    disabled={busy || submitting || syncing}
                    onClick={() =>
                        void run(async () => {
                            const remote = await api();
                            const { StorageAPI } = await loadStorageAPI();
                            if (
                                current.remoteId &&
                                (current.remoteProvider ?? "webdav") !==
                                    StorageAPI.type
                            )
                                throw new Error(
                                    t("accounting-sync-provider-mismatch", {
                                        provider:
                                            current.remoteProvider ?? "webdav",
                                    }),
                                );
                            await accountingStore
                                .getState()
                                .synchronize((book) =>
                                    book.remoteId
                                        ? remote.sync(book.book.id)
                                        : remote.publishBook(book.book.id),
                                );
                        })
                    }
                >
                    {t(
                        current.remoteId
                            ? "accounting-sync-now"
                            : "accounting-sync-publish",
                    )}
                </Button>
                <Button
                    variant="outline"
                    disabled={busy || submitting}
                    onClick={() =>
                        void run(async () => {
                            const books = await (
                                await api()
                            ).fetchRemoteBooks();
                            setRemoteBooks(books);
                            setListed(true);
                            setRemoteId(books[0]?.id ?? "");
                        })
                    }
                >
                    {t("accounting-sync-remote-books")}
                </Button>
            </div>
            {listed && remoteBooks.length === 0 && (
                <p className="text-xs text-muted-foreground">
                    {t("accounting-sync-no-remote")}
                </p>
            )}
            {remoteBooks.length > 0 && (
                <div className="flex gap-2">
                    <select
                        aria-label={t("accounting-sync-remote-book")}
                        className={`${selectClass} min-w-0 flex-1`}
                        value={remoteId}
                        onChange={(event) => setRemoteId(event.target.value)}
                        disabled={busy || submitting}
                    >
                        {remoteBooks.map((book) => (
                            <option key={book.id} value={book.id}>
                                {book.name}
                            </option>
                        ))}
                    </select>
                    <Button
                        disabled={busy || submitting || syncing || !remoteId}
                        onClick={() =>
                            void run(async () => {
                                const remote = await api();
                                await accountingStore
                                    .getState()
                                    .synchronize(() =>
                                        remote.importBook(remoteId),
                                    );
                            })
                        }
                    >
                        {t("accounting-sync-open")}
                    </Button>
                </div>
            )}
            <FormError error={error ?? syncError} />
        </fieldset>
    );
}
