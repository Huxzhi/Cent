import { defaultAccountCatalog } from "./default-account-catalog";
import type { Account, AccountType } from "./types";

const typeIcons: Record<AccountType, string> = {
    asset: "icon-[mdi--wallet]",
    liability: "icon-[mdi--credit-card]",
    income: "icon-[mdi--cash-plus]",
    expense: "icon-[mdi--cart]",
    equity: "icon-[mdi--scale-balance]",
};

/** 保存的图标优先；尚未设置时按预置分类或账户类型补充默认图标。 */
export function getAccountIcon(
    account: Pick<Account, "name" | "type" | "subtype" | "presetKey" | "icon">,
): string {
    if (account.icon !== undefined) return account.icon;
    const preset = defaultAccountCatalog.find(
        (item) =>
            item.type === account.type &&
            (account.presetKey === item.key ||
                (!account.presetKey && item.name === account.name)),
    );
    if (preset?.icon) return preset.icon;
    if (account.type === "asset") {
        if (account.subtype === "fixed_asset") return "icon-[mdi--laptop]";
        if (account.subtype === "subscription")
            return "icon-[mdi--calendar-clock]";
        if (account.subtype === "prepaid")
            return "icon-[mdi--card-account-details]";
        if (account.name === "现金") return "icon-[mdi--cash]";
    }
    return typeIcons[account.type];
}
