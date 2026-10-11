import { sumAmounts } from "./amount";
import { replayCurrencyCosts } from "./currency-cost";
import { getCurrencyExchangeRate } from "./currency-exchange";
import type { Account, Transaction } from "./types";

export type ExchangeRateGraph = ReadonlyMap<
    string,
    ReadonlyMap<string, number>
>;

/** 外币与自定义币种统一取剩余成本平均比例；正反报价均派生，不持久化。 */
export function deriveExchangeRates(
    accounts: readonly Account[],
    transactions: readonly Transaction[],
    baseCurrency = "CNY",
): ExchangeRateGraph {
    const costLedger = replayCurrencyCosts(
        accounts,
        transactions,
        undefined,
        baseCurrency,
    );
    const accountById = new Map(
        costLedger.accounts.map((account) => [account.id, account]),
    );
    const graph = new Map<string, Map<string, number>>();
    const exchanges = transactions
        .filter(
            (transaction) =>
                !!transaction.exchange &&
                ["currency_exchange", "topup"].includes(transaction.type) &&
                !accountById.get(transaction.exchange?.toAccountId ?? "")
                    ?.costCurrency &&
                !accountById.get(transaction.exchange?.fromAccountId ?? "")
                    ?.costCurrency,
        )
        .sort(
            (left, right) =>
                right.time - left.time ||
                right.updatedAt - left.updatedAt ||
                right.createdAt - left.createdAt ||
                right.id.localeCompare(left.id),
        );
    const put = (from: string, to: string, rate: number) => {
        const quotes = graph.get(from) ?? new Map<string, number>();
        quotes.set(to, rate);
        graph.set(from, quotes);
    };
    for (const transaction of exchanges) {
        const exchange = transaction.exchange;
        if (!exchange) throw new Error("Missing currency exchange details");
        const from = accountById.get(exchange.fromAccountId)?.currency;
        const to = accountById.get(exchange.toAccountId)?.currency;
        if (!from || !to || from === to)
            throw new Error("Invalid currency exchange accounts");
        if (graph.get(from)?.has(to)) continue;
        const rate = getCurrencyExchangeRate(transaction);
        put(from, to, rate);
        put(to, from, 1 / rate);
    }
    const pools = new Map<
        string,
        Map<string, { bookAmount: number | undefined; nativeAmount: number }>
    >();
    for (const account of costLedger.accounts) {
        if (!account.costCurrency) continue;
        const balance = costLedger.balances.get(account.id);
        if (!balance || !balance.amount) continue;
        const currencies = pools.get(account.currency) ?? new Map();
        const before = currencies.get(account.costCurrency) ?? {
            bookAmount: 0,
            nativeAmount: 0,
        };
        currencies.set(account.costCurrency, {
            bookAmount:
                before.bookAmount === undefined ||
                balance.bookAmount === undefined
                    ? undefined
                    : sumAmounts([before.bookAmount, balance.bookAmount]),
            nativeAmount: sumAmounts([before.nativeAmount, balance.amount]),
        });
        pools.set(account.currency, currencies);
    }
    for (const [currency, costs] of pools)
        for (const [costCurrency, balance] of costs) {
            if (
                balance.bookAmount === undefined ||
                balance.bookAmount <= 0 ||
                balance.nativeAmount <= 0
            )
                continue;
            put(
                currency,
                costCurrency,
                balance.bookAmount / balance.nativeAmount,
            );
            put(
                costCurrency,
                currency,
                balance.nativeAmount / balance.bookAmount,
            );
        }
    return graph;
}

/** 先使用直接成交比例，再选择最少中转币种的路径；无依据返回 undefined。 */
export function exchangeValueRate(
    graph: ExchangeRateGraph,
    from: string,
    to: string,
): number | undefined {
    if (from === to) return 1;
    const queue = [{ currency: from, rate: 1 }];
    const visited = new Set([from]);
    for (let index = 0; index < queue.length; index++) {
        const current = queue[index];
        for (const [currency, quote] of graph.get(current.currency) ?? []) {
            if (visited.has(currency)) continue;
            const rate = current.rate * quote;
            if (!Number.isFinite(rate) || rate <= 0) continue;
            if (currency === to) return rate;
            visited.add(currency);
            queue.push({ currency, rate });
        }
    }
    return undefined;
}
