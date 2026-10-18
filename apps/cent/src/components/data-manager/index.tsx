import { useState } from "react";
import { useStore } from "zustand";
import PopupLayout from "@/layouts/popup-layout";
import { useIntl } from "@/locale";
import { measure } from "@/measurement";
import { download } from "@/utils/download";
import {
    type AccountingData,
    exportAccountingJson,
    importAccountingJson,
} from "../../ledger/accounting";
import { accountingStore } from "../../store/accounting";
import RestoreAccountingBook from "../accounting/data-manager";
import { FormError, useFormAction } from "../accounting/shared";
import createConfirmProvider from "../confirm";
import { isCancelError } from "../confirm/state";
import { FORMAT_BACKUP, showFilePicker } from "../file-picker";
import modal from "../modal";
import { Button } from "../ui/button";
import { processImportFile } from "./exportable";
import { OncentImport, showOncentImport } from "./oncent";
import { importFromPreviewResult, showImportPreview } from "./preview-form";
import { SmartImport } from "./smart-import";

const [SmartImportProvider, showSmartImport] = createConfirmProvider(
    SmartImport,
    {
        dialogTitle: "smart-import",
        contentClassName:
            "h-full w-full max-h-full max-w-full rounded-none sm:rounded-md sm:max-h-[min(640px,calc(100vh-32px))] sm:w-[90vw] sm:max-w-[560px]",
    },
);
function Form({ onCancel }: { onCancel?: () => void }) {
    const t = useIntl();
    const current = useStore(accountingStore, (state) => state.current);
    const busy = useStore(accountingStore, (state) => state.busy);
    const { error, submitting, run } = useFormAction();
    const [restore, setRestore] = useState<{
        data: AccountingData;
        name: string;
    }>();
    const perform = (action: () => Promise<unknown>) =>
        void run(async () => {
            try {
                await action();
            } catch (error) {
                if (!isCancelError(error)) throw error;
            }
        });
    const toImport = async () => {
        const [file] = await showFilePicker({ accept: FORMAT_BACKUP });
        if (!file) return;
        const [stop] = modal.loading();
        const data = await processImportFile(file).finally(stop);
        if (
            (data as unknown as { format?: string }).format ===
            "cent-accounting"
        ) {
            setRestore({
                data: importAccountingJson(JSON.stringify(data)),
                name: file.name.replace(/\.json$/i, ""),
            });
            return;
        }
        if (!Array.isArray(data.items))
            throw new Error(t("accounting-import-read-failed"));
        const result = await showImportPreview({
            bills: data.items,
            meta: data.meta,
        });
        await importFromPreviewResult(result);
        measure("bill_created", {
            source: "import",
            item_count: result.bills.length,
        });
    };
    const toExport = async () => {
        const book = accountingStore.getState().current;
        if (!book) throw new Error(t("accounting-import-book-changed"));
        const data = book.data;
        const json = exportAccountingJson(
            data.accounts,
            data.transactions,
            data.tagMetadata,
            data.mapConfig,
            data.currencySettings,
            data.statisticsViews,
            data.timeZone,
        );
        await download(
            new Blob([json], { type: "application/json" }),
            book.book.name.replace(/[\\/:*?"<>|]/g, "-") +
                ".cent-accounting.json",
        );
    };
    const toOncent = async () => {
        const [file] = await showFilePicker({ accept: FORMAT_BACKUP });
        if (file) await showOncentImport(JSON.parse(await file.text()));
    };
    return (
        <PopupLayout
            title={t("data-manager")}
            onBack={onCancel}
            className="h-full overflow-hidden"
        >
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <p className="font-medium">{current?.book.name}</p>
                <p className="text-xs text-muted-foreground">
                    {t("accounting-import-double-entry-help")}
                </p>
                <div className="space-y-2">
                    <Button
                        className="w-full"
                        variant="outline"
                        disabled={busy || submitting || !current}
                        onClick={() => perform(toImport)}
                    >
                        {t("data-import")}
                    </Button>
                    <Button
                        className="w-full"
                        variant="outline"
                        disabled={busy || submitting || !current}
                        onClick={() => perform(toExport)}
                    >
                        {t("data-export")}
                    </Button>
                </div>
                <div className="border-t pt-4 space-y-2">
                    <Button
                        className="w-full"
                        variant="outline"
                        disabled={busy || submitting || !current}
                        onClick={() => perform(() => showSmartImport())}
                    >
                        {t("smart-import")}
                    </Button>
                    <Button
                        className="w-full"
                        variant="outline"
                        disabled={busy || submitting || !current}
                        onClick={() => perform(toOncent)}
                    >
                        {t("import-from-oncent-github-io")}
                    </Button>
                </div>
                <FormError error={error} />
            </div>
            <SmartImportProvider />
            <OncentImport />
            {restore && (
                <RestoreAccountingBook
                    initialData={restore.data}
                    initialName={restore.name}
                    onClose={() => setRestore(undefined)}
                />
            )}
        </PopupLayout>
    );
}
const [DataManagerProvider, showDataManager] = createConfirmProvider(Form, {
    dialogTitle: "data-manager",
    dialogModalClose: true,
    contentClassName:
        "h-full w-full max-h-full max-w-full rounded-none sm:rounded-md sm:max-h-[min(580px,calc(100vh-32px))] sm:w-[90vw] sm:max-w-[520px]",
});

export default function DataManagerSettingsItem({
    onOpen,
}: {
    onOpen?: () => void;
} = {}) {
    const t = useIntl();
    return (
        <div className="lab">
            <Button
                onClick={() => {
                    if (onOpen) onOpen();
                    else void showDataManager().catch(() => {});
                }}
                variant="ghost"
                className="w-full py-4 rounded-none h-auto"
            >
                <div className="w-full px-4 flex justify-between items-center">
                    <div className="flex items-center gap-2">
                        <i className="icon-[mdi--database-outline] size-5"></i>
                        <div>{t("data-manager")}</div>
                    </div>
                    <i className="icon-[mdi--chevron-right] size-5"></i>
                </div>
            </Button>
            <DataManagerProvider />
        </div>
    );
}
