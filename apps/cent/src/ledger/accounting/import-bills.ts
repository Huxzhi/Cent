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

export const canImportToPaymentAccount = (account: Account) =>
    (account.type === "asset" || account.type === "liability") &&
    !account.archived &&
    !account.paymentDisabled &&
    account.subtype !== "subscription";

export type ImportPaymentAccountSelection =
    | string
    | Readonly<Record<string, string>>;

/** Optional script field: each distinct payment method needs an explicit payment-account mapping. */
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
    accountSelection: ImportPaymentAccountSelection,
    now: number,
) {
    const bills = z.array(billSchema).parse(input);
    if (
        typeof accountSelection === "string" &&
        billImportGroups(bills).length > 1
    )
        throw new Error("不同支付方式请分别选择收付款账户（资产或负债）。");
    const paymentAccountFor = (paymentMethod: string = "") => {
        const selected =
            typeof accountSelection === "string"
                ? accountSelection
                : accountSelection[paymentMethod];
        const paymentAccount = current.accounts.find(
            (account) => account.id === selected,
        );
        if (!paymentAccount || !canImportToPaymentAccount(paymentAccount))
            throw new Error(
                `请选择有效的收付款账户（资产或负债）${paymentMethod ? `：${paymentMethod}` : ""}。`,
            );
        return paymentAccount;
    };
    for (const group of billImportGroups(bills)) paymentAccountFor(group);
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
        const paymentAccount = paymentAccountFor(bill.paymentMethod);
        const currency = bill.currency?.target ?? meta?.baseCurrency ?? "CNY";
        if (currency !== paymentAccount.currency)
            throw new Error(
                `账单 ${bill.id} 的币种为 ${currency}，请选择相同币种的收付款账户（资产或负债）。`,
            );
        const amount = bill.currency?.amount ?? bill.amount;
        if (Math.sign(amount) !== Math.sign(bill.amount))
            throw new Error(`账单 ${bill.id} 的原币与记账金额方向不一致。`);
        const category = categoryAccount(
            bill.categoryId,
            bill.type,
            paymentAccount.currency,
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
                {
                    accountId: paymentAccount.id,
                    amount: expense ? -amount : amount,
                },
            ],
        });
    }
    if (!added.length)
        return {
            data: current,
            added,
            skipped,
            accountChanges: {} as Record<string, number>,
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
    const accountChanges: Record<string, number> = {};
    for (const transaction of added) {
        const entry = transaction.entries[1];
        accountChanges[entry.accountId] = sumAmounts([
            accountChanges[entry.accountId] ?? 0,
            entry.amount,
        ]);
    }
    return { data, added, skipped, accountChanges };
}
