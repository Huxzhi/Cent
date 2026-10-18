import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef } from "react";
import { useStore } from "zustand";
import { useAccountingView } from "../../hooks/use-accounting-view";
import { useCurrency } from "../../hooks/use-currency";
import { useTag } from "../../hooks/use-tag";
import {
    type Account,
    type AccountingData,
    getAccountIcon,
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
    showChildren = false,
    direction = "desc",
    contextData,
    preparing = false,
    hasMore = false,
    loading = false,
    onLoadMore,
}: {
    displayCurrency?: string;
    showPeriodDates?: boolean;
    showChildren?: boolean;
    transactions: Transaction[];
    accounts: Account[];
    direction?: "asc" | "desc";
    contextData?: AccountingData;
    preparing?: boolean;
    hasMore?: boolean;
    loading?: boolean;
    onLoadMore?: () => void;
}) {
    const { t, labelTransaction, labelAccount } = useAccountingLabels();
    const { tags } = useTag();
    const { convert, baseCurrency } = useCurrency();
    const showAssets = usePreferenceStore((state) => state.showAssetsInLedger);
    const stored = useStore(accountingStore, (state) => state.current?.data);
    const data = contextData ?? stored;
    const view = useAccountingView(preparing ? undefined : data);
    const costLedger = useMemo(() => {
        try {
            if (preparing) return undefined;
            return replayCurrencyCosts(
                accounts,
                view.transactions,
                undefined,
                baseCurrency.id,
            );
        } catch {
            return undefined;
        }
    }, [accounts, view.transactions, baseCurrency.id, preparing]);
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
    const ordered = useMemo(
        () =>
            transactions
                .filter(
                    (transaction) =>
                        !showChildren || !transaction.parentTransactionId,
                )
                .sort(
                    (left, right) =>
                        (direction === "asc"
                            ? left.time - right.time
                            : right.time - left.time) ||
                        (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
                ),
        [transactions, showChildren, direction],
    );
    const parents = useMemo(
        () => new Map(data?.transactions.map((tx) => [tx.id, tx])),
        [data?.transactions],
    );
    const scroll = useRef<HTMLDivElement>(null);
    const virtualizer = useVirtualizer({
        count: ordered.length,
        getScrollElement: () => scroll.current,
        estimateSize: () => 112,
        overscan: 6,
        getItemKey: (index) => ordered[index].id,
    });
    const visible = virtualizer.getVirtualItems();
    const lastVisible = visible.at(-1)?.index ?? -1;
    useEffect(() => {
        if (hasMore && !loading && lastVisible >= ordered.length - 8)
            onLoadMore?.();
    }, [hasMore, loading, lastVisible, ordered.length, onLoadMore]);
    return (
        <div
            ref={scroll}
            data-virtual-ledger
            data-loaded-count={ordered.length}
            className="relative h-full overflow-y-auto bill-list scrollbar-hidden pb-20"
        >
            <div
                data-main-ledger
                style={{ height: virtualizer.getTotalSize() }}
                className="relative before:block before:absolute before:top-0 before:left-9 before:w-px before:h-full before:bg-foreground/30"
            >
                {visible.map((virtualRow) => {
                    const index = virtualRow.index,
                        transaction = ordered[index];
                    const parent = parents.get(
                        transaction.parentTransactionId ?? "",
                    );
                    const rowProps = {
                        "data-index": index,
                        "data-transaction-id": transaction.id,
                        ref: virtualizer.measureElement,
                        style: {
                            position: "absolute" as const,
                            top: 0,
                            left: 0,
                            width: "100%",
                            transform: `translateY(${virtualRow.start}px)`,
                        },
                    };
                    let display: TransactionListPresentation;
                    try {
                        display = getTransactionListPresentation(
                            transaction,
                            context,
                            parent,
                        );
                    } catch {
                        return (
                            <div key={transaction.id} {...rowProps}>
                                <button
                                    type="button"
                                    className="p-4 text-sm"
                                    onClick={() => {
                                        if (!preparing)
                                            void showTransactionInfo(
                                                transaction,
                                            ).catch(() => {});
                                    }}
                                >
                                    {transaction.description ||
                                        labelTransaction(transaction)}{" "}
                                    · 金额超出显示范围，点击查看分录
                                </button>
                            </div>
                        );
                    }
                    const date = bookDayjs(transaction.time);
                    const label = formatListLabel(
                        display,
                        t,
                        false,
                        showPeriodDates,
                    );
                    const fee = display.fee;
                    const openTransaction = () => {
                        if (!preparing)
                            void showTransactionInfo(transaction).catch(
                                () => {},
                            );
                    };
                    return (
                        <div key={transaction.id} {...rowProps}>
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
                                formattedAmount={
                                    preparing
                                        ? "…"
                                        : formatListAmount(display.amount, t)
                                }
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
                            {!preparing &&
                                showChildren &&
                                !!transaction.children?.length && (
                                    <TransactionChildren
                                        parent={transaction}
                                        context={context}
                                        disabled={preparing}
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
                                    formattedAmount={
                                        preparing
                                            ? "…"
                                            : formatListAmount(fee.amount, t)
                                    }
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
                        </div>
                    );
                })}
                {!ordered.length && !loading && (
                    <p className="text-xs p-4 text-center">
                        这里还没有记录，点击下方“＋”记一笔。
                    </p>
                )}
            </div>
            {(loading || hasMore) && (
                <button
                    type="button"
                    disabled={loading}
                    onClick={onLoadMore}
                    className="block w-full p-4 text-sm"
                >
                    {loading ? "正在加载账单…" : "加载更多"}
                </button>
            )}
        </div>
    );
}
