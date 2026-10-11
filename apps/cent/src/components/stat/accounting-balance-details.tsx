import type { StatisticsBalanceLine } from "../../ledger/accounting/statistics";
import type { Account, Transaction } from "../../ledger/accounting/types";
import { bookDayjs as dayjs } from "../../utils/time";
import { useAccountingLabels } from "../accounting/i18n";
import { accountFlow, Modal, money } from "../accounting/shared";
import { showTransactionInfo } from "../bill-info/transaction";
import { Button } from "../ui/button";

export default function AccountingBalanceDetails({
    lines,
    accounts,
    transactions,
    currency,
    title,
    onClose,
}: {
    lines: StatisticsBalanceLine[];
    accounts: Account[];
    transactions: Transaction[];
    currency: string;
    title: string;
    onClose: () => void;
}) {
    const { t, labelAccount } = useAccountingLabels();
    return (
        <Modal title={title} onClose={onClose}>
            <p className="text-xs text-muted-foreground my-3">
                {t("stat-activity-details-help")}
            </p>
            <div className="divide-y">
                {!lines.length && (
                    <p className="text-center text-muted-foreground py-8">
                        {t("stat-no-data")}
                    </p>
                )}
                {[...lines]
                    .sort((a, b) => b.transaction.time - a.transaction.time)
                    .map(({ transaction, amount }) => {
                        const original = transactions.find(
                            (item) => item.id === transaction.id,
                        );
                        const purchase =
                            !original &&
                            transactions.find(
                                (item) =>
                                    item.id === transaction.parentTransactionId,
                            );
                        return (
                            <div
                                key={transaction.id}
                                className="py-3 text-sm space-y-1"
                            >
                                <div className="flex justify-between gap-2">
                                    <span>
                                        {original
                                            ? accountFlow(
                                                  transaction,
                                                  accounts,
                                                  labelAccount,
                                              )
                                            : t("stat-depreciation-entry")}
                                    </span>
                                    <span
                                        className={
                                            amount < 0
                                                ? "text-semantic-expense"
                                                : "text-semantic-income"
                                        }
                                    >
                                        {amount > 0 ? "+" : ""}
                                        {money(amount, currency)}
                                    </span>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    {dayjs(transaction.time).format(
                                        "YYYY-MM-DD HH:mm",
                                    )}{" "}
                                    · {transaction.description}
                                </p>
                                {(original || purchase) && (
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => {
                                            void showTransactionInfo(
                                                (original ??
                                                    purchase) as Transaction,
                                            ).catch(() => {});
                                        }}
                                    >
                                        {t(
                                            original
                                                ? "stat-view-transaction"
                                                : "stat-view-acquisition",
                                        )}
                                    </Button>
                                )}
                            </div>
                        );
                    })}
            </div>
        </Modal>
    );
}
