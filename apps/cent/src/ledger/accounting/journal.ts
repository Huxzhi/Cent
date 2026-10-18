import { validateAccounts } from "./account";
import { getEntryAmount } from "./entry-amount";
import {
    copyTransactionMedia,
    retainTransactionMedia,
    type TransactionMedia,
} from "./transaction-media";
import type { Account, Entry, Transaction, TransactionType } from "./types";
import { validateTransaction, validateTransactions } from "./validation";

export type JournalType = Exclude<
    TransactionType,
    "currency_exchange" | "depreciation"
>;
export interface JournalTransactionInput extends TransactionMedia {
    id: string;
    time: number;
    endTime?: number;
    currency: string;
    type?: JournalType;
    entries: Pick<Entry, "accountId" | "amount">[];
    description?: string;
    parentTransactionId?: string;
    creatorId?: string | number;
    tagIds?: string[];
}

/** 手工交易可重新选择录入模式；自动折旧始终由来源购买交易管理。 */
export function canReclassifyTransaction(
    transaction: Transaction,
    accounts: readonly Account[],
): boolean {
    if (transaction.type === "depreciation") return false;
    try {
        validateTransaction(transaction, accounts);
        return true;
    } catch {
        return false;
    }
}

/** 自由复式分录不按业务名称限制账户类型，正式金额必须独立平衡。 */
export function createJournalTransaction(
    input: JournalTransactionInput,
    accounts: readonly Account[],
    transactions: readonly Transaction[],
    now: number,
): Transaction {
    validateAccounts(accounts);
    const types: JournalType[] = [
        "journal",
        "expense",
        "income",
        "transfer",
        "topup",
        "asset_purchase",
        "liability_borrowing",
        "liability_payment",
        "opening_balance",
        "adjustment",
        "split",
    ];
    if (input.type !== undefined && !types.includes(input.type))
        throw new Error("Unsupported journal transaction type");
    if (
        input.entries.some((entry) =>
            Object.keys(entry).some(
                (key) => !["accountId", "amount"].includes(key),
            ),
        )
    )
        throw new Error("Unsupported journal entry field");
    for (const time of [input.time, now]) {
        if (!Number.isSafeInteger(time) || time < 0)
            throw new RangeError(
                "Transaction timestamps must be nonnegative safe integers",
            );
    }
    for (const entry of input.entries) {
        const account = accounts.find((item) => item.id === entry.accountId);
        if (!account) throw new Error(`Account not found: ${entry.accountId}`);
        if (account.archived)
            throw new Error(
                `Cannot create entries for archived account: ${account.id}`,
            );
        if (account.subtype === "prepaid" && !account.costCurrency)
            throw new Error(
                "Recharge cards require an independent currency and cost basis",
            );
    }
    if (new Set(input.entries.map((entry) => entry.accountId)).size < 2)
        throw new Error("Transaction requires two different accounts");
    const transaction: Transaction = {
        id: input.id,
        type: input.type ?? "journal",
        time: input.time,
        ...(input.endTime === undefined ? {} : { endTime: input.endTime }),
        currency: input.currency,
        description: input.description,
        ...copyTransactionMedia(input),
        parentTransactionId: input.parentTransactionId,
        creatorId: input.creatorId,
        tagIds: input.tagIds === undefined ? undefined : [...input.tagIds],
        entries: input.entries.map((entry) => ({
            accountId: entry.accountId,
            amount: entry.amount,
        })),
        createdAt: now,
        updatedAt: now,
    };
    validateTransactions([...transactions, transaction], accounts);
    return transaction;
}

/** 保留全部分录及其顺序；换汇与自动折旧使用对应编辑入口。 */
export function getEditableJournalInput(
    transaction: Transaction,
    accounts: readonly Account[],
): JournalTransactionInput | undefined {
    if (
        transaction.exchange !== undefined ||
        ["currency_exchange", "depreciation"].includes(transaction.type)
    )
        return undefined;
    try {
        validateTransaction(transaction, accounts);
    } catch {
        return undefined;
    }
    return {
        id: transaction.id,
        type: transaction.type as JournalType,
        time: transaction.time,
        ...(transaction.endTime === undefined
            ? {}
            : { endTime: transaction.endTime }),
        currency: transaction.currency,
        description: transaction.description,
        ...copyTransactionMedia(transaction),
        parentTransactionId: transaction.parentTransactionId,
        creatorId: transaction.creatorId,
        tagIds:
            transaction.tagIds === undefined
                ? undefined
                : [...transaction.tagIds],
        entries: transaction.entries.map((entry) => ({
            accountId: entry.accountId,
            amount: getEntryAmount(entry),
        })),
    };
}

export function updateJournalTransaction(
    input: JournalTransactionInput,
    accounts: readonly Account[],
    transactions: readonly Transaction[],
    now: number,
): Transaction {
    validateTransactions(transactions, accounts);
    const original = transactions.find((item) => item.id === input.id);
    if (!original) throw new Error(`Transaction not found: ${input.id}`);
    if (!canReclassifyTransaction(original, accounts))
        throw new Error("This transaction requires a dedicated editor");
    const created = createJournalTransaction(
        {
            ...input,
            creatorId: original.creatorId,
            tagIds:
                input.tagIds === undefined
                    ? original.tagIds
                    : [...new Set(input.tagIds)],
        },
        accounts,
        transactions.filter((item) => item.id !== input.id),
        now,
    );
    return {
        ...created,
        ...retainTransactionMedia(input, original),
        createdAt: original.createdAt,
        updatedAt: Math.max(now, original.updatedAt),
    };
}
