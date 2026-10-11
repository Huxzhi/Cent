import { useState } from "react";
import { useStore } from "zustand";
import { loadStorageAPI } from "../../api/storage/dynamic";
import { useIntl } from "../../locale";
import { accountingStore } from "../../store/accounting";
import { Button } from "../ui/button";
import { FormError, selectClass, useFormAction } from "./shared";

export default function AccountingGitHubSync() {
    const t = useIntl();
    const { current, busy } = useStore(accountingStore);
    const { error, submitting, run } = useFormAction();
    const [remoteBooks, setRemoteBooks] = useState<
        { id: string; name: string }[]
    >([]);
    const [remoteId, setRemoteId] = useState("");
    const api = async () => {
        const { StorageAPI } = await loadStorageAPI();
        if (!StorageAPI.accounting)
            throw new Error(t("accounting-sync-github-only"));
        return StorageAPI.accounting;
    };
    if (!current) return null;
    return (
        <fieldset className="border rounded-md p-3 space-y-3">
            <legend className="px-1 text-sm">
                {t("accounting-sync-github")}
            </legend>
            <p className="text-xs text-muted-foreground">
                {t("accounting-sync-help")}
            </p>
            {current.remoteId && (
                <p className="text-xs break-all">{current.remoteId}</p>
            )}
            <div className="flex gap-2 flex-wrap">
                <Button
                    variant="outline"
                    disabled={busy || submitting}
                    onClick={() =>
                        void run(async () => {
                            const remote = await api();
                            await accountingStore
                                .getState()
                                .synchronize((book) =>
                                    book.remoteId
                                        ? remote.syncBook(book.book.id)
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
                            const books = await (await api()).fetchAllBooks();
                            setRemoteBooks(books);
                            setRemoteId(books[0]?.id ?? "");
                        })
                    }
                >
                    {t("accounting-sync-remote-books")}
                </Button>
            </div>
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
                        disabled={busy || submitting || !remoteId}
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
            <FormError error={error} />
        </fieldset>
    );
}
