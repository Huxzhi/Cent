import { Toaster } from "@glink25/toast";
import { useEffect } from "react";
import { Outlet } from "react-router";
import { useStore } from "zustand";
import { AccountManagerProvider } from "../components/accounting/account-manager";
import { AccountingBookProvider } from "../components/accounting/book-manager";
import { FormError } from "../components/accounting/shared";
import { BillEditorProvider } from "../components/bill-editor";
import { TransactionInfoProvider } from "../components/bill-info/transaction";
import { TagListProvider } from "../components/bill-tag";
import { CurrencyListProvider } from "../components/currency";
import { ModalProvider } from "../components/modal";
import Navigation from "../components/navigation";
import { Settings } from "../components/settings";
import { Button } from "../components/ui/button";
import { TooltipProvider } from "../components/ui/tooltip";
import { useAccountingSync } from "../hooks/use-accounting-sync";
import { ThemeProvider } from "../hooks/use-theme";
import { accountingStore } from "../store/accounting";

const ACTIVE_BOOK_KEY = "cent-accounting-active-book";
export default function MainLayout() {
    useAccountingSync();
    const { ready, current, busy, error, initialize } =
        useStore(accountingStore);
    useEffect(() => {
        let preferred: string | undefined;
        try {
            preferred = localStorage.getItem(ACTIVE_BOOK_KEY) ?? undefined;
        } catch {}
        void initialize(preferred).catch(() => {});
    }, [initialize]);
    const bookId = current?.book.id;
    useEffect(() => {
        if (!bookId) return;
        try {
            localStorage.setItem(ACTIVE_BOOK_KEY, bookId);
        } catch {}
    }, [bookId]);
    return (
        <ThemeProvider>
            <TooltipProvider>
                {ready && current ? (
                    <>
                        <Navigation />
                        <div className="w-full h-full sm:pl-18">
                            <Outlet />
                        </div>
                    </>
                ) : (
                    <div className="h-full flex flex-col gap-4 items-center justify-center">
                        <output>正在打开账本…</output>
                        <FormError error={error} />
                        {error && (
                            <Button
                                disabled={busy}
                                onClick={() =>
                                    void accountingStore
                                        .getState()
                                        .initialize()
                                        .catch(() => {})
                                }
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
                <ModalProvider />
                <Toaster />
            </TooltipProvider>
        </ThemeProvider>
    );
}
