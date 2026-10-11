import { useCallback, useMemo } from "react";
import { v4 } from "uuid";
import { useStore } from "zustand";
import { DefaultCurrencies } from "@/api/currency/currencies";
import { getAccountLabelKey } from "@/components/accounting/account-label";
import {
    type CurrencySettings,
    defaultCurrencySettings,
    isMultiCurrencyEnabled,
    setQuickCurrencies,
} from "@/ledger/accounting/currency-settings";
import {
    deriveExchangeRates,
    exchangeValueRate,
} from "@/ledger/accounting/exchange-rates";
import type { CustomCurrency } from "@/ledger/type";
import { t, useIntl } from "@/locale";
import { accountingStore } from "@/store/accounting";
import type { CConvert } from "@/store/currency";
import { useAccountingView } from "./use-accounting-view";

/** 汇率完全来自当前账本换汇分录，不查询行情或使用旧报价缓存。 */
export const useCurrency = () => {
    const settings = useStore(
        accountingStore,
        (s) => s.current?.data.currencySettings ?? defaultCurrencySettings,
    );
    const bookId = useStore(accountingStore, (s) => s.current?.book.id);
    const data = useStore(accountingStore, (s) => s.current?.data);
    const view = useAccountingView(data);
    const intl = useIntl();
    const allCurrencies = useMemo(
        () => [
            ...settings.customCurrencies.map((c) => {
                const account = data?.accounts.find(
                    (account) =>
                        account.id === c.accountId && account.name === c.name,
                );
                const key = account && getAccountLabelKey(account);
                return { ...c, label: key ? intl(key) : c.name };
            }),
            ...DefaultCurrencies.map((c) => ({
                ...c,
                label: intl(c.labelKey),
            })),
        ],
        [settings.customCurrencies, data?.accounts, intl],
    );
    const baseCurrency = allCurrencies.find(
        (c) => c.id === settings.baseCurrency,
    ) ?? {
        id: settings.baseCurrency,
        label: settings.baseCurrency,
        name: settings.baseCurrency,
        symbol: settings.baseCurrency,
        rateToBase: 1,
    };
    const exchangeRates = useMemo(
        () =>
            deriveExchangeRates(
                data?.accounts ?? [],
                view.transactions,
                settings.baseCurrency,
            ),
        [data?.accounts, view.transactions, settings.baseCurrency],
    );
    const update = useCallback(
        async (transform: (previous: CurrencySettings) => CurrencySettings) => {
            await accountingStore.getState().updateData((data) => {
                if (accountingStore.getState().current?.book.id !== bookId)
                    throw new Error("Book changed; reopen currency settings");
                return {
                    ...data,
                    currencySettings: transform(
                        data.currencySettings ?? defaultCurrencySettings,
                    ),
                };
            }, Date.now());
        },
        [bookId],
    );
    const convert: CConvert = useCallback(
        (money, target, base) => {
            const rate = exchangeValueRate(exchangeRates, target, base);
            const value = rate === undefined ? Number.NaN : money * rate;
            return {
                predict: value,
                accurate: rate !== undefined,
                finished: Promise.resolve(value),
            };
        },
        [exchangeRates],
    );
    const setBaseCurrency = useCallback(
        async (id: string) => {
            if (id === settings.baseCurrency) return;
            await update((previous) => ({ ...previous, baseCurrency: id }));
        },
        [settings.baseCurrency, update],
    );
    const updateCustomCurrency = useCallback(
        (currency: Omit<CustomCurrency, "id"> & { id?: string }) => {
            const id = currency.id ?? v4();
            if (DefaultCurrencies.some((c) => c.id === id))
                return Promise.reject(new Error("Reserved currency ID"));
            return update((previous) => ({
                ...previous,
                customCurrencies: [
                    ...previous.customCurrencies.filter((c) => c.id !== id),
                    {
                        ...previous.customCurrencies.find(
                            (item) => item.id === id,
                        ),
                        ...currency,
                        id,
                    },
                ],
            }));
        },
        [update],
    );
    const deleteCustomCurrency = useCallback(
        (id: string) =>
            update((previous) => {
                if (
                    previous.baseCurrency === id ||
                    accountingStore
                        .getState()
                        .current?.data.accounts.some((a) => a.currency === id)
                )
                    throw new Error(intl("accounting-currency-used"));
                const rates = { ...previous.rates };
                delete rates[id];
                return {
                    ...previous,
                    customCurrencies: previous.customCurrencies.filter(
                        (c) => c.id !== id,
                    ),
                    quickCurrencies: previous.quickCurrencies.filter(
                        (c) => c !== id,
                    ),
                    rates,
                };
            }),
        [update, intl],
    );
    const quickCurrencies = useMemo(
        () =>
            settings.quickCurrencies
                .map((id) => allCurrencies.find((c) => c.id === id))
                .filter((c) => c !== undefined),
        [settings.quickCurrencies, allCurrencies],
    );
    const updateQuickCurrencies = useCallback(
        (ids: string[]) =>
            update((previous) => setQuickCurrencies(previous, ids)),
        [update],
    );
    return {
        multiCurrency: isMultiCurrencyEnabled(settings, data?.accounts),
        baseCurrency,
        setBaseCurrency,
        convert,
        customCurrencies: settings.customCurrencies,
        updateCustomCurrency,
        deleteCustomCurrency,
        allCurrencies,
        quickCurrencies,
        updateQuickCurrencies,
    };
};

export const getAllCurrencies = () => [
    ...(
        accountingStore.getState().current?.data.currencySettings
            ?.customCurrencies ?? []
    ).map((c) => ({ ...c, label: c.name })),
    ...DefaultCurrencies.map((c) => ({ ...c, label: t(c.labelKey) })),
];
export const getQuickCurrencies = () => {
    const all = getAllCurrencies();
    return (
        accountingStore.getState().current?.data.currencySettings
            ?.quickCurrencies ?? []
    )
        .map((id) => all.find((c) => c.id === id))
        .filter((c) => c !== undefined);
};
