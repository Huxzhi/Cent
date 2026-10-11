import { z } from "zod";
import { getDefaultTimeZone, isValidTimeZone } from "../../utils/time";
import { validateAccounts } from "./account";
import { replayCurrencyCosts } from "./currency-cost";
import { deriveCurrencyExchange } from "./currency-exchange";
import {
    type CurrencySettings,
    currencySettingsSchema,
} from "./currency-settings";
import { validatePurchaseDepreciation } from "./purchase-depreciation";
import {
    type SavedStatisticsView,
    statisticsViewsSchema,
} from "./statistics-view";
import {
    type AccountingTagMetadata,
    accountingTagMetadataSchema,
} from "./tags";
import {
    flattenTransactionTree,
    getRootTransactions,
    synchronizeTransactionChildren,
} from "./transaction";
import {
    type AccountingMapConfig,
    accountingMapConfigSchema,
    transactionImagesSchema,
    transactionLocationSchema,
} from "./transaction-media";
import type { Account, Transaction } from "./types";
import { validateTransactions } from "./validation";

export interface AccountingData {
    timeZone?: string;
    accounts: Account[];
    transactions: Transaction[];
    tagMetadata?: AccountingTagMetadata;
    mapConfig?: AccountingMapConfig;
    currencySettings?: CurrencySettings;
    statisticsViews?: SavedStatisticsView[];
}

const integer = z
    .number()
    .refine(Number.isSafeInteger, "Expected a safe integer");
const timestamp = integer.refine(
    (value) => value >= 0,
    "Expected a nonnegative millisecond timestamp",
);
const id = z
    .string()
    .refine((value) => value.trim().length > 0, "Expected a nonempty ID");
const accountSchema = z
    .object({
        id,
        name: z.string(),
        type: z.enum(["asset", "liability", "income", "expense", "equity"]),
        subtype: z.string().optional(),
        presetKey: z.string().min(1).optional(),
        icon: z.string().min(1).optional(),
        parentId: id.optional(),
        currency: id,
        costCurrency: id.optional(),
        paymentDisabled: z.boolean().optional(),
        archived: z.boolean(),
        createdAt: timestamp,
        updatedAt: timestamp,
    })
    .strict() satisfies z.ZodType<Account>;

type PersistedTransaction = Omit<
    Transaction,
    "currency" | "exchange" | "children"
> & { children?: PersistedTransaction[] };
const persistedTransactionObject = z
    .object({
        id,
        time: timestamp,
        description: z.string().optional(),
        parentTransactionId: id.optional(),
        creatorId: z.union([z.string(), integer]).optional(),
        tagIds: z.array(id).optional(),
        createdAt: timestamp,
        updatedAt: timestamp,
        location: transactionLocationSchema.nullable().optional(),
        images: transactionImagesSchema.optional(),
        endTime: timestamp.optional(),
        type: z.enum([
            "currency_exchange",
            "topup",
            "journal",
            "expense",
            "income",
            "transfer",
            "asset_purchase",
            "depreciation",
            "liability_borrowing",
            "opening_balance",
            "adjustment",
            "liability_payment",
            "split",
        ]),
        entries: z.array(
            z
                .object({
                    accountId: id,
                    amount: integer,
                    currency: z
                        .object({ base: id, target: id, amount: integer })
                        .strict()
                        .optional(),
                })
                .strict(),
        ),
    })
    .strict();
const persistedTransactionSchema: z.ZodType<PersistedTransaction> = z.lazy(() =>
    persistedTransactionObject
        .extend({
            children: z.array(persistedTransactionSchema).optional(),
        })
        .refine(
            (value) => value.updatedAt >= value.createdAt,
            "Transaction updatedAt must not precede createdAt",
        ),
);
const domainTransactionSchema: z.ZodType<Transaction> = z.lazy(() =>
    persistedTransactionObject
        .extend({
            currency: id,
            exchange: z
                .object({
                    fromAccountId: id,
                    toAccountId: id,
                    fromTradingAccountId: id,
                    toTradingAccountId: id,
                    feeAccountId: id.optional(),
                })
                .strict()
                .optional(),
            children: z.array(domainTransactionSchema).optional(),
        })
        .refine(
            (value) => value.updatedAt >= value.createdAt,
            "Transaction updatedAt must not precede createdAt",
        ),
);

// Breaking development-format cleanup: no migration of old accounting formats.
const currentFileSchema = z
    .object({
        format: z.literal("cent-accounting"),
        schemaVersion: z.literal(17),
        amountScale: z.literal(10000),
        accounts: z.array(accountSchema),
        transactions: z.array(persistedTransactionSchema),
        tagMetadata: accountingTagMetadataSchema.optional(),
        mapConfig: accountingMapConfigSchema.optional(),
        currencySettings: currencySettingsSchema.optional(),
        statisticsViews: statisticsViewsSchema.optional(),
        timeZone: z
            .string()
            .refine(isValidTimeZone, "Invalid time zone")
            .optional(),
    })
    .strict();
const currentDomainSchema = currentFileSchema.extend({
    transactions: z.array(domainTransactionSchema),
});

function normalizeFile(
    data: z.infer<typeof currentFileSchema>,
): AccountingData {
    return {
        ...data,
        transactions: flattenTransactionTree(data.transactions).map(
            (transaction) => {
                const exchange = deriveCurrencyExchange(
                    transaction,
                    data.accounts,
                );
                const accountId =
                    exchange?.fromAccountId ??
                    transaction.entries[0]?.accountId;
                const account = data.accounts.find(
                    (account) => account.id === accountId,
                );
                if (!account)
                    throw new Error(`Account not found: ${accountId}`);
                return {
                    ...transaction,
                    children: undefined,
                    currency: account.currency,
                    ...(exchange ? { exchange } : {}),
                };
            },
        ),
    };
}

function validateAndOrder(data: AccountingData): AccountingData {
    validateAccounts(data.accounts);
    validatePurchaseDepreciation(data.transactions, data.accounts);
    for (const currency of data.currencySettings?.customCurrencies ?? []) {
        if (!currency.accountId) continue;
        const owner = data.accounts.find(
            (account) => account.id === currency.accountId,
        );
        if (
            owner?.type !== "asset" ||
            owner.subtype !== "prepaid" ||
            owner.currency !== currency.id ||
            !owner.costCurrency ||
            data.accounts.some(
                (account) =>
                    account.type === "asset" &&
                    account.currency === currency.id &&
                    account.id !== owner.id,
            )
        )
            throw new Error("Invalid recharge card currency owner");
    }
    validateTransactions(data.transactions, data.accounts);
    replayCurrencyCosts(
        data.accounts,
        data.transactions,
        undefined,
        data.currencySettings?.baseCurrency,
    );
    const compareIds = (left: { id: string }, right: { id: string }) =>
        left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
    return {
        ...(data.currencySettings === undefined
            ? {}
            : { currencySettings: data.currencySettings }),
        accounts: data.accounts
            .map((account) =>
                account.subtype === "subscription"
                    ? { ...account, paymentDisabled: true }
                    : account,
            )
            .sort(compareIds),
        timeZone: data.timeZone ?? getDefaultTimeZone(),
        transactions: synchronizeTransactionChildren(data.transactions).sort(
            (left, right) => left.time - right.time || compareIds(left, right),
        ),
        ...(data.tagMetadata === undefined
            ? {}
            : { tagMetadata: data.tagMetadata }),
        ...(data.mapConfig === undefined ? {} : { mapConfig: data.mapConfig }),
        ...(data.statisticsViews === undefined
            ? {}
            : { statisticsViews: data.statisticsViews }),
    };
}

/** 校验并复制结构化领域数据；正常保存不经过 JSON 序列化。 */
export function validateAccountingData(
    data: AccountingData,
    now?: number,
): AccountingData {
    return validateAndOrder(
        currentDomainSchema.parse({
            ...data,
            transactions: synchronizeTransactionChildren(
                data.transactions,
                now,
            ),
            format: "cent-accounting",
            schemaVersion: 17,
            amountScale: 10000,
        }),
    );
}

/**
 * 导出完整领域快照；无系统时钟、文件下载或存储副作用。
 * 先检查数据再序列化，避免 NaN/Infinity 被 JSON 静默转为 null。
 * 新格式只包含已定义的模型字段，未来扩展须显式升级文件 schema。
 */
function toPersistedTransaction(
    transaction: Transaction,
): PersistedTransaction {
    const {
        currency: _currency,
        exchange: _exchange,
        children,
        ...own
    } = transaction;
    return {
        ...own,
        ...(children?.length
            ? { children: children.map(toPersistedTransaction) }
            : {}),
    };
}

export function exportAccountingJson(
    accounts: readonly Account[],
    transactions: readonly Transaction[],
    tagMetadata?: AccountingTagMetadata,
    mapConfig?: AccountingMapConfig,
    currencySettings?: CurrencySettings,
    statisticsViews?: readonly SavedStatisticsView[],
    timeZone?: string,
): string {
    const data = validateAccountingData({
        accounts: [...accounts],
        transactions: [...transactions],
        ...(timeZone === undefined ? {} : { timeZone }),
        ...(tagMetadata === undefined ? {} : { tagMetadata }),
        ...(mapConfig === undefined ? {} : { mapConfig }),
        ...(currencySettings === undefined ? {} : { currencySettings }),
        ...(statisticsViews === undefined
            ? {}
            : { statisticsViews: [...statisticsViews] }),
    });
    const parsed = currentFileSchema.parse({
        format: "cent-accounting",
        schemaVersion: 17,
        amountScale: 10000,
        ...data,
        transactions: getRootTransactions(data.transactions).map(
            toPersistedTransaction,
        ),
    });
    return JSON.stringify(parsed, null, 2);
}

/** Only current accounting JSON; no conversion of older formats. */
export function importAccountingJson(text: string): AccountingData {
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch (cause) {
        throw new Error("Invalid accounting JSON", { cause });
    }
    return validateAndOrder(normalizeFile(currentFileSchema.parse(raw)));
}
