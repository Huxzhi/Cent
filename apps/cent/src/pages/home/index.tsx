import { useState } from "react";
import { useStore } from "zustand";
import { showAccountingBooks } from "../../components/accounting/book-manager";
import { FormError, money } from "../../components/accounting/shared";
import { DatePicker } from "../../components/date-picker";
import TransactionList from "../../components/ledger/transaction-list";
import { useAccountingView } from "../../hooks/use-accounting-view";
import { useCurrency } from "../../hooks/use-currency";
import {
    getStatisticsLines,
    getStatisticsTotals,
} from "../../ledger/accounting/statistics";
import { useIntl } from "../../locale";
import { accountingStore } from "../../store/accounting";
import { bookDayjs } from "../../utils/time";

export default function Page() {
    const { current, busy, error } = useStore(accountingStore);
    const [date, setDate] = useState(Date.now());
    const { baseCurrency, convert } = useCurrency();
    const t = useIntl();
    const view = useAccountingView(current?.data);
    if (!current) return null;
    const data = current.data;
    const mainCurrency = baseCurrency.id;
    let totals: ReturnType<typeof getStatisticsTotals> | undefined;
    let totalsError = "金额超出支持范围";
    try {
        totals = getStatisticsTotals(
            getStatisticsLines(
                data,
                {
                    start: bookDayjs(date).startOf("day").valueOf(),
                    end: bookDayjs(date).endOf("day").valueOf(),
                },
                mainCurrency,
                (from, to) => {
                    const rate = convert(1, from, to).predict;
                    return Number.isFinite(rate) && rate > 0 ? rate : undefined;
                },
                view.now,
            ),
        );
    } catch (error) {
        if (
            error instanceof Error &&
            error.message === "Missing display conversion basis"
        )
            totalsError = t("accounting-conversion-pending");
    }
    return (
        <div className="w-full h-full p-2 flex flex-col overflow-hidden page-show">
            <div
                data-today-overview
                className="bg-stone-800 text-white dark:bg-foreground/20 relative h-24 w-full flex justify-end rounded-lg px-4 py-2 overflow-hidden shrink-0"
            >
                <span className="absolute top-2 left-4">
                    <DatePicker type="date" value={date} onChange={setDate} />
                </span>
                <span className="font-bold text-3xl pt-3 pb-5 tabular-nums">
                    {totals ? money(totals.net, mainCurrency) : totalsError}
                </span>
                <button
                    type="button"
                    className="absolute bottom-2 left-4 text-xs opacity-60 flex items-center gap-1 cursor-pointer"
                    onClick={() => {
                        void showAccountingBooks().catch(() => {});
                    }}
                >
                    <i aria-hidden className="icon-[mdi--book]" />
                    {current.book.name}
                </button>
            </div>
            <div className="flex justify-between items-center pl-7 pr-5 py-1 h-8 shrink-0 text-xs">
                <button
                    type="button"
                    aria-label="重新加载账本"
                    disabled={busy}
                    className="cursor-pointer"
                    onClick={() =>
                        void accountingStore
                            .getState()
                            .reload()
                            .catch(() => {})
                    }
                >
                    <i
                        aria-hidden
                        className={`icon-[mdi--reload] ${busy ? "animate-spin" : ""}`}
                    />
                </button>
                <span>
                    收入 {totals ? money(totals.income, mainCurrency) : "—"} ·
                    支出 {totals ? money(totals.expense, mainCurrency) : "—"}
                </span>
                <i
                    role="img"
                    aria-label="数据保存在此设备"
                    className="icon-[mdi--database-outline]"
                />
            </div>
            <FormError error={error} />
            <div className="flex-1 min-h-0 overflow-hidden">
                <TransactionList
                    transactions={data.transactions}
                    accounts={data.accounts}
                    displayCurrency={mainCurrency}
                    showPeriodDates={false}
                    groupChildren
                />
            </div>
        </div>
    );
}
