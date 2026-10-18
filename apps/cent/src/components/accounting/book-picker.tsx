import { createId } from "@glink25/sync-sdk";
import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { loadStorageAPI } from "../../api/storage/dynamic";
import { useIntl } from "../../locale";
import { accountingStore } from "../../store/accounting";
import { createDefaultAccountingData } from "../../store/default-accounting-data";
import { isCancelError } from "../confirm/state";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Field, FormError, selectClass, useFormAction } from "./shared";

/** Cached books open immediately; remote Manifests are listed independently when online. */
export default function AccountingBookPicker() {
    const t = useIntl();
    const busy = useStore(accountingStore, (state) => state.busy);
    const localBooks = useStore(accountingStore, (state) => state.books);
    const [online, setOnline] = useState(() => navigator.onLine);
    const [books, setBooks] = useState<{ id: string; name: string }[]>([]);
    const [remoteId, setRemoteId] = useState("");
    const [name, setName] = useState("");
    const [loading, setLoading] = useState(true);
    const [listError, setListError] = useState<string>();
    const [refresh, setRefresh] = useState(0);
    const [created, setCreated] = useState(false);
    const pending = useRef<
        { id: string; name: string; created: boolean } | undefined
    >(undefined);
    const { error, submitting, run } = useFormAction();
    useEffect(() => {
        const update = () => setOnline(navigator.onLine);
        window.addEventListener("online", update);
        window.addEventListener("offline", update);
        return () => {
            window.removeEventListener("online", update);
            window.removeEventListener("offline", update);
        };
    }, []);
    // biome-ignore lint/correctness/useExhaustiveDependencies: The refresh counter explicitly retries the remote listing.
    useEffect(() => {
        let active = true;
        if (!online) {
            setLoading(false);
            setListError(t("accounting-offline-books-help"));
            return;
        }
        setLoading(true);
        setListError(undefined);
        void loadStorageAPI()
            .then(({ StorageAPI }) => StorageAPI.books.fetchRemoteBooks())
            .then((result) => {
                if (!active) return;
                setBooks(result);
                setRemoteId(result[0]?.id ?? "");
            })
            .catch((failure) => {
                if (active)
                    setListError(
                        failure instanceof Error
                            ? failure.message
                            : t("accounting-action-failed"),
                    );
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, [online, refresh, t]);
    const disabled = busy || submitting || loading || !online;
    return (
        <main className="h-full overflow-y-auto flex items-start sm:items-center justify-center p-4">
            <div className="w-full max-w-md rounded-lg border bg-background p-5 space-y-5 my-auto">
                <div className="space-y-2">
                    <h1 className="text-lg font-semibold">
                        {t("accounting-choose-book")}
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        {t("accounting-choose-book-help")}
                    </p>
                </div>
                {localBooks.length > 0 && (
                    <section className="space-y-2">
                        <h2 className="text-sm font-medium">
                            {t("accounting-local-books")}
                        </h2>
                        {localBooks.map((book) => (
                            <Button
                                key={book.id}
                                className="w-full"
                                variant="outline"
                                disabled={busy || submitting}
                                aria-label={t("accounting-open-local-book", {
                                    name: book.name,
                                })}
                                onClick={() =>
                                    void run(() =>
                                        accountingStore
                                            .getState()
                                            .selectBook(book.id),
                                    )
                                }
                            >
                                {book.name}
                            </Button>
                        ))}
                    </section>
                )}
                {loading ? (
                    <output>{t("accounting-loading-remote-books")}</output>
                ) : listError ? (
                    <div className="space-y-2">
                        <FormError error={listError} />
                        <Button
                            variant="outline"
                            disabled={disabled}
                            onClick={() => setRefresh((value) => value + 1)}
                        >
                            {t("accounting-refresh-books")}
                        </Button>
                    </div>
                ) : books.length ? (
                    <div className="space-y-3">
                        <Field label={t("accounting-sync-remote-book")}>
                            <select
                                className={selectClass}
                                value={remoteId}
                                disabled={disabled}
                                onChange={(event) =>
                                    setRemoteId(event.target.value)
                                }
                            >
                                {books.map((book) => (
                                    <option key={book.id} value={book.id}>
                                        {book.name}
                                    </option>
                                ))}
                            </select>
                        </Field>
                        <Button
                            className="w-full"
                            disabled={disabled || !remoteId}
                            onClick={() =>
                                void run(async () => {
                                    const { StorageAPI } =
                                        await loadStorageAPI();
                                    const book =
                                        await StorageAPI.books.importBook(
                                            remoteId,
                                        );
                                    await accountingStore
                                        .getState()
                                        .selectBook(book.book.id);
                                })
                            }
                        >
                            {t("accounting-use-book")}
                        </Button>
                    </div>
                ) : (
                    <p className="text-sm text-muted-foreground">
                        {t("accounting-empty-remote-books")}
                    </p>
                )}
                <form
                    className="space-y-3 border-t pt-4"
                    onSubmit={(event) => {
                        event.preventDefault();
                        void run(async () => {
                            const { StorageAPI } = await loadStorageAPI();
                            pending.current ??= {
                                id: createId(),
                                name: name.trim(),
                                created: false,
                            };
                            const draft = pending.current;
                            if (!draft.created) {
                                draft.name = name.trim();
                                const now = Date.now();
                                await StorageAPI.books.createBook(
                                    draft.id,
                                    draft.name,
                                    now,
                                    createDefaultAccountingData(now),
                                );
                                draft.created = true;
                                setCreated(true);
                            }
                            const book = await StorageAPI.books.publishBook(
                                draft.id,
                            );
                            await accountingStore
                                .getState()
                                .selectBook(book.book.id);
                        });
                    }}
                >
                    <Field label={t("accounting-new-book-name")}>
                        <Input
                            value={name}
                            required
                            disabled={disabled || created}
                            onChange={(event) => setName(event.target.value)}
                            placeholder={t("accounting-new-book-name")}
                        />
                    </Field>
                    <Button
                        type="submit"
                        className="w-full"
                        variant="outline"
                        disabled={disabled || !name.trim()}
                    >
                        {t(
                            created
                                ? "accounting-retry-book-creation"
                                : "accounting-create-and-use-book",
                        )}
                    </Button>
                </form>
                <FormError error={error} />
                <Button
                    variant="ghost"
                    className="w-full"
                    disabled={disabled}
                    onClick={() =>
                        void run(async () => {
                            const { StorageAPI } = await loadStorageAPI();
                            try {
                                await StorageAPI.loginWith(StorageAPI.type);
                            } catch (failure) {
                                if (!isCancelError(failure)) throw failure;
                            }
                        })
                    }
                >
                    {t("accounting-change-sync-config")}
                </Button>
            </div>
        </main>
    );
}
