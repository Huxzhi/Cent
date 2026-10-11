import { useState } from "react";
import { useStore } from "zustand";
import { useAccountingLabels } from "../../components/accounting/i18n";
import {
    accountName,
    currencyLabel,
    isBaseCurrency,
    selectClass,
} from "../../components/accounting/shared";
import TransactionList from "../../components/ledger/transaction-list";
import SearchInput from "../../components/search/input";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { matchesTransactionDateRange } from "../../ledger/accounting/time-range";
import { accountingStore } from "../../store/accounting";
import { addZonedDays, parseBookDateTime } from "../../utils/time";

export default function Page() {
    const { current } = useStore(accountingStore);
    const { t, transactionTypes, labelTransaction, labelAccount } =
        useAccountingLabels();
    const [query, setQuery] = useState("");
    const [submittedQuery, setSubmittedQuery] = useState("");
    const [type, setType] = useState("");
    const [accountId, setAccountId] = useState("");
    const [start, setStart] = useState("");
    const [end, setEnd] = useState("");
    const [filters, setFilters] = useState(false);
    if (!current) return null;
    const data = current.data;
    const keyword = submittedQuery.trim().toLocaleLowerCase();
    const transactions = data.transactions.filter((transaction) => {
        if (type && transaction.type !== type) return false;
        if (
            accountId &&
            !transaction.entries.some((entry) => entry.accountId === accountId)
        )
            return false;
        const from = start ? parseBookDateTime(start) : 0;
        const until = end
            ? addZonedDays(parseBookDateTime(end), 1, data.timeZone)
            : undefined;
        if (!matchesTransactionDateRange(transaction, from, until ?? Infinity))
            return false;
        const text = [
            transaction.description,
            labelTransaction(transaction),
            ...transaction.entries.map((entry) => {
                const account = data.accounts.find(
                    (item) => item.id === entry.accountId,
                );
                return account
                    ? accountName(account, data.accounts, labelAccount)
                    : entry.accountId;
            }),
        ]
            .join(" ")
            .toLocaleLowerCase();
        return !keyword || text.includes(keyword);
    });
    return (
        <div className="w-full h-full p-2 flex justify-center overflow-hidden page-show">
            <div className="h-full w-full px-2 max-w-[600px] flex flex-col gap-2">
                <div className="shrink-0">
                    <SearchInput
                        value={query}
                        onValueChange={setQuery}
                        onSearch={() => setSubmittedQuery(query)}
                        onClear={() => {
                            setQuery("");
                            setSubmittedQuery("");
                        }}
                    />
                </div>
                <div className="w-full flex justify-between px-2 pt-1 shrink-0">
                    <Button
                        variant="ghost"
                        onClick={() => {
                            setQuery("");
                            setSubmittedQuery("");
                            setType("");
                            setAccountId("");
                            setStart("");
                            setEnd("");
                        }}
                    >
                        {t("reset")}
                    </Button>
                    <Button
                        variant="ghost"
                        aria-expanded={filters}
                        onClick={() => setFilters(!filters)}
                    >
                        <i
                            className={
                                filters
                                    ? "icon-[mdi--filter-variant-minus]"
                                    : "icon-[mdi--filter-variant-plus]"
                            }
                        />
                        {t("filter")}
                    </Button>
                </div>
                {filters && (
                    <div className="grid grid-cols-2 gap-2 rounded-md border p-3 shrink-0">
                        <select
                            aria-label={t("accounting-transaction-type")}
                            value={type}
                            onChange={(event) => setType(event.target.value)}
                            className={selectClass}
                        >
                            <option value="">
                                {t("stat-all-transactions")}
                            </option>
                            {Object.entries(transactionTypes).map(
                                ([value, label]) => (
                                    <option key={value} value={value}>
                                        {label}
                                    </option>
                                ),
                            )}
                        </select>
                        <select
                            aria-label={t("accounting-search-account")}
                            value={accountId}
                            onChange={(event) =>
                                setAccountId(event.target.value)
                            }
                            className={selectClass}
                        >
                            <option value="">{t("stat-all-accounts")}</option>
                            {data.accounts.map((account) => (
                                <option key={account.id} value={account.id}>
                                    {accountName(
                                        account,
                                        data.accounts,
                                        labelAccount,
                                    )}
                                    {!isBaseCurrency(account.currency) &&
                                        ` · ${currencyLabel(account.currency)}`}
                                </option>
                            ))}
                        </select>
                        <Input
                            aria-label={t("accounting-search-start")}
                            type="date"
                            value={start}
                            onChange={(event) => setStart(event.target.value)}
                        />
                        <Input
                            aria-label={t("accounting-search-end")}
                            type="date"
                            value={end}
                            onChange={(event) => setEnd(event.target.value)}
                        />
                        <Button
                            variant="ghost"
                            onClick={() => {
                                setType("");
                                setAccountId("");
                                setStart("");
                                setEnd("");
                            }}
                        >
                            {t("stat-reset-filters")}
                        </Button>
                    </div>
                )}
                <p className="text-xs text-muted-foreground px-2 shrink-0">
                    {t("total-records", { n: transactions.length })}
                </p>
                <div className="flex-1 min-h-0 overflow-hidden">
                    <TransactionList
                        transactions={transactions}
                        accounts={data.accounts}
                    />
                </div>
            </div>
        </div>
    );
}
