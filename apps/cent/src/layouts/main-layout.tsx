import { Toaster } from "@glink25/toast";
import { useCallback, useEffect, useState } from "react";
import { Outlet } from "react-router";
import { useStore } from "zustand";
import { loadStorageAPI } from "../api/storage/dynamic";
import {
    getSelectedSyncEndpoint,
    type SyncEndpoint,
} from "../api/storage/selection";
import { AccountManagerProvider } from "../components/accounting/account-manager";
import { AccountingBookProvider } from "../components/accounting/book-manager";
import AccountingBookPicker from "../components/accounting/book-picker";
import { FormError } from "../components/accounting/shared";
import AccountingSyncConflicts from "../components/accounting/sync-conflicts";
import { BillEditorProvider } from "../components/bill-editor";
import { TransactionInfoProvider } from "../components/bill-info/transaction";
import { TagListProvider } from "../components/bill-tag";
import { CurrencyListProvider } from "../components/currency";
import Login from "../components/login";
import { ModalProvider } from "../components/modal";
import Navigation from "../components/navigation";
import { Settings } from "../components/settings";
import { Button } from "../components/ui/button";
import { TooltipProvider } from "../components/ui/tooltip";
import { useAccountingSync } from "../hooks/use-accounting-sync";
import { ThemeProvider } from "../hooks/use-theme";
import { ACTIVE_BOOK_KEY, accountingStore } from "../store/accounting";

export default function MainLayout() {
    const selected = getSelectedSyncEndpoint();
    return (
        <ThemeProvider>
            <TooltipProvider>
                {selected && <AccountingLayout selected={selected} />}
                <Login />
                <ModalProvider />
                <Toaster />
            </TooltipProvider>
        </ThemeProvider>
    );
}

function AccountingLayout({ selected }: { selected: SyncEndpoint }) {
    useAccountingSync();
    const { ready, current, busy, error, conflict, initialize } =
        useStore(accountingStore);
    const [startupError, setStartupError] = useState<string>();
    const initializeBook = useCallback(async () => {
        setStartupError(undefined);
        let preferred: string | undefined;
        try {
            preferred = localStorage.getItem(ACTIVE_BOOK_KEY) ?? undefined;
        } catch {}
        try {
            // Configure the selected remote before deciding which book to open.
            await loadStorageAPI();
            await initialize(preferred, {
                createDefault: selected === "offline",
                selectFirst: selected === "offline",
            });
        } catch (failure) {
            setStartupError(
                failure instanceof Error ? failure.message : String(failure),
            );
        }
    }, [initialize, selected]);
    useEffect(() => {
        void initializeBook();
    }, [initializeBook]);
    const needsSelection =
        selected !== "offline" &&
        (!current?.remoteId ||
            (current.remoteProvider ?? "webdav") !== selected);
    const bookId = current?.book.id;
    useEffect(() => {
        if (!bookId || needsSelection) return;
        try {
            localStorage.setItem(ACTIVE_BOOK_KEY, bookId);
        } catch {}
    }, [bookId, needsSelection]);
    return (
        <>
            {conflict ? (
                <AccountingSyncConflicts />
            ) : ready && needsSelection ? (
                <AccountingBookPicker />
            ) : ready && current ? (
                <>
                    <Navigation />
                    <div className="w-full h-full sm:pl-18">
                        <Outlet />
                    </div>
                </>
            ) : (
                <div className="h-full flex flex-col gap-4 items-center justify-center">
                    <output>正在打开账本…</output>
                    <FormError error={startupError ?? error} />
                    {(startupError || error) && (
                        <Button
                            disabled={busy}
                            onClick={() => void initializeBook()}
                        >
                            重新加载
                        </Button>
                    )}
                </div>
            )}
            <BillEditorProvider />
            <TagListProvider />
            <TransactionInfoProvider />
            <Settings />
            <AccountManagerProvider />
            <CurrencyListProvider />
            <AccountingBookProvider />
        </>
    );
}
