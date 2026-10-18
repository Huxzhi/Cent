import { createId } from "@glink25/sync-sdk";
import { useState } from "react";
import { useStore } from "zustand";
import PopupLayout from "../../layouts/popup-layout";
import { exportAccountingJson } from "../../ledger/accounting";
import { accountingStore } from "../../store/accounting";
import createConfirmProvider from "../confirm";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import AccountingBookSync from "./book-sync";
import DataManager from "./data-manager";
import { useAccountingLabels } from "./i18n";
import { Field, FormError, selectClass, useFormAction } from "./shared";

function BookManager({
    edit = "books",
    onCancel,
}: {
    edit?: "books" | "data";
    onCancel?: () => void;
}) {
    const { books, current, busy } = useStore(accountingStore);
    const { t } = useAccountingLabels();
    const [name, setName] = useState("");
    const [importing, setImporting] = useState(false);
    const { error, submitting, run } = useFormAction();
    if (!current) return null;
    const exportFile = () => {
        void run(async () => {
            const data = current.data;
            const json = exportAccountingJson(
                data.accounts,
                data.transactions,
                data.tagMetadata,
                data.mapConfig,
                data.currencySettings,
                data.statisticsViews,
                data.timeZone,
            );
            const url = URL.createObjectURL(
                new Blob([json], { type: "application/json" }),
            );
            const link = document.createElement("a");
            link.href = url;
            link.download = `${current.book.name.replace(/[\\/:*?"<>|]/g, "-")}.cent-accounting.json`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        });
    };
    return (
        <PopupLayout
            title={
                edit === "data"
                    ? t("accounting-data-title")
                    : t("accounting-book-title")
            }
            onBack={onCancel}
            className="h-full overflow-hidden"
        >
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {edit === "books" && (
                    <>
                        <Field label={t("accounting-current-book")}>
                            <select
                                value={current.book.id}
                                className={selectClass}
                                disabled={busy || submitting}
                                onChange={(event) =>
                                    void run(() =>
                                        accountingStore
                                            .getState()
                                            .selectBook(event.target.value),
                                    )
                                }
                            >
                                {books.map((book) => (
                                    <option key={book.id} value={book.id}>
                                        {book.name}
                                    </option>
                                ))}
                            </select>
                        </Field>
                        <form
                            className="flex gap-2"
                            onSubmit={(event) => {
                                event.preventDefault();
                                void run(async () => {
                                    await accountingStore
                                        .getState()
                                        .addBook(
                                            createId(),
                                            name.trim(),
                                            Date.now(),
                                        );
                                    setName("");
                                });
                            }}
                        >
                            <Input
                                aria-label={t("accounting-new-book-name")}
                                value={name}
                                onChange={(event) =>
                                    setName(event.target.value)
                                }
                                placeholder={t("accounting-new-book-name")}
                                required
                            />
                            <Button
                                type="submit"
                                disabled={busy || submitting || !name.trim()}
                            >
                                {t("accounting-new-book")}
                            </Button>
                        </form>
                        <p className="text-xs text-muted-foreground">
                            {t("accounting-template-book-help")}
                        </p>
                        <AccountingBookSync />
                    </>
                )}
                {edit === "data" && (
                    <>
                        <p className="text-sm font-medium">
                            {current.book.name}
                        </p>
                        <div className="flex gap-2">
                            <Button
                                variant="outline"
                                disabled={busy || submitting}
                                onClick={() => setImporting(true)}
                            >
                                {t("import")}
                            </Button>
                            <Button
                                variant="outline"
                                disabled={busy || submitting}
                                onClick={exportFile}
                            >
                                {t("accounting-export-json")}
                            </Button>
                        </div>
                        <p className="text-xs text-muted-foreground">
                            {t("accounting-import-current-only")}
                        </p>
                    </>
                )}
                <FormError error={error} />
            </div>
            {importing && <DataManager onClose={() => setImporting(false)} />}
        </PopupLayout>
    );
}

export const [AccountingBookProvider, showAccountingBooks] =
    createConfirmProvider<"books" | "data", void>(BookManager, {
        dialogTitle: "accounting-book-data",
        contentClassName:
            "h-full w-full max-h-full max-w-full rounded-none sm:rounded-md sm:max-h-[min(520px,calc(100vh-32px))] sm:w-[90vw] sm:max-w-[500px]",
    });
