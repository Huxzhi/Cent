import { z } from "zod";
import type { Account } from "./types";

const rate = z.number().finite().positive();
export const currencySettingsSchema = z
    .object({
        baseCurrency: z.string().min(1),
        multiCurrency: z.boolean().optional(),
        customCurrencies: z.array(
            z
                .object({
                    id: z.string().min(1),
                    /** 专属充值卡币种，只有该资产账户可以使用。费用/权益分录可使用同币种。 */
                    accountId: z.string().min(1).optional(),
                    name: z.string().min(1),
                    symbol: z.string(),
                    rateToBase: rate,
                })
                .strict(),
        ),
        quickCurrencies: z.array(z.string().min(1)),
        /** 保留旧文件中的报价元数据；应用估值从换汇分录推导，不读取此字段。 */
        rates: z.record(z.string().min(1), rate),
    })
    .strict()
    .refine(
        (value) =>
            new Set(value.customCurrencies.map((c) => c.id)).size ===
            value.customCurrencies.length,
        "Duplicate custom currency ID",
    );
export type CurrencySettings = z.infer<typeof currencySettingsSchema>;
export const defaultCurrencySettings: CurrencySettings = {
    baseCurrency: "CNY",
    customCurrencies: [],
    quickCurrencies: [],
    rates: {},
};

/** 原有置顶货币也表示用户已经启用多币种。 */
export function isMultiCurrencyEnabled(
    settings: CurrencySettings,
    accounts: readonly Account[] = [],
): boolean {
    return (
        settings.multiCurrency === true ||
        settings.quickCurrencies.length > 0 ||
        accounts.some(
            (account) =>
                account.type === "asset" &&
                account.currency !== settings.baseCurrency,
        )
    );
}

/** 外币资产账户与开关在同一次账本写入中提交；不需要用户预先开启。 */
export function enableAccountCurrencies(
    settings: CurrencySettings,
    accounts: readonly Account[],
): CurrencySettings {
    if (
        settings.multiCurrency === true ||
        !accounts.some(
            (account) =>
                account.type === "asset" &&
                account.currency !== settings.baseCurrency,
        )
    )
        return settings;
    return { ...settings, multiCurrency: true };
}

export function setMultiCurrencyEnabled(
    settings: CurrencySettings,
    enabled: boolean,
): CurrencySettings {
    return {
        ...settings,
        multiCurrency: enabled,
        quickCurrencies: enabled ? settings.quickCurrencies : [],
    };
}

export function setQuickCurrencies(
    settings: CurrencySettings,
    ids: readonly string[],
): CurrencySettings {
    const quickCurrencies = [...new Set(ids)];
    return {
        ...settings,
        multiCurrency:
            quickCurrencies.length > 0 || isMultiCurrencyEnabled(settings),
        quickCurrencies,
    };
}

/** 将目标币种换算为主货币；缺失报价返回 undefined，绝不按 1:1 估值。 */
export function currencyValueRate(
    settings: CurrencySettings,
    target: string,
    base: string,
    automatic: Record<string, number>,
): number | undefined {
    const quote = (id: string) =>
        id === settings.baseCurrency
            ? 1
            : (settings.customCurrencies.find((c) => c.id === id)?.rateToBase ??
              settings.rates[id] ??
              automatic[id]);
    const targetQuote = quote(target),
        baseQuote = quote(base);
    if (target === base) return 1;
    if (!targetQuote || !baseQuote) return undefined;
    const value = baseQuote / targetQuote;
    return Number.isFinite(value) && value > 0 ? value : undefined;
}

/** 同一快照中的报价先换成当前主货币基准，较新的有效报价优先。 */
export function automaticCurrencyQuotes(
    base: string,
    cache: readonly { base: string; rates: Record<string, number> }[],
    knownQuotes: Record<string, number> = {},
): Record<string, number> {
    const result: Record<string, number> = {};
    for (const snapshot of cache) {
        const scale =
            snapshot.base === base
                ? 1
                : (knownQuotes[snapshot.base] ??
                  (snapshot.rates[base]
                      ? 1 / snapshot.rates[base]
                      : undefined));
        if (!scale || !Number.isFinite(scale) || scale <= 0) continue;
        for (const [id, quote] of Object.entries({
            ...snapshot.rates,
            [snapshot.base]: 1,
        })) {
            const rate = quote * scale;
            if (result[id] === undefined && Number.isFinite(rate) && rate > 0)
                result[id] = rate;
        }
    }
    return result;
}

export function rebaseCurrencySettings(
    settings: CurrencySettings,
    base: string,
    automatic: Record<string, number>,
): CurrencySettings {
    if (base === settings.baseCurrency)
        return currencySettingsSchema.parse(settings);
    const quote = currencyValueRate(
        settings,
        settings.baseCurrency,
        base,
        automatic,
    );
    if (quote === undefined) throw new Error("Missing currency rate");
    return currencySettingsSchema.parse({
        ...settings,
        baseCurrency: base,
        rates: Object.fromEntries(
            Object.entries({ ...settings.rates, [settings.baseCurrency]: 1 })
                .filter(([id]) => id !== base)
                .map(([id, value]) => [id, value / quote]),
        ),
        customCurrencies: settings.customCurrencies.map((c) => ({
            ...c,
            rateToBase: c.rateToBase / quote,
        })),
    });
}
