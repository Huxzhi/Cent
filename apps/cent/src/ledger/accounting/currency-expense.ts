import { createAccount } from "./account";
import { calculateAverageCost } from "./average-cost";
import {
    createTransaction,
    type ExpenseTransactionInput,
} from "./create-transaction";
import {
    recalculateCurrencyTransactions,
    replayCurrencyCosts,
    resolveCurrencyCostAccounts,
} from "./currency-cost";
import { getEntryAmount } from "./entry-amount";
import { canReclassifyTransaction } from "./journal";
import {
    copyTransactionMedia,
    retainTransactionMedia,
} from "./transaction-media";
import type { Account, Transaction } from "./types";
import { validateTransaction } from "./validation";

const mirrorPrefix = "currency-expense:";
/** 仅预览消费发生前的平均成本，修改草稿不会写入账户或交易。 */
export function getCurrencyExpenseEstimate(
    accountId: string,
    amount: number,
    accounts: readonly Account[],
    history: readonly Transaction[],
    position: { id: string; time: number; createdAt: number },
    baseCurrency = "CNY",
) {
    const prefix = history.filter(
        (transaction) =>
            transaction.id !== position.id &&
            (transaction.time < position.time ||
                (transaction.time === position.time &&
                    (transaction.createdAt < position.createdAt ||
                        (transaction.createdAt === position.createdAt &&
                            transaction.id < position.id)))),
    );
    const balance = replayCurrencyCosts(
        accounts,
        prefix,
        undefined,
        baseCurrency,
    ).balances.get(accountId);
    if (!balance || balance.bookAmount === undefined) return undefined;
    return {
        amount: calculateAverageCost(
            balance.bookAmount,
            balance.amount,
            amount,
        ),
        currency: balance.costCurrency,
    };
}
/** 镜像账户依然独立记账，模板关联仅供原分类选择和双语显示。 */
export function getCurrencyExpenseCategory(
    account: Account,
    accounts: readonly Account[],
): Account {
    if (!account.presetKey?.startsWith(mirrorPrefix)) return account;
    return (
        accounts.find(
            (item) =>
                item.id === account.presetKey?.slice(mirrorPrefix.length) &&
                item.type === "expense",
        ) ?? account
    );
}

/** 原币资产与同币种费用账户两条分录；本币估算由历史成本重放生成。 */
export function createCurrencyExpense(
    input: ExpenseTransactionInput,
    accounts: readonly Account[],
    history: readonly Transaction[],
    now: number,
    options: {
        edit?: boolean;
        baseCurrency?: string;
        generateAccountId?: () => string;
    } = {},
) {
    const {
        edit = false,
        baseCurrency = "CNY",
        generateAccountId = () => crypto.randomUUID(),
    } = options;
    const inferred = resolveCurrencyCostAccounts(
        accounts,
        history,
        baseCurrency,
    );
    const source = inferred.find(
        (account) => account.id === input.paymentAccountId,
    );
    if (!source || source.type !== "asset" || source.archived)
        throw new Error("请选择有效的付款资产账户。");
    const nextAccounts = accounts.map((account) =>
        account.id === source.id && source.costCurrency
            ? { ...account, costCurrency: source.costCurrency }
            : account,
    );
    const target = nextAccounts.find(
        (account) => account.id === input.expenseAccountId,
    );
    if (!target || target.type !== "expense" || target.archived)
        throw new Error("请选择有效的费用账户。");
    if (
        target.currency !== source.currency &&
        target.currency !== source.costCurrency
    )
        throw new Error("请选择原币或成本币种的费用账户。");
    const ensureNativeExpense = (category: Account): Account => {
        if (category.currency === source.currency) return category;
        const key = `${mirrorPrefix}${category.id}`;
        const existing = nextAccounts.find(
            (account) =>
                account.type === "expense" &&
                account.currency === source.currency &&
                account.presetKey === key &&
                !account.archived,
        );
        if (existing) return existing;
        const parent =
            category.parentId &&
            nextAccounts.find((account) => account.id === category.parentId);
        const nativeParent = parent ? ensureNativeExpense(parent) : undefined;
        const mirror = createAccount(
            {
                id: generateAccountId(),
                name: category.name,
                type: "expense",
                currency: source.currency,
                presetKey: key,
                icon: category.icon,
                parentId: nativeParent?.id,
            },
            nextAccounts,
            now,
        );
        nextAccounts.push(mirror);
        return mirror;
    };
    const expense = ensureNativeExpense(target);
    const original = history.find((transaction) => transaction.id === input.id);
    if (edit && (!original || !canReclassifyTransaction(original, accounts)))
        throw new Error("Editable expense not found");
    const candidate = history.filter(
        (transaction) => transaction.id !== input.id,
    );
    const created = createTransaction(
        { ...input, expenseAccountId: expense.id },
        nextAccounts,
        edit ? candidate : history,
        now,
    );
    const saved =
        original && edit
            ? {
                  ...created,
                  ...retainTransactionMedia(input, original),
                  createdAt: original.createdAt,
                  creatorId: original.creatorId,
                  updatedAt: Math.max(now, original.updatedAt),
              }
            : created;
    const transaction = recalculateCurrencyTransactions(
        [...candidate, saved],
        nextAccounts,
        now,
        baseCurrency,
    ).find((item) => item.id === input.id);
    if (!transaction) throw new Error("Currency expense not found");
    return { accounts: nextAccounts, transaction };
}

export function getEditableCurrencyExpense(
    transaction: Transaction,
    accounts: readonly Account[],
): ExpenseTransactionInput | undefined {
    if (transaction.type !== "expense") return undefined;
    try {
        validateTransaction(transaction, accounts);
    } catch {
        return undefined;
    }
    const sourceEntry = transaction.entries.find(
        (entry) =>
            getEntryAmount(entry) < 0 &&
            accounts.find((account) => account.id === entry.accountId)?.type ===
                "asset",
    );
    const targetEntry = transaction.entries.find(
        (entry) =>
            getEntryAmount(entry) > 0 &&
            accounts.find((account) => account.id === entry.accountId)?.type ===
                "expense",
    );
    if (!sourceEntry || !targetEntry || transaction.entries.length !== 2)
        return undefined;
    const source = accounts.find(
        (account) => account.id === sourceEntry.accountId,
    );
    const target = accounts.find(
        (account) => account.id === targetEntry.accountId,
    );
    if (!source || !target) return undefined;
    return {
        id: transaction.id,
        type: "expense",
        time: transaction.time,
        ...(transaction.endTime === undefined
            ? {}
            : { endTime: transaction.endTime }),
        amount: -getEntryAmount(sourceEntry),
        paymentAccountId: source.id,
        expenseAccountId: target.id,
        description: transaction.description,
        parentTransactionId: transaction.parentTransactionId,
        creatorId: transaction.creatorId,
        tagIds: transaction.tagIds && [...transaction.tagIds],
        ...copyTransactionMedia(transaction),
    };
}
