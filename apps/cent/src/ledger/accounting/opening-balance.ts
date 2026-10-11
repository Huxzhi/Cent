import { validateAccounts } from "./account";
import { assertAmount } from "./amount";
import type { Account, Amount, Transaction } from "./types";
import { validateTransactions } from "./validation";

export interface OpeningBalanceInput {
    id: string;
    accountId: string;
    equityAccountId: string;
    /** 展示余额，仍使用 10000:1 整数；资产正数为借方，负债正数为贷方。 */
    amount: Amount;
    time: number;
    description?: string;
    creatorId?: number | string;
}

/** 普通资产／负债可设置期初；专用子类型和成本币种通过业务交易建立余额。 */
export function canCreateOpeningBalance(
    account: Pick<Account, "type" | "subtype" | "costCurrency">,
): boolean {
    return (
        (account.type === "asset" || account.type === "liability") &&
        account.subtype === undefined &&
        !account.costCurrency
    );
}

/**
 * 为资产/负债生成期初交易，与同币种权益账户抵消，不生成收入/费用分录。
 * 零期初返回 undefined（无需交易），不放宽正式分录的非零限制。
 * 每个账户只允许一笔期初交易；修改时用候选历史替换原交易后重新校验。
 * 完整历史、ID 和时间均由调用方提供，无存储或隐式全局状态。
 */
export function createOpeningBalance(
    input: OpeningBalanceInput,
    accounts: readonly Account[],
    transactions: readonly Transaction[],
    now: number,
): Transaction | undefined {
    validateAccounts(accounts);
    assertAmount(input.amount);
    if (!input.id.trim()) throw new Error("Transaction ID must not be empty");
    for (const time of [input.time, now]) {
        if (!Number.isSafeInteger(time) || time < 0) {
            throw new RangeError(
                "Opening balance timestamps must be nonnegative safe integers",
            );
        }
    }
    const account = accounts.find((item) => item.id === input.accountId);
    const equity = accounts.find((item) => item.id === input.equityAccountId);
    if (!account) throw new Error(`Account not found: ${input.accountId}`);
    if (account.subtype === "prepaid" || account.costCurrency)
        throw new Error("储值及成本币种请通过充值或换汇记录初始成本与余额。");
    if (!equity) throw new Error(`Account not found: ${input.equityAccountId}`);
    if (account.type !== "asset" && account.type !== "liability") {
        throw new Error(
            "Opening balance target must be an asset or liability account",
        );
    }
    if (!canCreateOpeningBalance(account))
        throw new Error("Opening balance target must be an ordinary account");
    if (equity.type !== "equity")
        throw new Error("Opening balance offset account must be equity");
    if (account.currency !== equity.currency)
        throw new Error("Opening balance currencies must match");
    if (account.archived || equity.archived)
        throw new Error(
            "Cannot create an opening balance for archived accounts",
        );
    if (
        transactions.some(
            (transaction) =>
                transaction.type === "opening_balance" &&
                transaction.entries.some(
                    (entry) => entry.accountId === account.id,
                ),
        )
    ) {
        throw new Error("Account already has an opening balance transaction");
    }
    if (input.amount === 0) {
        validateTransactions(transactions, accounts);
        return undefined;
    }
    const amount = account.type === "asset" ? input.amount : -input.amount;
    const transaction: Transaction = {
        id: input.id,
        type: "opening_balance",
        time: input.time,
        currency: account.currency,
        description: input.description,
        creatorId: input.creatorId,
        entries: [
            {
                accountId: account.id,
                amount,
            },
            { accountId: equity.id, amount: -amount },
        ],
        createdAt: now,
        updatedAt: now,
    };
    validateTransactions([...transactions, transaction], accounts);
    return transaction;
}
