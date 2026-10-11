import {
    createAccount,
    deleteAccount,
    type NewAccount,
    updateAccount,
} from "./account";
import type { AccountingData } from "./backup";
import { defaultCurrencySettings } from "./currency-settings";

/** 账户及专属币种在同一次账本写入中保存。 */
export function saveAccountConfiguration(
    data: AccountingData,
    input: NewAccount,
    now: number,
    options: {
        cardCurrencyId?: string;
    } = {},
): AccountingData {
    let settings = data.currencySettings ?? defaultCurrencySettings;
    const previous = data.accounts.find((account) => account.id === input.id);
    if (input.subtype !== "prepaid")
        settings = {
            ...settings,
            customCurrencies: settings.customCurrencies.filter(
                (currency) => currency.accountId !== input.id,
            ),
        };
    if (input.subtype === "prepaid") {
        const owned = settings.customCurrencies.find(
            (currency) => currency.accountId === input.id,
        );
        const currencyId = owned?.id ?? options.cardCurrencyId;
        if (
            !currencyId ||
            currencyId === input.id ||
            data.accounts.some(
                (account) =>
                    account.id !== input.id &&
                    account.type === "asset" &&
                    account.currency === currencyId,
            )
        )
            throw new Error("Recharge card requires its own currency");
        settings = {
            ...settings,
            multiCurrency: true,
            customCurrencies: [
                ...settings.customCurrencies.filter(
                    (currency) => currency.id !== currencyId,
                ),
                {
                    id: currencyId,
                    accountId: input.id,
                    name: input.name,
                    symbol: "",
                    rateToBase: 1,
                },
            ],
        };
        input = {
            ...input,
            currency: currencyId,
            costCurrency: previous?.costCurrency ?? settings.baseCurrency,
        };
    }
    const account = previous
        ? updateAccount(input.id, input, data.accounts, data.transactions, now)
        : createAccount(input, data.accounts, now);
    const accounts = previous
        ? data.accounts.map((item) => (item.id === account.id ? account : item))
        : [...data.accounts, account];
    return {
        ...data,
        accounts,
        currencySettings: settings,
    };
}

/** 删除未入账账户时一并清理其专属币种；其他子账户仍受保护。 */
export function deleteConfiguredAccount(
    data: AccountingData,
    id: string,
): AccountingData {
    const accounts = deleteAccount(id, data.accounts, data.transactions);
    const removedCurrency = data.currencySettings?.customCurrencies.find(
        (currency) => currency.accountId === id,
    )?.id;
    return {
        ...data,
        accounts,
        ...(data.currencySettings === undefined
            ? {}
            : {
                  currencySettings: {
                      ...data.currencySettings,
                      customCurrencies:
                          data.currencySettings.customCurrencies.filter(
                              (currency) => currency.accountId !== id,
                          ),
                      quickCurrencies:
                          data.currencySettings.quickCurrencies.filter(
                              (currencyId) => currencyId !== removedCurrency,
                          ),
                  },
              }),
    };
}
