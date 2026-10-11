import { defaultAccountCatalog } from "../../ledger/accounting/default-account-catalog";
import type { Account } from "../../ledger/accounting/types";

/** 保存后的账户按 ID 排列，展示时恢复熟悉的内置分类顺序。 */
export function orderPickerAccounts(accounts: readonly Account[]): Account[] {
    const order = (account: Account) => {
        if (
            account.presetKey === "starter:expense" ||
            account.presetKey === "starter:income"
        )
            return defaultAccountCatalog.length;
        const preset = defaultAccountCatalog.findIndex(
            (item) => item.key === account.presetKey,
        );
        if (preset >= 0) return preset;
        return defaultAccountCatalog.length;
    };
    return [...accounts].sort((left, right) => order(left) - order(right));
}

export function accountPickerLevels(
    accounts: readonly Account[],
    selectedId: string,
): Account[][] {
    const ordered = orderPickerAccounts(accounts);
    const ids = new Set(ordered.map((account) => account.id));
    const root = ordered.find(
        (account) =>
            account.presetKey === "starter:expense" ||
            account.presetKey === "starter:income",
    );
    const top = ordered.filter(
        (account) =>
            !account.parentId ||
            !ids.has(account.parentId) ||
            account.parentId === root?.id,
    );
    const levels = [top];
    const path: Account[] = [];
    let selected = ordered.find((account) => account.id === selectedId);
    const visited = new Set<string>();
    while (selected && !visited.has(selected.id)) {
        visited.add(selected.id);
        path.unshift(selected);
        selected = ordered.find((account) => account.id === selected?.parentId);
    }
    for (const ancestor of path) {
        if (ancestor.id === root?.id) continue;
        const children = ordered.filter(
            (account) => account.parentId === ancestor.id,
        );
        if (children.length) levels.push(children);
    }
    return levels;
}
