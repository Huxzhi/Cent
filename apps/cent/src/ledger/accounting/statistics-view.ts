import { z } from "zod";
import type { StatisticsFilter } from "./statistics";

const id = z.string().trim().min(1);
const timestamp = z.number().int().safe().nonnegative();
const filterSchema = z
    .object({
        accountId: id.optional(),
        relatedAccountId: id.optional(),
        tagId: id.optional(),
        creatorId: z.string().optional(),
        accountTypes: z
            .array(
                z.enum(["asset", "liability", "income", "expense", "equity"]),
            )
            .optional(),
        amountCurrency: id.optional(),
        transactionType: z
            .enum([
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
                "currency_exchange",
                "topup",
                "split",
            ])
            .optional(),
        derivedOnly: z.boolean().optional(),
        accountIds: z.array(id).optional(),
        relatedAccountIds: z.array(id).optional(),
        tagIds: z.array(id).optional(),
        excludeTagIds: z.array(id).optional(),
        creatorIds: z.array(z.string()).optional(),
        comment: z.string().optional(),
        minAmountNumber: z.number().finite().nonnegative().optional(),
        maxAmountNumber: z.number().finite().nonnegative().optional(),
        assetUsage: z.enum(["ordinary", "prepaid", "fixed_asset"]).optional(),
        depreciationStatus: z.enum(["in_use", "fully_depreciated"]).optional(),
    })
    .strict() satisfies z.ZodType<Omit<StatisticsFilter, "start" | "end">>;

/** 保存相对周／月／年，重新打开时仍跟随当前日期；自定义日期保存绝对边界。 */
export const statisticsViewSchema = z
    .object({
        id,
        name: z.string().trim().min(1),
        view: z.enum(["cash", "balance", "depreciation", "entries"]),
        focus: z.number().int().min(0).max(2),
        balanceMode: z.enum(["balance", "changes"]),
        filter: filterSchema,
        period: z
            .object({
                mode: z.enum(["weekly", "monthly", "yearly", "custom"]),
                offset: z.number().int().safe().nonnegative(),
                start: timestamp.optional(),
                end: timestamp.optional(),
            })
            .strict()
            .refine(
                (period) =>
                    period.start === undefined ||
                    period.end === undefined ||
                    period.start <= period.end,
                "Invalid statistics date range",
            ),
    })
    .strict();
export type SavedStatisticsView = z.infer<typeof statisticsViewSchema>;
export type StatisticsViewSnapshot = Omit<SavedStatisticsView, "id" | "name">;

export const statisticsViewsSchema = z
    .array(statisticsViewSchema)
    .superRefine((views, context) => {
        const ids = new Set<string>();
        for (const [index, view] of views.entries()) {
            if (ids.has(view.id))
                context.addIssue({
                    code: "custom",
                    path: [index, "id"],
                    message: "Duplicate statistics view ID",
                });
            ids.add(view.id);
        }
    });
