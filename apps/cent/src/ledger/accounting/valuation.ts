import { sumAmounts } from "./amount";
import { getAccountDisplayBalance } from "./balance";
import { type CurrencyCostBalance, replayCurrencyCosts } from "./currency-cost";
import type { Account, Transaction } from "./types";

/** 每个独立账户只统计一次，父账户不重复汇总子账户。包含归档账户的历史余额。 */
export function getAccountValuationRows(
    accounts: readonly Account[],
    transactions: readonly Transaction[],
    rate: (currency: string) => number | undefined,
    baseCurrency = "CNY",
) {
    const costs = replayCurrencyCosts(
        accounts,
        transactions,
        undefined,
        baseCurrency,
    ).balances;
    return getBalanceValuationRows(
        accounts,
        costs,
        (account) => getAccountDisplayBalance(account, transactions),
        rate,
        baseCurrency,
    );
}

/** 余额快照共用同一估值规则；统计重放传入当前余额，避免为每笔交易重放整个历史。 */
export function getBalanceValuationRows(
    accounts: readonly Account[],
    costs: ReadonlyMap<string, CurrencyCostBalance>,
    getBalance: (account: Account) => number,
    rate: (currency: string) => number | undefined,
    baseCurrency = "CNY",
) {
    const rows: {
        account: Account;
        amount: number | undefined;
        currency: string;
    }[] = [];
    for (const account of accounts) {
        if (account.type !== "asset" && account.type !== "liability") continue;
        const cost = costs.get(account.id);
        if (cost?.amount && cost.bookAmount === undefined) {
            rows.push({
                account,
                amount: undefined,
                currency: account.currency,
            });
            continue;
        }
        const balance = cost ? (cost.bookAmount ?? 0) : getBalance(account);
        if (!balance) {
            rows.push({ account, amount: 0, currency: baseCurrency });
            continue;
        }
        const currency = cost?.costCurrency ?? account.currency;
        const valueRate = rate(currency);
        if (
            valueRate === undefined ||
            !Number.isFinite(valueRate) ||
            valueRate <= 0
        ) {
            rows.push({ account, amount: undefined, currency });
            continue;
        }
        const amount = Math.round(balance * valueRate);
        rows.push({ account, amount, currency: baseCurrency });
    }
    return rows;
}

export function getAssetValuation(
    accounts: readonly Account[],
    transactions: readonly Transaction[],
    rate: (currency: string) => number | undefined,
    baseCurrency = "CNY",
) {
    const rows = getAccountValuationRows(
        accounts,
        transactions,
        rate,
        baseCurrency,
    );
    const asset = sumAmounts(
        rows
            .filter((row) => row.account.type === "asset")
            .map((row) => row.amount ?? 0),
    );
    const liability = sumAmounts(
        rows
            .filter((row) => row.account.type === "liability")
            .map((row) => row.amount ?? 0),
    );
    return {
        asset,
        liability,
        net: sumAmounts([asset, -liability]),
        missing: [
            ...new Set(
                rows
                    .filter((row) => row.amount === undefined)
                    .map((row) => row.currency),
            ),
        ].sort(),
    };
}
