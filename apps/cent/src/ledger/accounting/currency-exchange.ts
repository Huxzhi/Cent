import { createAccount, validateAccounts } from "./account";
import { assertAmount, sumAmounts } from "./amount";
import {
    isCurrencyTradingGroup,
    organizeCurrencyTradingAccounts,
} from "./currency-trading";
import type { TransactionMedia } from "./transaction-media";
import {
    copyTransactionMedia,
    retainTransactionMedia,
} from "./transaction-media";
import type { Account, Entry, Transaction } from "./types";
import { validateTransactions } from "./validation";

export interface CurrencyExchange {
    fromAccountId: string;
    toAccountId: string;
    fromTradingAccountId: string;
    toTradingAccountId: string;
    feeAccountId?: string;
}
/** 从换汇平衡账户的方向和币种确定角色；不依赖分录顺序，不保存重复的账户引用。 */
export function deriveCurrencyExchange(
    transaction: Pick<Transaction, "type" | "entries">,
    accounts: readonly Account[],
): CurrencyExchange | undefined {
    const accountById = new Map(
        accounts.map((account) => [account.id, account]),
    );
    const postings = transaction.entries.map((entry) => ({
        entry,
        account: accountById.get(entry.accountId),
    }));
    const trading = postings.filter(
        ({ account }) => account?.subtype === "currency_trading",
    );
    if (!trading.length && transaction.type !== "currency_exchange")
        return undefined;
    if (!["currency_exchange", "topup"].includes(transaction.type))
        throw new Error(
            "Currency trading requires a dedicated exchange transaction",
        );
    const one = (items: typeof postings) => {
        if (items.length !== 1 || !items[0].account)
            throw new Error(
                "Cannot determine currency exchange roles from entries",
            );
        return items[0].account;
    };
    if (trading.length !== 2)
        throw new Error("Exchange requires two currency trading entries");
    const fromTrading = one(
        trading.filter(
            ({ entry, account }) =>
                account?.type === "equity" && entry.amount > 0,
        ),
    );
    const toTrading = one(
        trading.filter(
            ({ entry, account }) =>
                account?.type === "equity" && entry.amount < 0,
        ),
    );
    if (fromTrading.currency === toTrading.currency)
        throw new Error("Exchange requires two different currencies");
    const regular = postings.filter(
        ({ account }) => account?.subtype !== "currency_trading",
    );
    const from = one(
        regular.filter(
            ({ entry, account }) =>
                entry.amount < 0 &&
                account?.currency === fromTrading.currency &&
                (account.type === "asset" || account.type === "liability"),
        ),
    );
    const to = one(
        regular.filter(
            ({ entry, account }) =>
                entry.amount > 0 &&
                account?.currency === toTrading.currency &&
                account.type === "asset",
        ),
    );
    const fees = regular.filter(
        ({ entry, account }) =>
            entry.amount > 0 &&
            account?.type === "expense" &&
            account.currency === fromTrading.currency,
    );
    if (fees.length > 1)
        throw new Error("Exchange requires at most one fee entry");
    const fee = fees.length ? one(fees) : undefined;
    if (regular.length !== (fee ? 3 : 2))
        throw new Error("Unexpected exchange entry");
    return {
        fromAccountId: from.id,
        toAccountId: to.id,
        fromTradingAccountId: fromTrading.id,
        toTradingAccountId: toTrading.id,
        ...(fee ? { feeAccountId: fee.id } : {}),
    };
}
/** 录入和展示时的派生金额，不是 Transaction 的持久化字段。 */
export interface CurrencyExchangeAmounts {
    withdrawn: number;
    received: number;
    fee: number;
}

export function getCurrencyExchangeAmounts(
    transaction: Transaction,
): CurrencyExchangeAmounts {
    const exchange = transaction.exchange;
    if (!exchange) throw new Error("Missing currency exchange details");
    const amount = (id: string) => {
        const entries = transaction.entries.filter(
            (entry) => entry.accountId === id,
        );
        if (entries.length !== 1)
            throw new Error(`Exchange requires one entry for account: ${id}`);
        assertAmount(entries[0].amount);
        return entries[0].amount;
    };
    return {
        withdrawn: -amount(exchange.fromAccountId),
        received: amount(exchange.toAccountId),
        fee:
            exchange.feeAccountId === undefined
                ? 0
                : amount(exchange.feeAccountId),
    };
}

/** 1 付款币种可兑换的到账币种单位数，从分录扣除明确手续费后倒推。 */
export function getCurrencyExchangeRate(transaction: Transaction): number {
    const { withdrawn, received, fee } =
        getCurrencyExchangeAmounts(transaction);
    const principal = sumAmounts([withdrawn, -fee]);
    const rate = received / principal;
    if (
        withdrawn <= fee ||
        received <= 0 ||
        fee < 0 ||
        !Number.isFinite(rate) ||
        rate <= 0
    )
        throw new Error("Invalid currency exchange amounts");
    return rate;
}
export interface CurrencyExchangeInput extends TransactionMedia {
    /** 跨币种资金转入：普通换汇或到账为充值卡。 */
    type?: "currency_exchange" | "topup";
    id: string;
    time: number;
    fromAccountId: string;
    toAccountId: string;
    withdrawn: number;
    received: number;
    fee: number;
    feeAccountId?: string;
    description?: string;
    parentTransactionId?: string;
    creatorId?: string | number;
    tagIds?: string[];
}

export function exchangeEntries(
    exchange: CurrencyExchange,
    amounts: CurrencyExchangeAmounts,
): Entry[] {
    const exchanged = sumAmounts([amounts.withdrawn, -amounts.fee]);
    return [
        { accountId: exchange.fromAccountId, amount: -amounts.withdrawn },
        { accountId: exchange.fromTradingAccountId, amount: exchanged },
        { accountId: exchange.toTradingAccountId, amount: -amounts.received },
        { accountId: exchange.toAccountId, amount: amounts.received },
        ...(amounts.fee
            ? [{ accountId: exchange.feeAccountId ?? "", amount: amounts.fee }]
            : []),
    ];
}

/** 校验换汇角色和实际分录，防止夹带分录。允许历史归档账户。 */
export function validateCurrencyExchange(
    transaction: Transaction,
    accounts: readonly Account[],
): void {
    const exchange = transaction.exchange;
    if (!exchange) throw new Error("Missing currency exchange details");
    const amounts = getCurrencyExchangeAmounts(transaction);
    for (const amount of [amounts.withdrawn, amounts.received, amounts.fee])
        assertAmount(amount);
    if (
        amounts.received <= 0 ||
        amounts.fee < 0 ||
        amounts.withdrawn <= amounts.fee
    )
        throw new Error(
            "Exchange amounts must be positive and fee smaller than withdrawal",
        );
    const find = (id: string) => {
        const account = accounts.find((a) => a.id === id);
        if (!account) throw new Error(`Account not found: ${id}`);
        return account;
    };
    const from = find(exchange.fromAccountId),
        to = find(exchange.toAccountId);
    if (
        !["asset", "liability"].includes(from.type) ||
        to.type !== "asset" ||
        !["currency_exchange", "topup"].includes(transaction.type) ||
        from.currency === to.currency ||
        transaction.currency !== from.currency
    )
        throw new Error(
            "Currency exchange requires assets in two different currencies",
        );
    for (const [id, currency] of [
        [exchange.fromTradingAccountId, from.currency],
        [exchange.toTradingAccountId, to.currency],
    ]) {
        const account = find(id);
        if (
            account.type !== "equity" ||
            account.subtype !== "currency_trading" ||
            account.currency !== currency
        )
            throw new Error("Invalid currency trading account");
    }
    if (amounts.fee > 0) {
        const fee = find(exchange.feeAccountId ?? "");
        if (fee.type !== "expense" || fee.currency !== from.currency)
            throw new Error(
                "Fee requires an expense account in the withdrawal currency",
            );
    } else if (exchange.feeAccountId !== undefined)
        throw new Error("Zero fee must not reference a fee account");
    getCurrencyExchangeRate(transaction);
    const expected = exchangeEntries(exchange, amounts);
    if (
        transaction.entries.length !== expected.length ||
        transaction.entries.some((entry) => {
            const match = expected.find(
                (candidate) => candidate.accountId === entry.accountId,
            );
            return (
                !match ||
                entry.amount !== match.amount ||
                entry.currency !== undefined
            );
        })
    )
        throw new Error("Exchange entries do not match execution details");
}

/** ID、时间和自动账户名称均由调用方提供；账户与交易由存储层一次提交。 */
export function createCurrencyExchange(
    input: CurrencyExchangeInput,
    accounts: readonly Account[],
    transactions: readonly Transaction[],
    now: number,
    trading: {
        fromId: string;
        toId: string;
        name: (currency: string) => string;
        groupId?: string;
        groupName?: string;
        baseCurrency?: string;
    },
) {
    validateAccounts(accounts);
    for (const timestamp of [input.time, now])
        if (!Number.isSafeInteger(timestamp) || timestamp < 0)
            throw new RangeError("Invalid exchange timestamp");
    const destination = accounts.find((a) => a.id === input.toAccountId);
    const asset = (id: string) => {
        const account = accounts.find((a) => a.id === id);
        if (
            !account ||
            account.archived ||
            !(
                account.type === "asset" ||
                (id === input.fromAccountId &&
                    destination?.type === "asset" &&
                    account.type === "liability")
            )
        )
            throw new Error("Select active asset accounts for exchange");
        return account;
    };
    const from = asset(input.fromAccountId),
        to = asset(input.toAccountId);
    if (
        [from, to].some(
            (account) => account.subtype === "prepaid" && !account.costCurrency,
        )
    )
        throw new Error(
            "Recharge cards require an independent currency and cost basis",
        );
    const nextAccounts = organizeCurrencyTradingAccounts(
        accounts,
        trading.baseCurrency ?? from.costCurrency ?? from.currency,
        now,
        {
            groupId: trading.groupId,
            groupName: trading.groupName,
            create: true,
        },
    );
    const group = nextAccounts.find(isCurrencyTradingGroup);
    if (
        input.fee > 0 &&
        accounts.find((a) => a.id === input.feeAccountId)?.archived
    )
        throw new Error("Cannot use archived fee account");
    const clearing = (currency: string, id: string) => {
        const existing = nextAccounts.find(
            (a) =>
                a.subtype === "currency_trading" &&
                a.currency === currency &&
                !a.archived,
        );
        if (existing) return existing.id;
        const account = createAccount(
            {
                id,
                name: trading.name(currency),
                type: "equity",
                subtype: "currency_trading",
                currency,
                parentId: group?.id,
            },
            nextAccounts,
            now,
        );
        nextAccounts.push(account);
        return account.id;
    };
    const exchange: CurrencyExchange = {
        fromAccountId: from.id,
        toAccountId: to.id,
        fromTradingAccountId: clearing(from.currency, trading.fromId),
        toTradingAccountId: clearing(to.currency, trading.toId),
        ...(input.fee ? { feeAccountId: input.feeAccountId } : {}),
    };
    const transaction: Transaction = {
        id: input.id,
        type: input.type ?? "currency_exchange",
        currency: from.currency,
        time: input.time,
        description: input.description,
        parentTransactionId: input.parentTransactionId,
        creatorId: input.creatorId,
        tagIds: input.tagIds && [...input.tagIds],
        ...copyTransactionMedia(input),
        exchange,
        entries: exchangeEntries(exchange, input),
        createdAt: now,
        updatedAt: now,
    };
    validateTransactions([...transactions, transaction], nextAccounts);
    return { accounts: nextAccounts, transaction };
}

export function updateCurrencyExchange(
    input: CurrencyExchangeInput,
    accounts: readonly Account[],
    transactions: readonly Transaction[],
    now: number,
    trading: Parameters<typeof createCurrencyExchange>[4],
) {
    validateTransactions(transactions, accounts);
    const original = transactions.find((t) => t.id === input.id);
    if (!original || !["currency_exchange", "topup"].includes(original.type))
        throw new Error("Currency exchange transaction not found");
    const result = createCurrencyExchange(
        {
            ...input,
            creatorId: original.creatorId,
            tagIds: input.tagIds ?? original.tagIds,
        },
        accounts,
        transactions.filter((t) => t.id !== input.id),
        now,
        trading,
    );
    return {
        ...result,
        transaction: {
            ...result.transaction,
            ...retainTransactionMedia(input, original),
            createdAt: original.createdAt,
            updatedAt: Math.max(now, original.updatedAt),
        },
    };
}
