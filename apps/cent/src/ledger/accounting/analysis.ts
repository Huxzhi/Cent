import { addZonedDays, zonedDate } from "../../utils/time";
import { sumAmounts } from "./amount";
import type { AccountingData } from "./backup";
import { getCurrencyExpenseCategory } from "./currency-expense";
import { getEntryAmount, getEntryCurrency } from "./entry-amount";
import { getPurchaseDepreciationState } from "./purchase-depreciation";
import {
    getStatisticsAccountIds,
    getStatisticsAssetUsage,
    matchesStatisticsAmount,
    matchesStatisticsTransaction,
    type StatisticsBucket,
    type StatisticsFilter,
    type StatisticsLine,
    statisticsFilterSource,
} from "./statistics";
import {
    getTransactionAmountInRange,
    matchesTransactionDateRange,
} from "./time-range";
import type { AccountType } from "./types";

export const analysisAccountTypes: AccountType[] = [
    "income",
    "expense",
    "asset",
    "liability",
    "equity",
];

/** 先筛交易，再选分录；金额直接读取保存值，不因筛选重算汇率或平均成本。 */
export function getAnalysisLines(
    data: AccountingData,
    filter: StatisticsFilter,
    asOf = filter.end,
): StatisticsLine[] {
    const end = Math.min(filter.end, asOf);
    if (filter.start > end) return [];
    const byId = new Map(data.accounts.map((account) => [account.id, account]));
    const transactions = new Map(
        data.transactions.map((transaction) => [transaction.id, transaction]),
    );
    const types = new Set(filter.accountTypes ?? analysisAccountTypes);
    const selected = filter.accountId
        ? getStatisticsAccountIds(data.accounts, filter.accountId)
        : undefined;
    const lines: StatisticsLine[] = [];
    for (const transaction of data.transactions) {
        const purchase =
            transaction.type === "depreciation" &&
            transaction.parentTransactionId
                ? transactions.get(transaction.parentTransactionId)
                : undefined;
        if (filter.derivedOnly && !purchase) continue;
        if (
            !matchesTransactionDateRange(transaction, filter.start, end + 1) ||
            !matchesStatisticsTransaction(
                statisticsFilterSource(transaction, purchase, filter),
                filter,
                data.accounts,
            )
        )
            continue;
        if (
            purchase &&
            filter.depreciationStatus &&
            getPurchaseDepreciationState(
                purchase,
                data.accounts,
                data.transactions,
                end,
                data.timeZone,
            )?.status !== filter.depreciationStatus
        )
            continue;
        for (const entry of transaction.entries) {
            const account = byId.get(entry.accountId);
            if (!account || !types.has(account.type)) continue;
            const category = getCurrencyExpenseCategory(account, data.accounts);
            if (
                selected &&
                !selected.has(account.id) &&
                !selected.has(category.id)
            )
                continue;
            if (
                filter.accountIds &&
                !filter.accountIds.includes(account.id) &&
                !filter.accountIds.includes(category.id)
            )
                continue;
            if (
                filter.assetUsage &&
                account.type === "asset" &&
                getStatisticsAssetUsage(account) !== filter.assetUsage
            )
                continue;
            if (
                filter.amountCurrency &&
                getEntryCurrency(entry, account) !== filter.amountCurrency
            )
                continue;
            const value = filter.amountCurrency
                ? getEntryAmount(entry)
                : entry.amount;
            const sign = ["income", "liability", "equity"].includes(
                account.type,
            )
                ? -1
                : 1;
            const fullAmount =
                getTransactionAmountInRange(
                    transaction,
                    value,
                    filter.start,
                    end + 1,
                    data.timeZone,
                ) * sign;
            // 金额筛选针对所选期间内的完整分录，不针对单日折旧碎片。
            if (!matchesStatisticsAmount(fullAmount, filter)) continue;
            const append = (time: number, until: number) => {
                const amount =
                    getTransactionAmountInRange(
                        transaction,
                        value,
                        time,
                        until,
                        data.timeZone,
                    ) * sign;
                lines.push({
                    transaction: { ...transaction, time },
                    accountId: category.id,
                    nativeAccountId: account.id,
                    type: account.type,
                    amount,
                    ...(purchase ? { purchaseId: purchase.id } : {}),
                });
            };
            if (transaction.endTime === undefined)
                append(transaction.time, transaction.time + 1);
            else {
                let time = Math.max(transaction.time, filter.start);
                while (time < Math.min(transaction.endTime, end + 1)) {
                    const next = addZonedDays(
                        zonedDate(time, data.timeZone).startOf("day").valueOf(),
                        1,
                        data.timeZone,
                    );
                    const until = Math.min(next, transaction.endTime, end + 1);
                    append(time, until);
                    time = until;
                }
            }
        }
    }
    return lines;
}

export function getAnalysisTotals(lines: readonly StatisticsLine[]) {
    const increase = sumAmounts(
        lines.filter((line) => line.amount > 0).map((line) => line.amount),
    );
    const decrease = -sumAmounts(
        lines.filter((line) => line.amount < 0).map((line) => line.amount),
    );
    return { increase, decrease, net: sumAmounts([increase, -decrease]) };
}

export function getAnalysisTrend(
    lines: readonly StatisticsLine[],
    buckets: readonly StatisticsBucket[],
) {
    return buckets.map((bucket) => ({
        time: bucket.time,
        ...getAnalysisTotals(
            lines.filter(
                (line) =>
                    line.transaction.time >= bucket.time &&
                    line.transaction.time <= bucket.end,
            ),
        ),
    }));
}
