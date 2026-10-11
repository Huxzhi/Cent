import {
    getChildTransactions,
    type Transaction,
} from "../../ledger/accounting";
import {
    getTransactionListPresentation,
    type TransactionListContext,
    type TransactionListPresentation,
} from "../../ledger/accounting/list-presentation";
import { useAccountingLabels } from "../accounting/i18n";
import { accountFlow, accountName } from "../accounting/shared";
import { showTransactionInfo } from "../bill-info/transaction";
import {
    formatListAmount,
    formatListLabel,
    listAmountClass,
    TransactionMetadata,
    TransactionPeriod,
} from "./transaction-display";

/** 关联记录复用主条目的展示规则，只使用紧凑布局。 */
export default function TransactionChildren({
    parent,
    transactions,
    context,
    nested = false,
}: {
    parent: Transaction;
    transactions: Transaction[];
    context: TransactionListContext;
    nested?: boolean;
}) {
    const { t, labelAccount, labelTransaction } = useAccountingLabels();
    const children = getChildTransactions(parent.id, transactions);
    if (!children.length) return null;
    const rows = children.map((child) => {
        let display: TransactionListPresentation;
        try {
            display = getTransactionListPresentation(child, context, parent);
        } catch {
            return (
                <button
                    key={child.id}
                    type="button"
                    className="block py-1 text-left text-muted-foreground"
                    onClick={() => {
                        void showTransactionInfo(child).catch(() => {});
                    }}
                >
                    ↳ {labelTransaction(child)} ·{" "}
                    {t("accounting-conversion-pending")}
                </button>
            );
        }
        const fee = display.fee;
        const open = () => {
            void showTransactionInfo(child).catch(() => {});
        };
        return (
            <div key={child.id}>
                <button
                    type="button"
                    className="w-full flex justify-between items-start gap-2 text-left cursor-pointer rounded py-1 hover:bg-muted/40"
                    data-child-transaction={child.id}
                    title={accountFlow(child, context.accounts, labelAccount)}
                    onClick={open}
                >
                    <span
                        aria-hidden
                        className="text-muted-foreground shrink-0"
                    >
                        ↳
                    </span>
                    <span className="min-w-0 flex-1">
                        <span className="flex justify-between items-start gap-2">
                            <span className="text-muted-foreground break-words">
                                {formatListLabel(display, t, true)}
                            </span>
                            <span
                                className={`shrink-0 tabular-nums ${listAmountClass(display.amount.tone)}`}
                            >
                                {formatListAmount(display.amount, t)}
                            </span>
                        </span>
                        <TransactionMetadata
                            description={display.description}
                            supplement={display.supplement}
                            t={t}
                        />
                        <TransactionPeriod period={display.period} t={t} />
                    </span>
                </button>
                {fee && (
                    <button
                        type="button"
                        className="w-full flex justify-between items-start gap-2 rounded py-1 pl-4 text-left cursor-pointer hover:bg-muted/40"
                        data-child-fee={child.id}
                        title={`${labelAccount(fee.source)} → ${accountName(fee.account, context.accounts, labelAccount)}`}
                        onClick={open}
                    >
                        <TransactionMetadata
                            label={t(fee.labelKey)}
                            supplement={fee.supplement}
                            t={t}
                        />
                        <span
                            className={`shrink-0 tabular-nums ${listAmountClass(fee.amount.tone)}`}
                        >
                            {formatListAmount(fee.amount, t)}
                        </span>
                    </button>
                )}
                <TransactionChildren
                    parent={child}
                    transactions={transactions}
                    context={context}
                    nested
                />
            </div>
        );
    });
    return (
        <div
            className={
                nested ? "pl-2 pt-1 text-xs" : "pl-20 pr-4 pb-3 -mt-2 text-xs"
            }
            data-transaction-children={parent.id}
        >
            {children.length === 1 ? (
                rows
            ) : (
                <details className="group">
                    <summary className="list-none flex items-center gap-1 w-fit cursor-pointer text-muted-foreground py-1">
                        <i
                            aria-hidden
                            className="icon-[mdi--chevron-right] size-3 transition-transform group-open:rotate-90"
                        />
                        {t("accounting-related-records", {
                            count: children.length,
                        })}
                    </summary>
                    <div className="pl-2 border-l mt-1 space-y-1">{rows}</div>
                </details>
            )}
        </div>
    );
}
