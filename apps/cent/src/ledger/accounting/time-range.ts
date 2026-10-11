import { zonedDayIndex } from "../../utils/time";
import { assertAmount, sumAmounts } from "./amount";
import type { Transaction } from "./types";

export type TransactionTimeRange = Pick<Transaction, "time" | "endTime"> &
    Partial<Pick<Transaction, "type">>;

export function validateTransactionTimeRange(value: TransactionTimeRange) {
    for (const time of [value.time, value.endTime]) {
        if (
            time !== undefined &&
            (!Number.isSafeInteger(time) ||
                time < 0 ||
                !Number.isFinite(new Date(time).getTime()))
        )
            throw new RangeError(
                "Transaction timestamps must be valid nonnegative safe integers",
            );
    }
    if (value.endTime !== undefined && value.endTime <= value.time)
        throw new RangeError("Transaction endTime must be after time");
}

/** 查询区间为 [start, end)；点交易按发生时间，区间交易按交集命中。 */
export function matchesTransactionDateRange(
    value: TransactionTimeRange,
    start: number,
    end: number,
) {
    if (start >= end) return false;
    return value.endTime === undefined
        ? value.time >= start && value.time < end
        : value.time < end && value.endTime > start;
}

/** 普通区间按时长分摊，自动折旧按自然日计入；累计整数差额保证分段守恒。 */
export function getTransactionAmountInRange(
    value: TransactionTimeRange,
    amount: number,
    start: number,
    end: number,
    timeZone?: string,
) {
    assertAmount(amount);
    if (!matchesTransactionDateRange(value, start, end)) return 0;
    if (value.endTime === undefined) return amount;
    const endTime = value.endTime;
    // 购入当日起每日确认一份费用，不将一天的折旧继续细分成秒。
    // 首日从实际购买时刻生效；后续日从当地零点生效，结束边界保持排他。
    if (value.type === "depreciation") {
        const dayIndex = (time: number) => zonedDayIndex(time, timeZone);
        const first = dayIndex(value.time);
        const days = BigInt(dayIndex(endTime - 1) - first + 1);
        const cumulative = (boundary: number) => {
            if (boundary <= value.time) return 0;
            const consumed = BigInt(
                dayIndex(Math.min(boundary, endTime) - 1) - first + 1,
            );
            return (
                Number(
                    (BigInt(Math.abs(amount)) * consumed + days / 2n) / days,
                ) * Math.sign(amount)
            );
        };
        return cumulative(end) - cumulative(start);
    }
    const cumulative = (boundary: number) => {
        const elapsed = Math.max(
            0,
            Math.min(endTime - value.time, boundary - value.time),
        );
        const duration = BigInt(endTime - value.time);
        return (
            Number(
                (BigInt(Math.abs(amount)) * BigInt(elapsed) + duration / 2n) /
                    duration,
            ) * Math.sign(amount)
        );
    };
    return cumulative(end) - cumulative(start);
}

/** 只供余额/成本读取的截止快照，不改原记录，不保存快照或新增每日交易。 */
export function projectTransactionThrough(
    transaction: Transaction,
    through: number,
    timeZone?: string,
): Transaction | undefined {
    if (transaction.time > through) return undefined;
    if (transaction.endTime === undefined) return transaction;
    const { endTime: _end, ...snapshot } = transaction;
    const entries = transaction.entries.map((entry) => ({
        ...entry,
        amount: getTransactionAmountInRange(
            transaction,
            entry.amount,
            transaction.time,
            through + 1,
            timeZone,
        ),
        ...(entry.currency
            ? {
                  currency: {
                      ...entry.currency,
                      amount: getTransactionAmountInRange(
                          transaction,
                          entry.currency.amount,
                          transaction.time,
                          through + 1,
                          timeZone,
                      ),
                  },
              }
            : {}),
    }));
    // 多条分录独立舍入时，最大的分录承接最小单位差额，保持读取快照平衡。
    const anchor = entries.reduce(
        (best, _entry, index) =>
            Math.abs(transaction.entries[index].amount) >
            Math.abs(transaction.entries[best].amount)
                ? index
                : best,
        0,
    );
    const remainder = sumAmounts(entries.map((entry) => entry.amount));
    if (remainder)
        entries[anchor].amount = sumAmounts([
            entries[anchor].amount,
            -remainder,
        ]);
    return { ...snapshot, entries };
}
