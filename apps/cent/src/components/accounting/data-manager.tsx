import { createId } from "@glink25/sync-sdk";
import { useState } from "react";
import { useStore } from "zustand";
import {
    type AccountingData,
    importAccountingJson,
} from "../../ledger/accounting";
import { accountingStore } from "../../store/accounting";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { useAccountingLabels } from "./i18n";
import { Field, FormError, Modal, useFormAction } from "./shared";

export default function DataManager({
    onClose,
    initialData,
    initialName,
}: {
    onClose: () => void;
    initialData?: AccountingData;
    initialName?: string;
}) {
    const { t } = useAccountingLabels();
    const { current, busy } = useStore(accountingStore);
    const [candidate, setCandidate] = useState<AccountingData | undefined>(
        initialData,
    );
    const [bookName, setBookName] = useState(
        initialName ?? t("accounting-imported-book-name"),
    );
    const [reading, setReading] = useState(false);
    const [readError, setReadError] = useState<string>();
    const { error, submitting, run } = useFormAction(onClose);
    if (!current) return null;
    const blocked = busy || reading || submitting;
    async function pickFile(file: File) {
        setCandidate(undefined);
        setReadError(undefined);
        setReading(true);
        try {
            const data = importAccountingJson(await file.text());
            setCandidate(data);
            setBookName(
                file.name.replace(/\.json$/i, "") ||
                    t("accounting-imported-book-name"),
            );
        } catch (failure) {
            setReadError(
                failure instanceof Error
                    ? failure.message
                    : t("accounting-import-read-failed"),
            );
        } finally {
            setReading(false);
        }
    }
    return (
        <Modal
            title={t("accounting-import-book")}
            busy={blocked}
            onClose={onClose}
        >
            <form
                className="flex flex-col gap-4 mt-4"
                onSubmit={(event) => {
                    event.preventDefault();
                    if (blocked || !candidate || !bookName.trim()) return;
                    void run(async () => {
                        await accountingStore
                            .getState()
                            .addBook(
                                createId(),
                                bookName.trim(),
                                Date.now(),
                                candidate,
                            );
                    });
                }}
            >
                <p className="text-xs text-muted-foreground">
                    {t("accounting-import-current-only")}
                </p>
                <Field label={t("accounting-import-select-file")}>
                    <Input
                        type="file"
                        accept=".json"
                        disabled={blocked}
                        onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) void pickFile(file);
                            event.target.value = "";
                        }}
                    />
                </Field>
                {reading && <output>{t("accounting-import-reading")}</output>}
                {candidate && (
                    <>
                        <p className="text-sm">
                            {t("accounting-import-summary", {
                                accounts: candidate.accounts.length,
                                transactions: candidate.transactions.length,
                            })}
                        </p>
                        <Field label={t("accounting-new-book-name")}>
                            <Input
                                value={bookName}
                                disabled={blocked}
                                required
                                onChange={(event) =>
                                    setBookName(event.target.value)
                                }
                            />
                        </Field>
                    </>
                )}
                <FormError error={readError || error} />
                <Button
                    type="submit"
                    disabled={blocked || !candidate || !bookName.trim()}
                >
                    {blocked
                        ? t("accounting-import-processing")
                        : t("accounting-import-new-book")}
                </Button>
            </form>
        </Modal>
    );
}
