import { getAccountIcon } from "./account-icon";
import { isCurrencyTradingGroup } from "./currency-trading";
import type { Account, Transaction } from "./types";
import { validateTransactions } from "./validation";

export type NewAccount = Omit<Account, "archived" | "createdAt" | "updatedAt">;
export type AccountChanges = Partial<
    Pick<
        Account,
        | "name"
        | "type"
        | "subtype"
        | "parentId"
        | "currency"
        | "costCurrency"
        | "paymentDisabled"
        | "archived"
        | "icon"
    >
>;

/** 校验单个账户字段；父引用及循环由 validateAccounts 校验。 */
export function validateAccount(account: Account): void {
    if (!account.id.trim()) throw new Error("Account ID must not be empty");
    if (!account.name.trim()) throw new Error("Account name must not be empty");
    if (!account.currency.trim())
        throw new Error("Account currency must not be empty");
    if (
        !["asset", "liability", "income", "expense", "equity"].includes(
            account.type,
        )
    ) {
        throw new Error(`Invalid account type: ${account.type}`);
    }
    if (typeof account.archived !== "boolean") {
        throw new Error("Account archived must be a boolean");
    }
    if (
        account.paymentDisabled !== undefined &&
        typeof account.paymentDisabled !== "boolean"
    )
        throw new Error("Account paymentDisabled must be a boolean");
    if (account.paymentDisabled && account.type !== "asset")
        throw new Error("Only asset accounts can disable payment selection");
    if (account.subtype !== undefined && !account.subtype.trim()) {
        throw new Error("Account subtype must not be empty");
    }
    if (account.presetKey !== undefined && !account.presetKey.trim())
        throw new Error("Account preset key must not be empty");
    if (account.icon !== undefined && !account.icon.trim())
        throw new Error("Account icon must not be empty");
    if (account.subtype === "currency_trading" && account.type !== "equity")
        throw new Error("Currency trading accounts must be equity");
    if (
        isCurrencyTradingGroup(account) &&
        (account.type !== "equity" ||
            account.parentId !== undefined ||
            account.subtype !== undefined)
    )
        throw new Error(
            "Currency trading group must be an independent equity group",
        );
    if (account.subtype === "prepaid" && account.type !== "asset")
        throw new Error("Prepaid accounts must be assets");
    if (
        ["fixed_asset", "subscription"].includes(account.subtype ?? "") &&
        account.type !== "asset"
    )
        throw new Error("Fixed asset and subscription accounts must be assets");
    if (
        account.costCurrency !== undefined &&
        (account.type !== "asset" ||
            !account.costCurrency.trim() ||
            account.costCurrency === account.currency)
    )
        throw new Error(
            "Asset cost currency must differ from its native currency",
        );
    if (account.parentId !== undefined) {
        if (!account.parentId.trim())
            throw new Error("Parent account ID must not be empty");
        if (account.parentId === account.id)
            throw new Error("Account must not be its own parent");
    }
    for (const time of [account.createdAt, account.updatedAt]) {
        if (!Number.isSafeInteger(time) || time < 0) {
            throw new RangeError(
                "Account timestamps must be nonnegative safe integers",
            );
        }
    }
    if (account.updatedAt < account.createdAt) {
        throw new Error("Account updatedAt must not precede createdAt");
    }
}

/**
 * 普通父子账户必须同类型、同币种；换汇平衡父账户可组织不同币种的平衡子账户。
 * 归档只影响后续业务的选择，不使历史账户或其子账户失效。
 */
export function validateAccounts(accounts: readonly Account[]): void {
    if (accounts.filter(isCurrencyTradingGroup).length > 1)
        throw new Error("Only one currency trading group is allowed");
    const byId = new Map<string, Account>();
    for (const account of accounts) {
        validateAccount(account);
        if (byId.has(account.id))
            throw new Error(`Duplicate account ID: ${account.id}`);
        byId.set(account.id, account);
    }
    for (const account of accounts) {
        if (account.parentId === undefined) continue;
        const parent = byId.get(account.parentId);
        if (!parent)
            throw new Error(`Parent account not found: ${account.parentId}`);
        if (parent.type !== account.type)
            throw new Error("Parent account type must match");
        if (
            isCurrencyTradingGroup(parent) &&
            account.subtype !== "currency_trading"
        )
            throw new Error(
                "Currency trading group only accepts trading accounts",
            );
        if (
            parent.currency !== account.currency &&
            !isCurrencyTradingGroup(parent)
        )
            throw new Error("Parent account currency must match");
    }
    const validated = new Set<string>();
    for (const account of accounts) {
        const path = new Set<string>();
        let current: Account | undefined = account;
        while (current !== undefined && !validated.has(current.id)) {
            if (path.has(current.id))
                throw new Error(`Account parent cycle: ${current.id}`);
            path.add(current.id);
            current =
                current.parentId === undefined
                    ? undefined
                    : byId.get(current.parentId);
        }
        for (const id of path) validated.add(id);
    }
}

function assertActiveParent(
    account: Account,
    accounts: readonly Account[],
): void {
    if (
        account.parentId !== undefined &&
        accounts.find((item) => item.id === account.parentId)?.archived
    ) {
        throw new Error("Cannot attach an account to an archived parent");
    }
}

/** ID 和时间由调用方提供，返回新账户，由调用方追加到集合并保存。 */
export function createAccount(
    input: NewAccount,
    accounts: readonly Account[],
    now: number,
): Account {
    const account: Account = {
        ...input,
        icon: getAccountIcon(input),
        archived: false,
        createdAt: now,
        updatedAt: now,
    };
    validateAccounts([...accounts, account]);
    assertActiveParent(account, accounts);
    if (account.subtype === "subscription") account.paymentDisabled = true;
    return account;
}

/**
 * 返回替换用的新账户，不修改输入。transactions 必须是完整历史。
 * 已被分录引用的账户不能改类型或币种，避免重新解释历史余额。
 * parentId/subtype 传 undefined 可清除；ID、创建时间不允许编辑。
 */
export function updateAccount(
    id: string,
    changes: AccountChanges,
    accounts: readonly Account[],
    transactions: readonly Transaction[],
    now: number,
): Account {
    validateAccounts(accounts);
    validateTransactions(transactions, accounts);
    const previous = accounts.find((account) => account.id === id);
    if (!previous) throw new Error(`Account not found: ${id}`);
    if (!Number.isSafeInteger(now) || now < previous.updatedAt) {
        throw new RangeError(
            "Account update time must not precede its last update",
        );
    }
    const account: Account = {
        ...previous,
        ...changes,
        id: previous.id,
        createdAt: previous.createdAt,
        updatedAt: now,
    };
    const used = transactions.some((transaction) =>
        transaction.entries.some((entry) => entry.accountId === id),
    );
    if (
        used &&
        (account.type !== previous.type ||
            account.currency !== previous.currency ||
            account.costCurrency !== previous.costCurrency)
    ) {
        throw new Error(
            "Cannot change type or currency of an account with entries",
        );
    }
    if (
        used &&
        (account.subtype === "currency_trading") !==
            (previous.subtype === "currency_trading")
    )
        throw new Error(
            "Cannot change currency trading mode of an account with entries",
        );
    if (
        used &&
        (account.subtype === "prepaid") !== (previous.subtype === "prepaid")
    )
        throw new Error(
            "Cannot change prepaid costing mode of an account with entries",
        );
    validateAccounts(accounts.map((item) => (item.id === id ? account : item)));
    if (account.parentId !== previous.parentId)
        assertActiveParent(account, accounts);
    if (account.subtype === "subscription") account.paymentDisabled = true;
    return account;
}

/** 归档不级联、不删除历史；恢复可通过 updateAccount({ archived: false })。 */
export function archiveAccount(
    id: string,
    accounts: readonly Account[],
    transactions: readonly Transaction[],
    now: number,
): Account {
    return updateAccount(id, { archived: true }, accounts, transactions, now);
}

/** 仅可删除无分录且无直接子账户的账户，否则应使用归档。 */
export function deleteAccount(
    id: string,
    accounts: readonly Account[],
    transactions: readonly Transaction[],
): Account[] {
    validateAccounts(accounts);
    validateTransactions(transactions, accounts);
    if (!accounts.some((account) => account.id === id))
        throw new Error(`Account not found: ${id}`);
    if (
        transactions.some((transaction) =>
            transaction.entries.some((entry) => entry.accountId === id),
        )
    ) {
        throw new Error(
            "Cannot delete an account with entries; archive it instead",
        );
    }
    if (accounts.some((account) => account.parentId === id)) {
        throw new Error("Cannot delete an account with child accounts");
    }
    return accounts.filter((account) => account.id !== id);
}
