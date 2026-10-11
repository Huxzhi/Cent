import type { Account } from "./types";

export const CURRENCY_TRADING_GROUP_KEY = "system:currency-trading";

export function isCurrencyTradingGroup(account: Pick<Account, "presetKey">) {
    return account.presetKey === CURRENCY_TRADING_GROUP_KEY;
}

/** 币种由独立子账户记录；父账户只组织层级，不参与分录。 */
export function organizeCurrencyTradingAccounts(
    accounts: readonly Account[],
    baseCurrency: string,
    now: number,
    options: { groupId?: string; groupName?: string; create?: boolean } = {},
): Account[] {
    const children = accounts.filter(
        (account) => account.subtype === "currency_trading",
    );
    if (!children.length && !options.create) return [...accounts];
    const existing = accounts.find(isCurrencyTradingGroup);
    const group: Account = existing ?? {
        id: options.groupId ?? crypto.randomUUID(),
        name: options.groupName ?? "换汇平衡",
        type: "equity",
        currency: baseCurrency,
        presetKey: CURRENCY_TRADING_GROUP_KEY,
        icon: "icon-[mdi--scale-balance]",
        archived: false,
        createdAt: now,
        updatedAt: now,
    };
    return [
        ...accounts.map((account) =>
            account.subtype === "currency_trading" &&
            account.parentId !== group.id
                ? {
                      ...account,
                      parentId: group.id,
                      updatedAt: Math.max(now, account.updatedAt),
                  }
                : account,
        ),
        ...(existing ? [] : [group]),
    ];
}
