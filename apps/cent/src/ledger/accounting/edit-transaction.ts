import { validateAccounts } from "./account";
import {
    type CreateTransactionInput,
    createTransaction,
} from "./create-transaction";
import { recalculateCurrencyTransactions } from "./currency-cost";
import { getEditableCurrencyExpense } from "./currency-expense";
import { getEntryAmount } from "./entry-amount";
import {
    copyTransactionMedia,
    retainTransactionMedia,
} from "./transaction-media";
import type { Account, Transaction } from "./types";
import { validateTransaction, validateTransactions } from "./validation";

/** 还原普通两条分录交易的编辑值，不假设导入文件的分录顺序。 */
export function getEditableTransactionInput(
    transaction: Transaction,
    accounts: readonly Account[],
): CreateTransactionInput | undefined {
    try {
        validateTransaction(transaction, accounts);
    } catch {
        return undefined;
    }
    const currencyExpense = getEditableCurrencyExpense(transaction, accounts);
    if (currencyExpense) return currencyExpense;
    if (transaction.entries.length !== 2) return undefined;
    const debit = transaction.entries.find((entry) => entry.amount > 0);
    const credit = transaction.entries.find((entry) => entry.amount < 0);
    if (
        !debit ||
        !credit ||
        !Number.isSafeInteger(debit.amount) ||
        debit.amount !== -credit.amount ||
        debit.accountId === credit.accountId
    )
        return undefined;
    const debitAccount = accounts.find(
        (account) => account.id === debit.accountId,
    );
    const creditAccount = accounts.find(
        (account) => account.id === credit.accountId,
    );
    if (
        !debitAccount ||
        !creditAccount ||
        [debitAccount, creditAccount].some(
            (account) =>
                account.currency !== transaction.currency ||
                (account.subtype === "prepaid" && !account.costCurrency),
        )
    )
        return undefined;
    const common = {
        id: transaction.id,
        amount: debit.amount,
        time: transaction.time,
        ...(transaction.endTime === undefined
            ? {}
            : { endTime: transaction.endTime }),
        description: transaction.description,
        ...copyTransactionMedia(transaction),
        parentTransactionId: transaction.parentTransactionId,
        creatorId: transaction.creatorId,
        tagIds:
            transaction.tagIds === undefined
                ? undefined
                : [...transaction.tagIds],
    };
    switch (transaction.type) {
        case "expense":
            if (
                debitAccount.type !== "expense" ||
                !["asset", "liability"].includes(creditAccount.type)
            )
                return undefined;
            return {
                ...common,
                type: "expense",
                expenseAccountId: debit.accountId,
                paymentAccountId: credit.accountId,
            };
        case "income":
            if (
                debitAccount.type !== "asset" ||
                creditAccount.type !== "income"
            )
                return undefined;
            return {
                ...common,
                type: "income",
                depositAccountId: debit.accountId,
                incomeAccountId: credit.accountId,
            };
        case "transfer":
        case "topup":
            if (debitAccount.type !== "asset" || creditAccount.type !== "asset")
                return undefined;
            return {
                ...common,
                type: transaction.type,
                fromAccountId: credit.accountId,
                toAccountId: debit.accountId,
            };
        case "asset_purchase":
            if (
                debitAccount.type !== "asset" ||
                !["asset", "liability"].includes(creditAccount.type)
            )
                return undefined;
            return {
                ...common,
                type: "asset_purchase",
                assetAccountId: debit.accountId,
                paymentAccountId: credit.accountId,
            };
        case "liability_borrowing":
            if (
                debitAccount.type !== "asset" ||
                creditAccount.type !== "liability"
            )
                return undefined;
            return {
                ...common,
                type: "liability_borrowing",
                depositAccountId: debit.accountId,
                liabilityAccountId: credit.accountId,
            };
        case "liability_payment":
            if (
                debitAccount.type !== "liability" ||
                creditAccount.type !== "asset"
            )
                return undefined;
            return {
                ...common,
                type: "liability_payment",
                liabilityAccountId: debit.accountId,
                paymentAccountId: credit.accountId,
            };
        default:
            return undefined;
    }
}

/** 用同一交易 ID 替换记录，保留分录顺序、创建者、标签和创建时间。 */
export function updateTransaction(
    input: CreateTransactionInput,
    accounts: readonly Account[],
    transactions: readonly Transaction[],
    now: number,
): Transaction {
    validateAccounts(accounts);
    validateTransactions(transactions, accounts);
    const original = transactions.find(
        (transaction) => transaction.id === input.id,
    );
    if (!original) throw new Error(`Transaction not found: ${input.id}`);
    if (!getEditableTransactionInput(original, accounts))
        throw new Error("This transaction requires a dedicated editor");
    const created = createTransaction(
        { ...input, creatorId: original.creatorId, tagIds: original.tagIds },
        accounts,
        transactions.filter((transaction) => transaction.id !== input.id),
        now,
    );
    const updated: Transaction = {
        ...created,
        ...retainTransactionMedia(input, original),
        createdAt: original.createdAt,
        updatedAt: Math.max(now, original.updatedAt),
        entries: original.entries.map((entry) => ({
            ...created.entries[getEntryAmount(entry) > 0 ? 0 : 1],
        })),
    };
    return (
        recalculateCurrencyTransactions(
            [...transactions.filter((item) => item.id !== input.id), updated],
            accounts,
            now,
        ).find((item) => item.id === input.id) ?? updated
    );
}
