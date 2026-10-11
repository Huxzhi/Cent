import { validateAccounts } from "./account";
import { sumAmounts } from "./amount";
import { calculateAverageCost } from "./average-cost";
import { getCurrencyExchangeAmounts } from "./currency-exchange";
import { getEntryAmount } from "./entry-amount";
import type { Account, Transaction } from "./types";
import { validateTransactions } from "./validation";

export interface CurrencyCostBalance {
    amount: number;
    /** 未知成本不伪装为 1:1；无余额时成本重新归零。 */
    bookAmount: number | undefined;
    costCurrency: string;
}

/** 新账户明确保存成本币种；已有外币账户可从换汇资金来源推导，不改历史记录。 */
export function resolveCurrencyCostAccounts(
    accounts: readonly Account[],
    transactions: readonly Transaction[],
    baseCurrency = "CNY",
) {
    const result = new Map(accounts.map((account) => [account.id, account]));
    let updated = true;
    while (updated) {
        updated = false;
        for (const transaction of [...transactions].sort(
            (a, b) =>
                a.time - b.time ||
                a.createdAt - b.createdAt ||
                a.id.localeCompare(b.id),
        )) {
            const exchange = transaction.exchange;
            const source = exchange
                ? result.get(exchange.fromAccountId)
                : transaction.entries
                      .filter((entry) => getEntryAmount(entry) < 0)
                      .map((entry) => result.get(entry.accountId))
                      .find(
                          (account) =>
                              account?.type === "asset" && account.costCurrency,
                      );
            if (!source) continue;
            const costCurrency = source.costCurrency ?? source.currency;
            for (const entry of transaction.entries.filter(
                (entry) => getEntryAmount(entry) > 0,
            )) {
                const target = result.get(entry.accountId);
                if (
                    !target ||
                    target.type !== "asset" ||
                    target.costCurrency ||
                    target.currency === baseCurrency ||
                    target.currency === costCurrency
                )
                    continue;
                if (!exchange && target.currency !== source.currency) continue;
                result.set(target.id, { ...target, costCurrency });
                updated = true;
            }
        }
    }
    return [...result.values()];
}

/** 唯一的外币/自定义币种成本引擎：余额和成本池按账户独立重放。 */
export function replayCurrencyCosts(
    accounts: readonly Account[],
    transactions: readonly Transaction[],
    now?: number,
    baseCurrency = "CNY",
) {
    const resolvedAccounts = resolveCurrencyCostAccounts(
        accounts,
        transactions,
        baseCurrency,
    );
    const byId = new Map(
        resolvedAccounts.map((account) => [account.id, account]),
    );
    const balances = new Map<string, CurrencyCostBalance>();
    for (const account of resolvedAccounts)
        if (account.costCurrency)
            balances.set(account.id, {
                amount: 0,
                bookAmount: 0,
                costCurrency: account.costCurrency,
            });
    const changes = new Map<string, Map<string, number | undefined>>();
    const events = new Map<string, Map<string, number>>();
    const changed = new Map<string, Transaction>();
    const ordered = [...transactions].sort(
        (a, b) =>
            a.time - b.time ||
            // 区间折旧与购买可在同一时刻开始，先登记所有购买再扣减其成本。
            Number(a.type === "depreciation") -
                Number(b.type === "depreciation") ||
            a.createdAt - b.createdAt ||
            (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
    for (const original of ordered) {
        let transaction = original;
        const deltas = new Map<string, number>();
        for (const entry of transaction.entries)
            if (balances.has(entry.accountId)) {
                deltas.set(
                    entry.accountId,
                    sumAmounts([
                        deltas.get(entry.accountId) ?? 0,
                        getEntryAmount(entry),
                    ]),
                );
            }
        if (!deltas.size) continue;
        const costChanges = new Map<string, number | undefined>(),
            rates = new Map<string, number>();
        const withdraw = (id: string, quantity: number) => {
            const before = balances.get(id);
            if (!before) return undefined;
            if (quantity > before.amount) {
                if (accounts.find((account) => account.id === id)?.costCurrency)
                    throw new Error("账户余额不足，无法计算平均成本。");
                balances.set(id, {
                    ...before,
                    amount: sumAmounts([before.amount, -quantity]),
                    bookAmount: undefined,
                });
                costChanges.set(id, undefined);
                return undefined;
            }
            let cost =
                before.bookAmount === undefined
                    ? undefined
                    : calculateAverageCost(
                          before.bookAmount,
                          before.amount,
                          quantity,
                      );
            if (
                transaction.type === "depreciation" &&
                transaction.parentTransactionId
            ) {
                const purchase = transactions.find(
                    (item) => item.id === transaction.parentTransactionId,
                );
                const nativeCost =
                    purchase &&
                    sumAmounts(
                        purchase.entries
                            .filter((entry) => entry.accountId === id)
                            .map(getEntryAmount),
                    );
                const purchaseCost =
                    purchase && changes.get(purchase.id)?.get(id);
                cost =
                    before.bookAmount === undefined ||
                    purchaseCost === undefined ||
                    !nativeCost
                        ? undefined
                        : calculateAverageCost(
                              purchaseCost,
                              nativeCost,
                              quantity,
                          );
            }
            if (cost !== undefined)
                rates.set(byId.get(id)?.currency ?? "", cost / quantity);
            const amount = sumAmounts([before.amount, -quantity]);
            balances.set(id, {
                ...before,
                amount,
                bookAmount:
                    amount === 0
                        ? 0
                        : cost === undefined || before.bookAmount === undefined
                          ? undefined
                          : sumAmounts([before.bookAmount, -cost]),
            });
            costChanges.set(id, cost === undefined ? undefined : -cost);
            return cost;
        };
        const deposit = (
            id: string,
            quantity: number,
            cost: number | undefined,
        ) => {
            if (cost !== undefined && cost < 0)
                throw new Error("转入成本精度不足，请调整金额。");
            const before = balances.get(id);
            if (!before) return;
            const bookAmount =
                cost === undefined || before.bookAmount === undefined
                    ? undefined
                    : sumAmounts([before.bookAmount, cost]);
            balances.set(id, {
                ...before,
                amount: sumAmounts([before.amount, quantity]),
                bookAmount,
            });
            costChanges.set(id, cost);
            if (cost !== undefined)
                rates.set(byId.get(id)?.currency ?? "", cost / quantity);
        };
        if (transaction.exchange) {
            const exchange = transaction.exchange,
                amounts = getCurrencyExchangeAmounts(transaction);
            const from = byId.get(exchange.fromAccountId),
                to = byId.get(exchange.toAccountId);
            const removedCost = balances.has(exchange.fromAccountId)
                ? withdraw(exchange.fromAccountId, amounts.withdrawn)
                : undefined;
            const principal = sumAmounts([amounts.withdrawn, -amounts.fee]);
            let cost: number | undefined;
            if (to?.costCurrency === from?.currency) cost = principal;
            else if (
                to?.costCurrency === from?.costCurrency &&
                removedCost !== undefined
            )
                cost = amounts.fee
                    ? calculateAverageCost(
                          removedCost,
                          amounts.withdrawn,
                          principal,
                      )
                    : removedCost;
            deposit(exchange.toAccountId, amounts.received, cost);
        } else {
            const withdrawals = [...deltas]
                .filter(([, amount]) => amount < 0)
                .map(([id, amount]) => ({
                    id,
                    amount: -amount,
                    cost: withdraw(id, -amount),
                    currency: byId.get(id)?.costCurrency,
                }));
            const total = sumAmounts(
                withdrawals.map((withdrawal) => withdrawal.amount),
            );
            let allocated = 0,
                allocatedCost = 0;
            const known =
                withdrawals.length &&
                withdrawals.every(
                    (withdrawal) => withdrawal.cost !== undefined,
                );
            const totalCost = known
                ? sumAmounts(
                      withdrawals.map((withdrawal) => withdrawal.cost ?? 0),
                  )
                : undefined;
            // 消费只保留原币资产/费用两条分录。本币估算独立于记账金额。
            if (
                transaction.type === "expense" &&
                transaction.entries.length === 2 &&
                withdrawals.length === 1 &&
                transaction.entries.some(
                    (entry) => byId.get(entry.accountId)?.type === "expense",
                )
            ) {
                const base = withdrawals[0].currency;
                if (base && totalCost !== undefined) {
                    const entries = transaction.entries.map((entry) => {
                        const amount = getEntryAmount(entry);
                        return {
                            ...entry,
                            amount:
                                totalCost === 0
                                    ? 0
                                    : amount > 0
                                      ? totalCost
                                      : -totalCost,
                            currency: {
                                base,
                                target: transaction.currency,
                                amount,
                            },
                        };
                    });
                    if (
                        entries.some(
                            (entry, index) =>
                                JSON.stringify(entry) !==
                                JSON.stringify(transaction.entries[index]),
                        )
                    )
                        transaction = {
                            ...transaction,
                            entries,
                            updatedAt: Math.max(
                                transaction.updatedAt,
                                now ?? transaction.updatedAt,
                            ),
                        };
                } else if (
                    transaction.entries.some((entry) => entry.currency)
                ) {
                    transaction = {
                        ...transaction,
                        entries: transaction.entries.map(
                            ({ currency: _estimate, ...entry }) => ({
                                ...entry,
                                amount: getEntryAmount({
                                    ...entry,
                                    currency: _estimate,
                                }),
                            }),
                        ),
                    };
                }
            }
            for (const [id, amount] of [...deltas].filter(
                ([, amount]) => amount > 0,
            )) {
                const costCurrency = byId.get(id)?.costCurrency;
                let cost: number | undefined;
                if (
                    totalCost !== undefined &&
                    allocated + amount <= total &&
                    withdrawals.every(
                        (withdrawal) => withdrawal.currency === costCurrency,
                    )
                ) {
                    cost =
                        allocated + amount === total
                            ? totalCost - allocatedCost
                            : calculateAverageCost(totalCost, total, amount);
                    allocatedCost = sumAmounts([allocatedCost, cost]);
                    allocated += amount;
                }
                deposit(id, amount, cost);
            }
        }
        changes.set(transaction.id, costChanges);
        events.set(transaction.id, rates);
        changed.set(transaction.id, transaction);
    }
    return {
        accounts: resolvedAccounts,
        balances,
        changes,
        events,
        transactions: transactions.map(
            (transaction) => changed.get(transaction.id) ?? transaction,
        ),
    };
}

export function getCurrencyCostBalance(
    account: Account,
    accounts: readonly Account[],
    transactions: readonly Transaction[],
) {
    return replayCurrencyCosts(accounts, transactions).balances.get(account.id);
}

/** 历史平均成本下的净资产变化；无法确定成本时由展示层保留原币。 */
export type CurrencyCostReplay = ReturnType<typeof replayCurrencyCosts>;
export function getCurrencyCostEquityChange(
    transaction: Transaction,
    accounts: readonly Account[],
    history: readonly Transaction[] | CurrencyCostReplay,
) {
    const result =
        "balances" in history
            ? history
            : replayCurrencyCosts(accounts, history);
    const costChanges = result.changes.get(transaction.id);
    if (!costChanges?.size) return undefined;
    const values = new Map<string, number[]>();
    const basisCurrency = result.accounts.find((account) =>
        costChanges.has(account.id),
    )?.costCurrency;
    for (const entry of transaction.entries) {
        const account = result.accounts.find(
            (item) => item.id === entry.accountId,
        );
        if (!account || !["asset", "liability"].includes(account.type))
            continue;
        let amount = getEntryAmount(entry),
            currency = account.currency;
        if (account.costCurrency && costChanges.has(account.id)) {
            const cost = costChanges.get(account.id);
            if (cost === undefined) return undefined;
            // 同一个账户可能有多条分录，成本变化只计算一次。
            if (
                transaction.entries.find(
                    (item) => item.accountId === account.id,
                ) !== entry
            )
                continue;
            amount = cost;
            currency = account.costCurrency;
        } else if (account.type === "liability" && currency !== basisCurrency) {
            const rate = result.events.get(transaction.id)?.get(currency);
            if (rate === undefined || !basisCurrency) return undefined;
            amount = Math.round(amount * rate);
            currency = basisCurrency;
        }
        values.set(currency, [...(values.get(currency) ?? []), amount]);
    }
    if (values.size !== 1) return undefined;
    const [currency, amounts] = [...values][0];
    return { amount: sumAmounts(amounts), currency };
}

/** Complete history recalculation after edits, backdated records and deletions. */
export function recalculateCurrencyTransactions(
    transactions: readonly Transaction[],
    accounts: readonly Account[],
    now?: number,
    baseCurrency = "CNY",
): Transaction[] {
    validateAccounts(accounts);
    validateTransactions(transactions, accounts);
    if (now !== undefined && (!Number.isSafeInteger(now) || now < 0))
        throw new Error("Invalid recalculation timestamp");
    for (const transaction of transactions) {
        for (const time of [
            transaction.time,
            transaction.createdAt,
            transaction.updatedAt,
        ])
            if (!Number.isSafeInteger(time) || time < 0)
                throw new Error(
                    "Invalid transaction timestamp for currency costing",
                );
        if (transaction.updatedAt < transaction.createdAt)
            throw new Error("Transaction update must not precede creation");
    }
    const calculated = replayCurrencyCosts(
        accounts,
        transactions,
        now,
        baseCurrency,
    ).transactions;
    validateTransactions(calculated, accounts);
    return calculated;
}
