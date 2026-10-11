import { assertAmount } from "./amount";

/** 数量与成本均为 10000:1；BigInt 中间计算，清空账户时取尽余数。 */
export function calculateAverageCost(
    bookAmount: number,
    balanceAmount: number,
    spentAmount: number,
): number {
    for (const amount of [bookAmount, balanceAmount, spentAmount])
        assertAmount(amount);
    if (bookAmount < 0 || balanceAmount <= 0 || spentAmount <= 0)
        throw new Error("账户成本必须非负，余额和扣款金额必须为正数。");
    if (spentAmount > balanceAmount) throw new Error("账户余额不足。");
    if (spentAmount === balanceAmount) return bookAmount;
    const numerator = BigInt(spentAmount) * BigInt(bookAmount),
        denominator = BigInt(balanceAmount);
    const cost = Number((numerator * 2n + denominator) / (denominator * 2n));
    assertAmount(cost);
    return cost;
}
