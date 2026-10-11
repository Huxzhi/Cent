import type { AccountingData } from "./backup";
import { projectTransactionThrough } from "./time-range";
import type { Transaction } from "./types";

/** 账户余额共用截止读取：期间子交易按截止日期已消耗部分计量。 */
export function getAccountingHistoryThrough(
    data: AccountingData,
    asOf: number,
    splitAt?: number,
): Transaction[] {
    const transactions = data.transactions;
    return transactions.flatMap((transaction) => {
        const snapshot = projectTransactionThrough(
            transaction,
            asOf,
            data.timeZone,
        );
        if (!snapshot) return [];
        if (
            splitAt === undefined ||
            transaction.endTime === undefined ||
            transaction.time >= splitAt
        )
            return [snapshot];
        const before = projectTransactionThrough(
            transaction,
            splitAt - 1,
            data.timeZone,
        );
        if (!before) return [snapshot];
        const remainder = {
            ...snapshot,
            time: splitAt,
            entries: snapshot.entries.map((entry, index) => ({
                ...entry,
                amount: entry.amount - before.entries[index].amount,
                ...(entry.currency
                    ? {
                          currency: {
                              ...entry.currency,
                              amount:
                                  entry.currency.amount -
                                  (before.entries[index].currency?.amount ?? 0),
                          },
                      }
                    : {}),
            })),
        };
        return [
            { ...before, id: `${transaction.id}:before-range` },
            ...(remainder.entries.some(
                (entry) => entry.amount || entry.currency?.amount,
            )
                ? [remainder]
                : []),
        ];
    });
}
