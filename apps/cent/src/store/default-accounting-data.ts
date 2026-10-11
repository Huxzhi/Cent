import {
    type AccountingData,
    createAccount,
    createOpeningBalance,
    defaultCurrencySettings,
    numberToAmount,
    saveAccountConfiguration,
} from "../ledger/accounting";
import { defaultAccountCatalog } from "../ledger/accounting/default-account-catalog";
import { getDefaultTimeZone } from "../utils/time";

/** 每个账本独立生成 ID；新手模板只有微信的示例期初余额，其他账户等待实际入账。 */
export function createDefaultAccountingData(now: number): AccountingData {
    const ids = new Map(
        defaultAccountCatalog.map((item) => [item.key, crypto.randomUUID()]),
    );
    let data: AccountingData = {
        timeZone: getDefaultTimeZone(),
        accounts: [],
        transactions: [],
        currencySettings: structuredClone(defaultCurrencySettings),
    };
    const ensure = (key: string): string => {
        const id = ids.get(key);
        if (!id) throw new Error(`Unknown preset account: ${key}`);
        if (data.accounts.some((account) => account.id === id)) return id;
        const preset = defaultAccountCatalog.find((item) => item.key === key)!;
        const parentId = preset.parentKey
            ? ensure(preset.parentKey)
            : undefined;
        data.accounts.push(
            createAccount(
                {
                    id,
                    name: preset.name,
                    type: preset.type,
                    subtype: preset.subtype,
                    icon: preset.icon,
                    presetKey: preset.key,
                    currency: "CNY",
                    parentId,
                },
                data.accounts,
                now,
            ),
        );
        return id;
    };
    for (const preset of defaultAccountCatalog) ensure(preset.key);
    for (const preset of defaultAccountCatalog) {
        const account = data.accounts.find(
            (item) => item.id === ids.get(preset.key),
        )!;
        if (preset.subtype === "prepaid") {
            data = saveAccountConfiguration(data, account, now, {
                cardCurrencyId: crypto.randomUUID(),
            });
        }
    }
    const opening = createOpeningBalance(
        {
            id: crypto.randomUUID(),
            accountId: ids.get("template:wechat")!,
            equityAccountId: ids.get("template:wechat-equity")!,
            amount: numberToAmount(1000),
            time: now,
        },
        data.accounts,
        [],
        now,
    );
    if (opening) data.transactions.push(opening);
    return data;
}
