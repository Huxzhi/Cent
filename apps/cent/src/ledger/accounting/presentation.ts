import { assertAmount, sumAmounts } from "./amount";
import { calculateAverageCost } from "./average-cost";
import type { CurrencyCostReplay } from "./currency-cost";
import {
    getCurrencyExchangeAmounts,
    getCurrencyExchangeRate,
} from "./currency-exchange";
import { getCurrencyExpenseCategory } from "./currency-expense";
import {
    getEntryAmount,
    getEntryCurrency,
    getEntryDisplayAmount,
} from "./entry-amount";
import type { Account, Entry, Transaction } from "./types";

/** 子交易只展示自己的备注，不重复展示从父交易复制的备注。 */
export function getTransactionDescription(
    transaction: Transaction,
    parent?: Transaction,
) {
    if (
        parent &&
        transaction.parentTransactionId === parent.id &&
        transaction.description === parent.description
    )
        return undefined;
    return transaction.description;
}

/** UI 从分录取值；转账、还款、期初不因为现金流动而变成收支。 */
export function getTransactionNativePresentation(
    transaction: Transaction,
    accounts: readonly Account[],
) {
    const expense = transaction.entries.filter(
        (item) =>
            accounts.find((account) => account.id === item.accountId)?.type ===
            "expense",
    );
    const income = transaction.entries.filter(
        (item) =>
            accounts.find((account) => account.id === item.accountId)?.type ===
            "income",
    );
    const primaryEntries = expense.length
        ? expense
        : income.length
          ? income
          : transaction.entries.filter((entry) => entry.amount > 0);
    const primaryAccounts = primaryEntries
        .map((entry) =>
            accounts.find((account) => account.id === entry.accountId),
        )
        .filter((account): account is Account => account !== undefined)
        .filter(
            (account, index, list) =>
                list.findIndex((item) => item.id === account.id) === index,
        );
    if (
        ["currency_exchange", "topup"].includes(transaction.type) &&
        transaction.exchange
    ) {
        const account = accounts.find(
            (a) => a.id === transaction.exchange?.toAccountId,
        );
        return {
            account,
            primaryAccounts: account ? [account] : [],
            amount: getCurrencyExchangeAmounts(transaction).withdrawn,
            expense: sumAmounts(expense.map((e) => e.amount)),
            income: 0,
        };
    }
    return {
        account: primaryAccounts[0],
        primaryAccounts,
        amount: sumAmounts(
            primaryEntries.map((entry) =>
                !expense.length && income.length
                    ? -getEntryAmount(entry)
                    : getEntryAmount(entry),
            ),
        ),
        expense: sumAmounts(expense.map(getEntryAmount)),
        income: sumAmounts(income.map((item) => -getEntryAmount(item))),
    };
}

export function getTransactionPresentation(
    transaction: Transaction,
    accounts: readonly Account[],
) {
    const native = getTransactionNativePresentation(transaction, accounts);
    return {
        ...native,
        nativeAmount: native.amount,
        currency: transaction.currency,
    };
}

/** 分录展示换算共用入口，统计过滤不会改变换汇原分录或手续费计算依据。 */
export function getIncomeExpenseEntryDisplayAmount(
    entry: Entry,
    account: Account,
    transaction: Transaction,
    accounts: readonly Account[],
    currency: string,
    valueRate: (from: string, to: string) => number | undefined,
    history?: CurrencyCostReplay,
): number {
    const preview = getEntryDisplayAmount(entry, account, currency);
    if (preview !== undefined) return preview;
    const native = getEntryAmount(entry);
    if (native === 0) return 0;
    const feeSource =
        ["currency_exchange", "topup"].includes(transaction.type) &&
        transaction.exchange?.feeAccountId === account.id
            ? transaction.exchange.fromAccountId
            : undefined;
    const sourceCost = feeSource
        ? history?.changes.get(transaction.id)?.get(feeSource)
        : undefined;
    const costCurrency = history?.accounts.find(
        (item) => item.id === feeSource,
    )?.costCurrency;
    if (sourceCost !== undefined && costCurrency === currency && native > 0)
        return calculateAverageCost(
            -sourceCost,
            getCurrencyExchangeAmounts(transaction).withdrawn,
            native,
        );
    const rate =
        feeSource &&
        transaction.exchange &&
        accounts.find((item) => item.id === transaction.exchange?.toAccountId)
            ?.currency === currency
            ? getCurrencyExchangeRate(transaction)
            : valueRate(getEntryCurrency(entry, account), currency);
    if (rate === undefined) throw new Error("Missing display conversion basis");
    return convertDisplayAmount(native, rate);
}

/** 本币预览优先；传入换算器时汇总全部币种，换汇手续费使用成交比例。 */
export function getDisplayIncomeExpenseTotals(
    transactions: readonly Transaction[],
    accounts: readonly Account[],
    currency: string,
    valueRate?: (from: string, to: string) => number | undefined,
    history?: CurrencyCostReplay,
) {
    if (valueRate) {
        const amounts = (type: "income" | "expense") =>
            transactions.flatMap((transaction) =>
                transaction.entries.flatMap((entry) => {
                    const account = accounts.find(
                        (item) => item.id === entry.accountId,
                    );
                    if (!account || account.type !== type) return [];
                    const amount = getIncomeExpenseEntryDisplayAmount(
                        entry,
                        account,
                        transaction,
                        accounts,
                        currency,
                        valueRate,
                        history,
                    );
                    return [type === "income" ? -amount : amount];
                }),
            );
        const income = sumAmounts(amounts("income"));
        const expense = sumAmounts(amounts("expense"));
        return { income, expense, net: sumAmounts([income, -expense]) };
    }
    const rows = transactions.map((transaction) => {
        if (transaction.currency === currency)
            return getIncomeExpenseTotals([transaction], accounts, currency);
        if (
            ["currency_exchange", "topup"].includes(transaction.type) &&
            transaction.exchange &&
            accounts.find(
                (account) => account.id === transaction.exchange?.toAccountId,
            )?.currency === currency
        ) {
            return {
                income: 0,
                expense: convertDisplayAmount(
                    getCurrencyExchangeAmounts(transaction).fee,
                    getCurrencyExchangeRate(transaction),
                ),
            };
        }
        return getIncomeExpenseTotals([transaction], accounts, currency);
    });
    const income = sumAmounts(rows.map((row) => row.income));
    const expense = sumAmounts(rows.map((row) => row.expense));
    return { income, expense, net: sumAmounts([income, -expense]) };
}

/** 展示边界派生金额，不写回交易。正负对称舍入，避免 -0。 */
export function convertDisplayAmount(amount: number, rate: number): number {
    assertAmount(amount);
    if (!Number.isFinite(rate) || rate <= 0)
        throw new Error("Display rate must be positive and finite");
    const value = Math.round(Math.abs(amount) * rate) * (amount < 0 ? -1 : 1);
    assertAmount(value);
    return value === 0 ? 0 : value;
}

export function getIncomeExpenseTotals(
    transactions: readonly Transaction[],
    accounts: readonly Account[],
    currency: string,
) {
    const amounts = (type: "income" | "expense") =>
        transactions.flatMap((transaction) =>
            transaction.entries.flatMap((entry) => {
                const account = accounts.find(
                    (account) =>
                        account.id === entry.accountId && account.type === type,
                );
                const amount =
                    account && getEntryDisplayAmount(entry, account, currency);
                return amount === undefined
                    ? []
                    : [type === "income" ? -amount : amount];
            }),
        );
    const income = sumAmounts(amounts("income"));
    const expense = sumAmounts(amounts("expense"));
    return { income, expense, net: sumAmounts([income, -expense]) };
}

/** 图表只列互不重叠的账户组；五类预置根账户展开一级，自身分录单独保留。 */
export function getIncomeExpenseAccountRows(
    accounts: readonly Account[],
    transactions: readonly Transaction[],
    type: "expense" | "income",
    currency: string,
) {
    const candidates = accounts.filter(
        (account) => account.type === type && account.currency === currency,
    );
    const byId = new Map(candidates.map((account) => [account.id, account]));
    const expandedRoots = new Set(
        candidates
            .filter(
                (account) =>
                    account.presetKey === `starter:${type}` &&
                    (!account.parentId || !byId.has(account.parentId)),
            )
            .map((account) => account.id),
    );
    return candidates
        .filter((account) => {
            const parent = account.parentId
                ? byId.get(account.parentId)
                : undefined;
            return !parent || expandedRoots.has(parent.id);
        })
        .map((account) => ({
            account,
            amount: (() => {
                const ids = new Set([account.id]);
                if (!expandedRoots.has(account.id)) {
                    let added = true;
                    while (added) {
                        added = false;
                        for (const candidate of candidates)
                            if (
                                candidate.parentId &&
                                ids.has(candidate.parentId) &&
                                !ids.has(candidate.id)
                            ) {
                                ids.add(candidate.id);
                                added = true;
                            }
                    }
                }
                return sumAmounts(
                    transactions.flatMap((transaction) =>
                        transaction.entries.flatMap((entry) => {
                            const actual = accounts.find(
                                (item) => item.id === entry.accountId,
                            );
                            if (!actual || actual.type !== type) return [];
                            const category =
                                actual.currency === currency
                                    ? actual
                                    : getCurrencyExpenseCategory(
                                          actual,
                                          accounts,
                                      );
                            if (!ids.has(category.id)) return [];
                            const amount = getEntryDisplayAmount(
                                entry,
                                actual,
                                currency,
                            );
                            return amount === undefined
                                ? []
                                : [type === "income" ? -amount : amount];
                        }),
                    ),
                );
            })(),
        }))
        .filter((row) => row.amount !== 0)
        .sort((left, right) => right.amount - left.amount);
}
