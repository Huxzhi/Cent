import { createId } from "@glink25/sync-sdk";
import { z } from "zod";
import { BillCategories } from "../category";
import type { BillCategory, GlobalMeta } from "../type";
import { createAccount } from "./account";
import { sumAmounts } from "./amount";
import { type AccountingData, validateAccountingData } from "./backup";
import { recalculateCurrencyTransactions } from "./currency-cost";
import { defaultAccountCatalog } from "./default-account-catalog";
import {
    transactionImagesSchema,
    transactionLocationSchema,
} from "./transaction-media";
import type { Account, Transaction } from "./types";

const integer = z.number().refine(Number.isSafeInteger);
const timestamp = integer.refine((value) => value >= 0);
const id = z.string().trim().min(1);
const billSchema = z
    .object({
        id,
        type: z.enum(["expense", "income"]),
        categoryId: id,
        paymentMethod: id.optional(),
        amount: integer.refine((value) => value !== 0),
        time: timestamp,
        comment: z.string().optional(),
        creatorId: z.union([z.string(), integer]).optional(),
        tagIds: z.array(id).optional(),
        images: transactionImagesSchema.optional(),
        location: transactionLocationSchema.nullable().optional(),
        currency: z
            .object({
                base: id,
                target: id,
                amount: integer.refine((value) => value !== 0),
            })
            .optional(),
        __create_at: timestamp.optional(),
        __update_at: timestamp.optional(),
    })
    .passthrough();

export const canImportToAsset = (account: Account) =>
    account.type === "asset" &&
    !account.archived &&
    !account.paymentDisabled &&
    account.subtype !== "subscription";

export type ImportAssetSelection = string | Readonly<Record<string, string>>;

/** Optional script field: each distinct payment method needs an explicit asset mapping. */
export function billImportGroups(input: readonly unknown[]) {
    return [
        ...new Set(
            input.map((item) => {
                if (item && typeof item === "object" && "paymentMethod" in item)
                    return String(item.paymentMethod ?? "").trim();
                return "";
            }),
        ),
    ];
}

/** Pure append conversion. No balances are assigned and no existing records are replaced. */
export function importBillsToAccounting(
    current: AccountingData,
    input: readonly unknown[],
    meta: Partial<GlobalMeta> | undefined,
    assetId: ImportAssetSelection,
    now: number,
) {
    const bills = z.array(billSchema).parse(input);
    if (typeof assetId === "string" && billImportGroups(bills).length > 1)
        throw new Error("不同支付方式请分别选择资产账户。");
    const assetFor = (paymentMethod: string = "") => {
        const selected =
            typeof assetId === "string" ? assetId : assetId[paymentMethod];
        const asset = current.accounts.find(
            (account) => account.id === selected,
        );
        if (!asset || !canImportToAsset(asset))
            throw new Error(
                `请选择有效的资产账户${paymentMethod ? `：${paymentMethod}` : ""}。`,
            );
        return asset;
    };
    for (const group of billImportGroups(bills)) assetFor(group);
    const ids = new Set(
        current.transactions.map((transaction) => transaction.id),
    );
    const incoming = new Map<string, z.infer<typeof billSchema>>();
    let skipped = 0;
    for (const bill of bills) {
        const prior = incoming.get(bill.id);
        if (prior && JSON.stringify(prior) !== JSON.stringify(bill))
            throw new Error(`导入文件包含内容不同的重复 ID：${bill.id}`);
        if (ids.has(bill.id) || prior) {
            skipped++;
            continue;
        }
        incoming.set(bill.id, bill);
    }
    const accounts = [...current.accounts];
    const categories = new Map(
        BillCategories.map((category) => [category.id, category]),
    );
    for (const category of meta?.categories ?? [])
        categories.set(category.id, category);
    const resolving = new Set<string>();
    const categoryAccount = (
        categoryId: string,
        type: "expense" | "income",
        currency: string,
    ): Account => {
        const category: BillCategory | undefined = categories.get(categoryId);
        if (category && category.type !== type)
            throw new Error(`账单类型和分类不一致：${categoryId}`);
        const key = `category:${categoryId}`;
        const existing = accounts.find(
            (account) =>
                account.type === type &&
                account.currency === currency &&
                !account.archived &&
                account.presetKey === key,
        );
        if (existing) return existing;
        if (resolving.has(categoryId))
            throw new Error("导入分类存在循环父子关系。");
        resolving.add(categoryId);
        const preset = defaultAccountCatalog.find(
            (item) => item.key === key && item.type === type,
        );
        const parentId = category?.parent
            ? categoryAccount(category.parent, type, currency).id
            : undefined;
        const account = createAccount(
            {
                id: createId(),
                type,
                currency,
                name: category?.customName
                    ? category.name
                    : (preset?.name ?? category?.name ?? categoryId),
                presetKey: key,
                parentId,
                icon: category?.icon || preset?.icon,
            },
            accounts,
            now,
        );
        accounts.push(account);
        resolving.delete(categoryId);
        return account;
    };
    const tagMetadata = structuredClone(
        current.tagMetadata ?? { tags: [], groupsByUser: {} },
    );
    const incomingTags = new Map(
        (meta?.tags ?? []).map((tag) => [tag.id, tag]),
    );
    const tagIds = new Map<string, string>();
    const tagId = (source: string) => {
        const cached = tagIds.get(source);
        if (cached) return cached;
        const tag = incomingTags.get(source) ?? { id: source, name: source };
        const existing = tagMetadata.tags.find((item) => item.id === source);
        let target = source;
        if (
            existing &&
            incomingTags.has(source) &&
            existing.name !== tag.name
        ) {
            target =
                tagMetadata.tags.find((item) => item.name === tag.name)?.id ??
                createId();
        }
        if (!tagMetadata.tags.some((item) => item.id === target))
            tagMetadata.tags.push({ ...tag, id: target });
        tagIds.set(source, target);
        return target;
    };
    const added: Transaction[] = [];
    for (const bill of incoming.values()) {
        const asset = assetFor(bill.paymentMethod);
        const currency = bill.currency?.target ?? meta?.baseCurrency ?? "CNY";
        if (currency !== asset.currency)
            throw new Error(
                `账单 ${bill.id} 的币种为 ${currency}，请选择相同币种的资产账户。`,
            );
        const amount = bill.currency?.amount ?? bill.amount;
        if (Math.sign(amount) !== Math.sign(bill.amount))
            throw new Error(`账单 ${bill.id} 的原币与记账金额方向不一致。`);
        const category = categoryAccount(
            bill.categoryId,
            bill.type,
            asset.currency,
        );
        const expense = bill.type === "expense";
        const createdAt = bill.__create_at ?? bill.time;
        added.push({
            id: bill.id,
            type: bill.type,
            currency,
            time: bill.time,
            createdAt,
            updatedAt: Math.max(createdAt, bill.__update_at ?? createdAt),
            description: bill.comment,
            creatorId: bill.creatorId,
            images: bill.images,
            location: bill.location,
            tagIds: bill.tagIds?.map(tagId),
            entries: [
                { accountId: category.id, amount: expense ? amount : -amount },
                { accountId: asset.id, amount: expense ? -amount : amount },
            ],
        });
    }
    if (!added.length)
        return {
            data: current,
            added,
            skipped,
            assetChange: 0,
            assetChanges: {} as Record<string, number>,
        };
    const transactions = recalculateCurrencyTransactions(
        [...current.transactions, ...added],
        accounts,
        undefined,
        current.currencySettings?.baseCurrency,
    );
    const data = validateAccountingData({
        ...current,
        accounts,
        transactions,
        ...(tagMetadata.tags.length ? { tagMetadata } : {}),
    });
    const assetChanges: Record<string, number> = {};
    for (const transaction of added) {
        const entry = transaction.entries[1];
        assetChanges[entry.accountId] = sumAmounts([
            assetChanges[entry.accountId] ?? 0,
            entry.amount,
        ]);
    }
    const assetChange = sumAmounts(
        added.map((transaction) => transaction.entries[1].amount),
    );
    return { data, added, skipped, assetChange, assetChanges };
}
