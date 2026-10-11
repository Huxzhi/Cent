import { assertAmount, sumAmounts } from "./amount";
import { validateCurrencyExchange } from "./currency-exchange";
import { isCurrencyTradingGroup } from "./currency-trading";
import { getEntryAmount, validateEntryCurrency } from "./entry-amount";
import { validateTransactionTimeRange } from "./time-range";
import { copyTransactionMedia } from "./transaction-media";
import type { Account, Transaction } from "./types";

/**
 * 验证成功时返回 void，失败时抛出 Error（非法金额抛出 RangeError）。
 * 不修改输入；允许历史分录引用已归档账户。
 * 正式 Entry 禁止原币金额为零。
 * 父交易存在性及关联循环需要完整交易集合，由 validateTransactions 校验。
 */
export function validateTransaction(
    transaction: Transaction,
    accounts: readonly Account[],
): void {
    if ("generatedByRuleId" in transaction)
        throw new Error(
            "Account-bound depreciation transactions are unsupported",
        );
    if (
        ![
            "currency_exchange",
            "topup",
            "journal",
            "expense",
            "income",
            "transfer",
            "asset_purchase",
            "depreciation",
            "liability_borrowing",
            "opening_balance",
            "adjustment",
            "liability_payment",
            "split",
        ].includes(transaction.type)
    )
        throw new Error("Unsupported transaction type");
    validateTransactionTimeRange(transaction);
    if (
        transaction.endTime !== undefined &&
        (transaction.exchange ||
            ["currency_exchange", "topup"].includes(transaction.type))
    )
        throw new Error("Funding transactions must be points in time");
    copyTransactionMedia(transaction);
    if (transaction.type === "topup" && !transaction.exchange) {
        const source = transaction.entries.filter(
            (entry) => getEntryAmount(entry) < 0,
        );
        const destination = transaction.entries.filter(
            (entry) => getEntryAmount(entry) > 0,
        );
        if (
            transaction.exchange ||
            transaction.entries.length !== 2 ||
            source.length !== 1 ||
            destination.length !== 1 ||
            source[0].accountId === destination[0].accountId ||
            transaction.entries.some(
                (entry) =>
                    accounts.find((account) => account.id === entry.accountId)
                        ?.type !== "asset" || entry.currency !== undefined,
            )
        )
            throw new Error("Same-currency topup requires two asset accounts");
    }
    if (!transaction.id.trim()) {
        throw new Error("Transaction ID must not be empty");
    }
    if (transaction.parentTransactionId !== undefined) {
        if (!transaction.parentTransactionId.trim()) {
            throw new Error("Parent transaction ID must not be empty");
        }
        if (transaction.parentTransactionId === transaction.id) {
            throw new Error("Transaction must not be its own parent");
        }
    }
    if (!transaction.currency.trim()) {
        throw new Error("Transaction currency must not be empty");
    }
    if (transaction.entries.length < 2) {
        throw new Error("Transaction must contain at least two entries");
    }

    const accountById = new Map<string, Account>();
    for (const account of accounts) {
        if (!account.id.trim()) {
            throw new Error("Account ID must not be empty");
        }
        if (accountById.has(account.id)) {
            throw new Error(`Duplicate account ID: ${account.id}`);
        }
        accountById.set(account.id, account);
    }

    for (const entry of transaction.entries) {
        if ("faceAmount" in entry)
            throw new Error(
                "Auxiliary face amounts are unsupported; use account currency",
            );
        const account = accountById.get(entry.accountId);
        if (!account) {
            throw new Error(`Account not found: ${entry.accountId}`);
        }
        if (isCurrencyTradingGroup(account))
            throw new Error("Currency trading group cannot receive entries");
        if (
            !transaction.exchange &&
            account.currency !== transaction.currency
        ) {
            throw new Error(`Account currency does not match: ${account.id}`);
        }

        assertAmount(entry.amount);
        validateEntryCurrency(entry);
        if (
            entry.currency &&
            (transaction.exchange ||
                entry.currency.target !== account.currency ||
                entry.currency.target !== transaction.currency)
        )
            throw new Error("Native entry currency must match its account");
        if (getEntryAmount(entry) === 0) {
            throw new Error(
                `Entry amount must not be zero: ${entry.accountId}`,
            );
        }
    }

    if (transaction.type === "currency_exchange" || transaction.exchange) {
        validateCurrencyExchange(transaction, accounts);
        const currencies = new Set(
            transaction.entries.map(
                (entry) => accountById.get(entry.accountId)?.currency,
            ),
        );
        for (const currency of currencies) {
            if (
                sumAmounts(
                    transaction.entries
                        .filter(
                            (entry) =>
                                accountById.get(entry.accountId)?.currency ===
                                currency,
                        )
                        .map((entry) => entry.amount),
                ) !== 0
            )
                throw new Error(
                    "Exchange entries must balance in each currency",
                );
        }
        return;
    }
    if (
        transaction.exchange !== undefined ||
        transaction.entries.some(
            (entry) =>
                accountById.get(entry.accountId)?.subtype ===
                "currency_trading",
        )
    )
        throw new Error(
            "Currency trading requires a dedicated exchange transaction",
        );
    if (transaction.entries.some((entry) => entry.currency)) {
        const first = transaction.entries[0].currency;
        if (
            transaction.type !== "expense" ||
            transaction.entries.length !== 2 ||
            !first ||
            transaction.entries.some(
                (entry) =>
                    entry.currency?.base !== first.base ||
                    entry.currency?.target !== first.target,
            ) ||
            !transaction.entries.some(
                (entry) => accountById.get(entry.accountId)?.type === "asset",
            ) ||
            !transaction.entries.some(
                (entry) => accountById.get(entry.accountId)?.type === "expense",
            )
        )
            throw new Error("Currency estimates require a two-account expense");
    }
    if (sumAmounts(transaction.entries.map(getEntryAmount)) !== 0) {
        throw new Error("Transaction entries must balance exactly to zero");
    }
}

/**
 * 校验完整交易集合：每笔独立平衡，交易 ID 唯一，父引用存在且无循环。
 * 不要求父交易先出现，支持多层关联；不要使用分页/筛选后的列表校验。
 * 修改或删除父交易后，应再次校验候选集合，避免产生孤立子交易。
 */
export function validateTransactions(
    transactions: readonly Transaction[],
    accounts: readonly Account[],
): void {
    const transactionById = new Map<string, Transaction>();
    for (const transaction of transactions) {
        if (transactionById.has(transaction.id)) {
            throw new Error(`Duplicate transaction ID: ${transaction.id}`);
        }
        transactionById.set(transaction.id, transaction);
    }

    for (const transaction of transactions) {
        validateTransaction(transaction, accounts);
        if (
            transaction.parentTransactionId !== undefined &&
            !transactionById.has(transaction.parentTransactionId)
        ) {
            throw new Error(
                `Parent transaction not found: ${transaction.parentTransactionId}`,
            );
        }
    }

    // 迭代遍历父引用，不递归展开，避免深层关系导致调用栈溢出。
    const validated = new Set<string>();
    for (const transaction of transactions) {
        const path = new Set<string>();
        let current: Transaction | undefined = transaction;
        while (current !== undefined && !validated.has(current.id)) {
            if (path.has(current.id)) {
                throw new Error(`Transaction parent cycle: ${current.id}`);
            }
            path.add(current.id);
            current =
                current.parentTransactionId === undefined
                    ? undefined
                    : transactionById.get(current.parentTransactionId);
        }
        for (const id of path) validated.add(id);
    }
}
