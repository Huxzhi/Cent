import { Fragment, useMemo } from "react";
import { useStore } from "zustand";
import { useAccountingView } from "../../hooks/use-accounting-view";
import { useCurrency } from "../../hooks/use-currency";
import { useTag } from "../../hooks/use-tag";
import {
    type Account,
    getAccountIcon,
    getChildTransactions,
    type Transaction,
} from "../../ledger/accounting";
import { replayCurrencyCosts } from "../../ledger/accounting/currency-cost";
import {
    getTransactionListPresentation,
    type TransactionListContext,
    type TransactionListPresentation,
} from "../../ledger/accounting/list-presentation";
import { accountingStore } from "../../store/accounting";
import { usePreferenceStore } from "../../store/preference";
import { bookDayjs, denseDate } from "../../utils/time";
import { useAccountingLabels } from "../accounting/i18n";
import { accountFlow, accountName } from "../accounting/shared";
import { showTransactionInfo } from "../bill-info/transaction";
import { BaseBillItem } from "./item";
import TransactionChildren from "./transaction-children";
import {
    formatListAmount,
    formatListLabel,
    TransactionMetadata,
    TransactionPeriod,
} from "./transaction-display";
import "./style.scss";

export default function TransactionList({
    transactions,
    accounts,
    displayCurrency,
    showPeriodDates = true,
    groupChildren = false,
}: {
    displayCurrency?: string;
    showPeriodDates?: boolean;
    groupChildren?: boolean;
    transactions: Transaction[];
    accounts: Account[];
}) {
    const { t, labelTransaction, labelAccount } = useAccountingLabels();
    const { tags } = useTag();
    const { convert, baseCurrency } = useCurrency();
    const showAssets = usePreferenceStore((state) => state.showAssetsInLedger);
    const data = useStore(accountingStore, (state) => state.current?.data);
    const view = useAccountingView(data);
    const costLedger = useMemo(() => {
        try {
            return replayCurrencyCosts(
                accounts,
                view.transactions,
                undefined,
                baseCurrency.id,
            );
        } catch {
            return undefined;
        }
    }, [accounts, view.transactions, baseCurrency.id]);
    const context: TransactionListContext = {
        accounts,
        through: view.now,
        displayCurrency,
        baseCurrency: baseCurrency.id,
        costLedger,
        timeZone: data?.timeZone,
        valueRate: (from, to) => {
            const rate = convert(1, from, to).predict;
            return Number.isFinite(rate) && rate > 0 ? rate : undefined;
        },
    };
    const visibleIds = new Set(
        transactions.map((transaction) => transaction.id),
    );
    const ordered = transactions
        .filter(
            (transaction) =>
                !groupChildren ||
                !transaction.parentTransactionId ||
                !visibleIds.has(transaction.parentTransactionId),
        )
        .sort(
            (left, right) =>
                right.time - left.time ||
                right.createdAt - left.createdAt ||
                left.id.localeCompare(right.id),
        );
    return (
        <div className="relative h-full overflow-y-auto bill-list scrollbar-hidden pb-20">
            <div
                data-main-ledger
                className="relative before:block before:absolute before:top-0 before:left-9 before:w-px before:h-full before:bg-foreground/30"
            >
                {ordered.map((transaction, index) => {
                    const parent = data?.transactions.find(
                        (item) => item.id === transaction.parentTransactionId,
                    );
                    let display: TransactionListPresentation;
                    try {
                        display = getTransactionListPresentation(
                            transaction,
                            context,
                            parent,
                        );
                    } catch {
                        return (
                            <button
                                key={transaction.id}
                                type="button"
                                className="p-4 text-sm"
                                onClick={() => {
                                    void showTransactionInfo(transaction).catch(
                                        () => {},
                                    );
                                }}
                            >
                                {transaction.description ||
                                    labelTransaction(transaction)}{" "}
                                · 金额超出显示范围，点击查看分录
                            </button>
                        );
                    }
                    const date = bookDayjs(transaction.time);
                    const children = groupChildren
                        ? getChildTransactions(transaction.id, transactions)
                        : [];
                    const label = formatListLabel(
                        display,
                        t,
                        false,
                        showPeriodDates,
                    );
                    const fee = display.fee;
                    const openTransaction = () => {
                        void showTransactionInfo(transaction).catch(() => {});
                    };
                    return (
                        <Fragment key={transaction.id}>
                            {(index === 0 ||
                                !date.isSame(
                                    bookDayjs(ordered[index - 1].time),
                                    "day",
                                )) && (
                                <div className="pl-12 pr-4 pt-4 pb-2 text-sm ledger-divider">
                                    {denseDate(date)}
                                </div>
                            )}
                            <BaseBillItem
                                tags={transaction.tagIds?.map(
                                    (id) =>
                                        tags.find((tag) => tag.id === id) ?? {
                                            id,
                                            name: id,
                                        },
                                )}
                                className="w-full relative"
                                category={{
                                    name: accountFlow(
                                        transaction,
                                        accounts,
                                        labelAccount,
                                    ),
                                    icon: display.account
                                        ? getAccountIcon(display.account)
                                        : "icon-[mdi--swap-horizontal]",
                                }}
                                creatorLabel={label}
                                type={transaction.type}
                                amount={display.amount.amount ?? 0}
                                amountTone={display.amount.tone}
                                amountTitle={t(display.amount.titleKey)}
                                formattedAmount={formatListAmount(
                                    display.amount,
                                    t,
                                )}
                                time={transaction.time}
                                formattedTime={date.format("HH:mm")}
                                metadata={
                                    <>
                                        <TransactionMetadata
                                            label={label}
                                            description={display.description}
                                            supplement={display.supplement}
                                            t={t}
                                        />
                                        <TransactionPeriod
                                            period={display.period}
                                            t={t}
                                        />
                                    </>
                                }
                                images={transaction.images?.map(
                                    (image) => image.dataUrl,
                                )}
                                showAssets={showAssets}
                                showTime
                                onClick={openTransaction}
                            />
                            {!!children.length && (
                                <TransactionChildren
                                    parent={transaction}
                                    transactions={transactions}
                                    context={context}
                                />
                            )}
                            {fee && (
                                <BaseBillItem
                                    className="w-full relative"
                                    category={{
                                        name: `${labelAccount(fee.source)} → ${accountName(fee.account, accounts, labelAccount)}`,
                                        icon: getAccountIcon(fee.account),
                                    }}
                                    creatorLabel={t(fee.labelKey)}
                                    type="expense"
                                    amount={fee.amount.amount ?? 0}
                                    amountTone={fee.amount.tone}
                                    amountTitle={t(fee.amount.titleKey)}
                                    formattedAmount={formatListAmount(
                                        fee.amount,
                                        t,
                                    )}
                                    time={transaction.time}
                                    formattedTime={date.format("HH:mm")}
                                    metadata={
                                        <TransactionMetadata
                                            label={t(fee.labelKey)}
                                            supplement={fee.supplement}
                                            t={t}
                                        />
                                    }
                                    showTime
                                    onClick={openTransaction}
                                />
                            )}
                        </Fragment>
                    );
                })}
                {!ordered.length && (
                    <p className="text-xs p-4 text-center">
                        这里还没有记录，点击下方“＋”记一笔。
                    </p>
                )}
            </div>
        </div>
    );
}
