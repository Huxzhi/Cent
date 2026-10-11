import { assertAmount, sumAmounts } from "./amount";
import {
    type CurrencyCostReplay,
    getCurrencyCostEquityChange,
} from "./currency-cost";
import { getCurrencyExchangeAmounts } from "./currency-exchange";
import { getEntryAmount } from "./entry-amount";
import { convertDisplayAmount } from "./presentation";
import type { Account, Transaction } from "./types";

/** 整数比例换算，四位小数舍入；负数与正数对称，拒绝结果溢出。 */
function scaleAmount(amount: number, numerator: number, denominator: number) {
    for (const value of [amount, numerator, denominator]) assertAmount(value);
    if (denominator === 0) throw new Error("Missing display conversion basis");
    const product = BigInt(amount) * BigInt(numerator);
    const divisor = BigInt(denominator);
    const negative = product < 0n !== divisor < 0n;
    const absolute = product < 0n ? -product : product;
    const basis = divisor < 0n ? -divisor : divisor;
    const rounded = (absolute + basis / 2n) / basis;
    const result = Number(negative ? -rounded : rounded);
    assertAmount(result);
    return result === 0 ? 0 : result;
}

/**
 * 净资产变化 = 资产变化 - 负债变化。
 * Entry 借方为正，负债借方表示减少，所以资产和负债分录都直接累加。
 * 权益、收入、费用分录不重复累加；父账户不展开，关联子交易单独计算。
 * 换汇按实际收付分录倒推成交比例；其他展示换算由调用方提供。
 */
export function getTransactionEquityChange(
    transaction: Transaction,
    accounts: readonly Account[],
    displayCurrency?: string,
    valueRate?: (from: string, to: string) => number | undefined,
    history?: readonly Transaction[] | CurrencyCostReplay,
): { amount: number; currency: string } {
    const costChange =
        history && getCurrencyCostEquityChange(transaction, accounts, history);
    if (costChange) {
        if (!displayCurrency || displayCurrency === costChange.currency)
            return costChange;
        if (
            transaction.type === "expense" &&
            !transaction.exchange &&
            transaction.entries.some(
                (entry) => entry.currency?.target === displayCurrency,
            )
        )
            return {
                amount: sumAmounts(
                    transaction.entries
                        .filter(
                            (entry) =>
                                accounts.find(
                                    (account) => account.id === entry.accountId,
                                )?.type === "asset",
                        )
                        .map(getEntryAmount),
                ),
                currency: displayCurrency,
            };
        if (costChange.amount === 0)
            return { amount: 0, currency: displayCurrency };
        const rate = valueRate?.(costChange.currency, displayCurrency);
        return rate === undefined
            ? costChange
            : {
                  amount: convertDisplayAmount(costChange.amount, rate),
                  currency: displayCurrency,
              };
    }
    const accountById = new Map(
        accounts.map((account) => [account.id, account]),
    );
    const byCurrency = new Map<string, number[]>();
    for (const entry of transaction.entries) {
        const account = accountById.get(entry.accountId);
        if (!account) throw new Error(`Account not found: ${entry.accountId}`);
        if (account.type !== "asset" && account.type !== "liability") continue;
        const amounts = byCurrency.get(account.currency) ?? [];
        amounts.push(getEntryAmount(entry));
        byCurrency.set(account.currency, amounts);
    }
    const exchange = transaction.exchange;
    const exchangedAmounts =
        exchange && getCurrencyExchangeAmounts(transaction);
    const targetCurrency =
        exchange && accountById.get(exchange.toAccountId)?.currency;
    const sourceCurrency =
        exchange && accountById.get(exchange.fromAccountId)?.currency;
    const principal =
        exchangedAmounts &&
        sumAmounts([exchangedAmounts.withdrawn, -exchangedAmounts.fee]);
    const amounts = [...byCurrency].map(([currency, entries]) => {
        const amount = sumAmounts(entries);
        if (currency === transaction.currency) return amount;
        if (
            exchange &&
            principal !== undefined &&
            currency === targetCurrency &&
            transaction.currency === sourceCurrency
        )
            return scaleAmount(
                amount,
                principal,
                exchangedAmounts?.received ?? 0,
            );
        if (
            exchange &&
            principal !== undefined &&
            currency === sourceCurrency &&
            transaction.currency === targetCurrency
        )
            return scaleAmount(
                amount,
                exchangedAmounts?.received ?? 0,
                principal,
            );
        throw new Error(`Missing execution conversion: ${currency}`);
    });
    const nativeAmount = sumAmounts(amounts);
    const currency = displayCurrency ?? transaction.currency;
    if (currency === transaction.currency)
        return { amount: nativeAmount, currency };
    if (nativeAmount === 0) return { amount: 0, currency };
    if (
        exchange &&
        principal !== undefined &&
        currency === targetCurrency &&
        transaction.currency === sourceCurrency
    )
        return {
            amount: scaleAmount(
                nativeAmount,
                exchangedAmounts?.received ?? 0,
                principal,
            ),
            currency,
        };
    if (
        exchange &&
        principal !== undefined &&
        currency === sourceCurrency &&
        transaction.currency === targetCurrency
    )
        return {
            amount: scaleAmount(
                nativeAmount,
                principal,
                exchangedAmounts?.received ?? 0,
            ),
            currency,
        };
    const rate = valueRate?.(transaction.currency, currency);
    if (rate !== undefined) {
        return { amount: convertDisplayAmount(nativeAmount, rate), currency };
    }
    // 没有换算依据时明确展示原币。
    return { amount: nativeAmount, currency: transaction.currency };
}
