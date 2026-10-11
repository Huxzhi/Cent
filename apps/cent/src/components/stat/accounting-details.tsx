import { sumAmounts } from "../../ledger/accounting";
import type { StatisticsLine } from "../../ledger/accounting/statistics";
import type { Account, Transaction } from "../../ledger/accounting/types";
import { bookDayjs as dayjs } from "../../utils/time";
import { useAccountingLabels } from "../accounting/i18n";
import { accountFlow, Modal, money } from "../accounting/shared";
import { showTransactionInfo } from "../bill-info/transaction";
import { Button } from "../ui/button";

export default function AccountingStatisticsDetails({
    lines,
    accounts,
    transactions,
    currency,
    onClose,
}: {
    lines: StatisticsLine[];
    accounts: Account[];
    transactions: Transaction[];
    currency: string;
    onClose: () => void;
}) {
    const { t, labelAccount } = useAccountingLabels();
    const groups = new Map<string, StatisticsLine[]>();
    for (const line of lines) {
        const key =
            line.transaction.endTime === undefined
                ? line.transaction.id
                : `${line.transaction.id}:${dayjs(line.transaction.time).format("YYYY-MM-DD")}`;
        groups.set(key, [...(groups.get(key) ?? []), line]);
    }
    return (
        <Modal title={t("stat-entry-details")} onClose={onClose}>
            <p className="text-xs text-muted-foreground my-3">
                {t("stat-entry-details-help")}
            </p>
            <div className="divide-y">
                {!groups.size && (
                    <p className="text-center text-muted-foreground py-8">
                        {t("stat-no-data")}
                    </p>
                )}
                {[...groups.entries()]
                    .sort(
                        ([, a], [, b]) =>
                            b[0].transaction.time - a[0].transaction.time,
                    )
                    .map(([key, items]) => {
                        const transaction = items[0].transaction;
                        const original = transactions.find(
                            (item) => item.id === transaction.id,
                        );
                        const purchase =
                            !original &&
                            transactions.find(
                                (item) =>
                                    item.id === transaction.parentTransactionId,
                            );
                        const amount = sumAmounts(
                            items.map((line) =>
                                line.type === "expense"
                                    ? -line.amount
                                    : line.amount,
                            ),
                        );
                        return (
                            <div
                                key={key}
                                className="py-3 text-sm space-y-1"
                                data-statistics-day={
                                    transaction.endTime === undefined
                                        ? undefined
                                        : dayjs(transaction.time).format(
                                              "YYYY-MM-DD",
                                          )
                                }
                            >
                                <div className="flex justify-between gap-2">
                                    <span>
                                        {items[0].purchaseId
                                            ? t("stat-depreciation-entry")
                                            : accountFlow(
                                                  transaction,
                                                  accounts,
                                                  labelAccount,
                                              )}
                                    </span>
                                    <span
                                        className={
                                            amount < 0
                                                ? "text-semantic-expense"
                                                : "text-semantic-income"
                                        }
                                    >
                                        {money(
                                            amount,
                                            currency,
                                            currency ? undefined : false,
                                        )}
                                    </span>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    {transaction.endTime === undefined
                                        ? dayjs(
                                              original?.time ??
                                                  transaction.time,
                                          ).format("YYYY-MM-DD HH:mm")
                                        : dayjs(transaction.time).format(
                                              "YYYY-MM-DD",
                                          )}{" "}
                                    ·{" "}
                                    {[
                                        ...new Set(
                                            items.map((line) =>
                                                labelAccount(
                                                    accounts.find(
                                                        (account) =>
                                                            account.id ===
                                                            line.accountId,
                                                    ) as Account,
                                                ),
                                            ),
                                        ),
                                    ].join("、")}
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
