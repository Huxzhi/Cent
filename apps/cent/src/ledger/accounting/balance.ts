import { validateAccounts } from "./account";
import { sumAmounts } from "./amount";
import { getEntryAmount } from "./entry-amount";
import type { Account, Amount, Transaction } from "./types";

/**
 * 从已经 validateTransaction 校验过的交易聚合，调用方提供完整历史。
 * 只计该账户的原币金额，不按 type 筛选，也不缓存余额。
 */
export function getAccountRawBalance(
    account: Account,
    transactions: readonly Transaction[],
): Amount {
    const amounts: Amount[] = [];
    for (const transaction of transactions) {
        for (const entry of transaction.entries) {
            if (entry.accountId !== account.id) continue;
            if (
                !transaction.exchange &&
                transaction.currency !== account.currency
            ) {
                throw new Error(
                    `Account currency does not match: ${account.id}`,
                );
            }
            amounts.push(getEntryAmount(entry));
        }
    }
    return sumAmounts(amounts);
}

/**
 * 借方正、贷方负：资产/费用增加为正；负债/收入/权益增加为负。
 * 展示时仅对后三类反转符号，不取绝对值，以保留透支/退款等反向余额。
 * 返回值仍是 Cent 的整数金额，显示元数时使用 amountToNumber。
 */
export function getAccountDisplayBalance(
    account: Account,
    transactions: readonly Transaction[],
): Amount {
    const raw = getAccountRawBalance(account, transactions);
    if (raw === 0) return 0;
    return account.type === "asset" || account.type === "expense" ? raw : -raw;
}

/** 汇总自身及全部后代的分录；账户独立记账，父子之间不生成额外交易。 */
export function getAccountTotalRawBalance(
    account: Account,
    accounts: readonly Account[],
    transactions: readonly Transaction[],
): Amount {
    validateAccounts(accounts);
    if (!accounts.some((item) => item.id === account.id))
        throw new Error(`Account not found: ${account.id}`);
    const ids = new Set([account.id]);
    const queue = [account.id];
    const children = new Map<string, string[]>();
    for (const item of accounts) {
        if (!item.parentId) continue;
        const list = children.get(item.parentId) ?? [];
        list.push(item.id);
        children.set(item.parentId, list);
    }
    for (let index = 0; index < queue.length; index++) {
        for (const id of children.get(queue[index]) ?? []) {
            if (ids.has(id)) continue;
            ids.add(id);
            queue.push(id);
        }
    }
    const amounts: Amount[] = [];
    for (const transaction of transactions) {
        for (const entry of transaction.entries) {
            if (!ids.has(entry.accountId)) continue;
            if (
                accounts.find((item) => item.id === entry.accountId)
                    ?.currency !== account.currency
            )
                throw new Error("Cannot sum balances in different currencies");
            if (
                !transaction.exchange &&
                transaction.currency !== account.currency
            )
                throw new Error(
                    `Account currency does not match: ${account.id}`,
                );
            amounts.push(getEntryAmount(entry));
        }
    }
    return sumAmounts(amounts);
}

export function getAccountTotalDisplayBalance(
    account: Account,
    accounts: readonly Account[],
    transactions: readonly Transaction[],
): Amount {
    const raw = getAccountTotalRawBalance(account, accounts, transactions);
    if (raw === 0) return 0;
    return account.type === "asset" || account.type === "expense" ? raw : -raw;
}
