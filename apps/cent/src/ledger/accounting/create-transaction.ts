import { validateAccounts } from "./account";
import { assertAmount } from "./amount";
import {
    copyTransactionMedia,
    type TransactionMedia,
} from "./transaction-media";
import type { Account, Amount, Transaction } from "./types";
import { validateTransactions } from "./validation";

interface TransactionInputBase extends TransactionMedia {
    id: string;
    time: number;
    endTime?: number;
    /** 正数整数金额，10000:1；退款/冲销、拆分等由后续专门业务实现。 */
    amount: Amount;
    description?: string;
    creatorId?: number | string;
    tagIds?: string[];
    parentTransactionId?: string;
}

export interface ExpenseTransactionInput extends TransactionInputBase {
    type: "expense";
    expenseAccountId: string;
    paymentAccountId: string;
}
export interface IncomeTransactionInput extends TransactionInputBase {
    type: "income";
    incomeAccountId: string;
    depositAccountId: string;
}
export interface TransferTransactionInput extends TransactionInputBase {
    type: "transfer" | "topup";
    fromAccountId: string;
    toAccountId: string;
}
export interface LiabilityPaymentInput extends TransactionInputBase {
    type: "liability_payment";
    liabilityAccountId: string;
    paymentAccountId: string;
}
export interface AssetPurchaseInput extends TransactionInputBase {
    type: "asset_purchase";
    assetAccountId: string;
    paymentAccountId: string;
}
export interface LiabilityBorrowingInput extends TransactionInputBase {
    type: "liability_borrowing";
    liabilityAccountId: string;
    depositAccountId: string;
}
export type CreateTransactionInput =
    | ExpenseTransactionInput
    | IncomeTransactionInput
    | TransferTransactionInput
    | LiabilityPaymentInput
    | AssetPurchaseInput
    | LiabilityBorrowingInput;

/**
 * 支出：费用借方、资产/负债贷方；收入：资产借方、收入贷方；转账：资产之间。
 * 还款：负债借方、资产贷方，不新增费用；允许部分还款和超额还款。
 * 购买固定资产：固定资产借方、资产/负债贷方；借款到账：资产借方、负债贷方。
 * 返回可追加到候选集合的独立平衡交易，ID/当前时间由调用方提供。
 * 不使用旧分类/标签猜账户，不修改历史；完整候选集合校验父子关系和 ID 冲突。
 */
export function createTransaction(
    input: CreateTransactionInput,
    accounts: readonly Account[],
    transactions: readonly Transaction[],
    now: number,
): Transaction {
    validateAccounts(accounts);
    assertAmount(input.amount);
    if (input.amount <= 0)
        throw new Error("Transaction amount must be positive");
    for (const time of [input.time, now]) {
        if (!Number.isSafeInteger(time) || time < 0) {
            throw new RangeError(
                "Transaction timestamps must be nonnegative safe integers",
            );
        }
    }
    const findActiveAccount = (id: string): Account => {
        const account = accounts.find((item) => item.id === id);
        if (!account) throw new Error(`Account not found: ${id}`);
        if (account.archived)
            throw new Error(
                `Cannot create entries for archived account: ${id}`,
            );
        if (account.subtype === "prepaid" && !account.costCurrency) {
            throw new Error(
                "Prepaid accounts require dedicated topup or spend transactions",
            );
        }
        return account;
    };
    let debit: Account;
    let credit: Account;
    switch (input.type) {
        case "expense":
            debit = findActiveAccount(input.expenseAccountId);
            credit = findActiveAccount(input.paymentAccountId);
            if (
                debit.type !== "expense" ||
                (credit.type !== "asset" && credit.type !== "liability")
            ) {
                throw new Error(
                    "Expense requires an expense account and an asset or liability payment account",
                );
            }
            break;
        case "income":
            debit = findActiveAccount(input.depositAccountId);
            credit = findActiveAccount(input.incomeAccountId);
            if (debit.type !== "asset" || credit.type !== "income") {
                throw new Error(
                    "Income requires an asset deposit account and an income account",
                );
            }
            break;
        case "transfer":
        case "topup":
            debit = findActiveAccount(input.toAccountId);
            credit = findActiveAccount(input.fromAccountId);
            if (debit.type !== "asset" || credit.type !== "asset") {
                throw new Error("Transfer requires two asset accounts");
            }
            break;
        case "asset_purchase":
            debit = findActiveAccount(input.assetAccountId);
            credit = findActiveAccount(input.paymentAccountId);
            if (
                debit.type !== "asset" ||
                (credit.type !== "asset" && credit.type !== "liability")
            ) {
                throw new Error(
                    "Asset purchase requires an asset account and an asset or liability payment account",
                );
            }
            break;
        case "liability_borrowing":
            debit = findActiveAccount(input.depositAccountId);
            credit = findActiveAccount(input.liabilityAccountId);
            if (debit.type !== "asset" || credit.type !== "liability") {
                throw new Error(
                    "Borrowing requires an asset deposit account and a liability account",
                );
            }
            break;
        case "liability_payment":
            debit = findActiveAccount(input.liabilityAccountId);
            credit = findActiveAccount(input.paymentAccountId);
            if (debit.type !== "liability" || credit.type !== "asset") {
                throw new Error(
                    "Repayment requires a liability account and an asset payment account",
                );
            }
            break;
        default:
            throw new Error("Unsupported transaction type");
    }
    if (debit.id === credit.id)
        throw new Error("Transaction requires two different accounts");
    if (debit.currency !== credit.currency)
        throw new Error("Transaction account currencies must match");
    const transaction: Transaction = {
        id: input.id,
        type: input.type,
        time: input.time,
        ...(input.endTime === undefined ? {} : { endTime: input.endTime }),
        currency: debit.currency,
        description: input.description,
        ...copyTransactionMedia(input),
        creatorId: input.creatorId,
        tagIds: input.tagIds === undefined ? undefined : [...input.tagIds],
        parentTransactionId: input.parentTransactionId,
        entries: [
            {
                accountId: debit.id,
                amount: input.amount,
            },
            {
                accountId: credit.id,
                amount: -input.amount,
            },
        ],
        createdAt: now,
        updatedAt: now,
    };
    validateTransactions([...transactions, transaction], accounts);
    return transaction;
}
