import type { Account } from "../../ledger/accounting";
import { defaultAccountCatalog } from "../../ledger/accounting/default-account-catalog";

/** 只翻译仍保留默认名称的预置账户；自定义或改名后的名称属于用户数据。 */
export function getAccountLabelKey(account: Account): string | undefined {
    const preset = defaultAccountCatalog.find(
        (item) =>
            item.key === account.presetKey &&
            item.name === account.name &&
            item.type === account.type,
    );
    return preset?.labelKey;
}
