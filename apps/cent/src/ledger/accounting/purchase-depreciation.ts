import { parseZonedDateTime, zonedDate } from "../../utils/time";
import { createAccount } from "./account";
import { assertAmount, sumAmounts } from "./amount";
import { type AccountingData, validateAccountingData } from "./backup";
import { getEntryAmount } from "./entry-amount";
import {
    getTransactionAmountInRange,
    validateTransactionTimeRange,
} from "./time-range";
import type { Account, Transaction } from "./types";

/** 仅处理日历日期，月底按目标月份最后一天截断，不依赖设备时区。 */
export function resolvePurchaseEndDate(date: string, months: number): string {
    if (!Number.isSafeInteger(months) || months <= 0)
        throw new Error("Expected a positive month count");
    const time = parseZonedDateTime(`${date}T00:00`, "UTC");
    const end = zonedDate(time, "UTC")
        .add(months, "month")
        .format("YYYY-MM-DD");
    parseZonedDateTime(end, "UTC");
    return end;
}

export interface PurchaseDepreciationInput {
    /** 从购买发生时刻生效，按自然日分摊，结束为排他边界。 */
    startTime?: number;
    endTime: number;
    residualValue: number;
    expenseAccountId?: string;
}

/** 物品由购买交易识别，同一资产账户允许多次购入，不通过账户查找某件物品。 */
export function getPurchaseAsset(
    purchase: Transaction,
    accounts: readonly Account[],
) {
    if (
        purchase.type !== "asset_purchase" ||
        purchase.endTime !== undefined ||
        purchase.entries.length !== 2 ||
        purchase.exchange
    )
        return undefined;
    const positive = purchase.entries.find(
        (entry) => getEntryAmount(entry) > 0,
    );
    const negative = purchase.entries.find(
        (entry) => getEntryAmount(entry) < 0,
    );
    const asset = accounts.find(
        (account) => account.id === positive?.accountId,
    );
    const payment = accounts.find(
        (account) => account.id === negative?.accountId,
    );
    if (
        !positive ||
        !negative ||
        asset?.type !== "asset" ||
        !payment ||
        !["asset", "liability"].includes(payment.type) ||
        asset.id === payment.id ||
        asset.currency !== payment.currency ||
        positive.currency ||
        negative.currency
    )
        return undefined;
    return { asset, payment, cost: getEntryAmount(positive) };
}

export function getPurchaseDepreciation(
    purchaseId: string,
    transactions: readonly Transaction[],
) {
    return transactions.find(
        (transaction) =>
            transaction.type === "depreciation" &&
            transaction.parentTransactionId === purchaseId,
    );
}

/** 期间及总折旧额就是规则；预计残值从父交易成本减去子交易总额推导，不保存重复字段。 */
export function getPurchaseDepreciationState(
    purchase: Transaction,
    accounts: readonly Account[],
    transactions: readonly Transaction[],
    asOf: number,
    timeZone?: string,
) {
    const item = getPurchaseAsset(purchase, accounts);
    const child = getPurchaseDepreciation(purchase.id, transactions);
    if (!item || !child || child.endTime === undefined) return undefined;
    const total = -sumAmounts(
        child.entries
            .filter((entry) => entry.accountId === item.asset.id)
            .map(getEntryAmount),
    );
    const depreciation = getTransactionAmountInRange(
        child,
        total,
        0,
        asOf + 1,
        timeZone,
    );
    return {
        ...item,
        purchase,
        child,
        total,
        depreciation,
        residualValue: item.cost - total,
        carryingValue: item.cost - depreciation,
        status:
            depreciation >= total
                ? ("fully_depreciated" as const)
                : ("in_use" as const),
    };
}

/** 自动子交易不得成为独立根记录，必须与其购买成本、账户和期间一致。 */
export function validatePurchaseDepreciation(
    transactions: readonly Transaction[],
    accounts: readonly Account[],
) {
    const byId = new Map(transactions.map((item) => [item.id, item]));
    const owners = new Set<string>();
    for (const child of transactions) {
        if (child.type !== "depreciation") continue;
        const parent =
            child.parentTransactionId && byId.get(child.parentTransactionId);
        const purchase = parent && getPurchaseAsset(parent, accounts);
        const credit =
            purchase &&
            child.entries.find(
                (entry) => entry.accountId === purchase.asset.id,
            );
        const expense = child.entries.find(
            (entry) =>
                accounts.find((account) => account.id === entry.accountId)
                    ?.type === "expense",
        );
        if (
            !parent ||
            !purchase ||
            child.endTime === undefined ||
            child.time < parent.time ||
            child.exchange ||
            child.entries.length !== 2 ||
            child.entries.some((entry) => entry.currency) ||
            !credit ||
            !expense ||
            credit.amount >= 0 ||
            expense.amount <= 0 ||
            expense.amount !== -credit.amount ||
            expense.amount > purchase.cost ||
            child.currency !== purchase.asset.currency ||
            owners.has(parent.id) ||
            child.children?.length
        )
            throw new Error("Invalid purchase depreciation child");
        owners.add(parent.id);
    }
}

/** 购买和唯一的线性区间子交易一起保存；编辑保留子 ID，关闭折旧只移除该自动子交易。 */
export function saveDepreciatingPurchase(
    data: AccountingData,
    purchase: Transaction,
    input: PurchaseDepreciationInput | undefined,
    now: number,
    generateId: () => string,
    expenseName: string,
): AccountingData {
    const oldChild = getPurchaseDepreciation(purchase.id, data.transactions);
    const removed = new Set([purchase.id, ...(oldChild ? [oldChild.id] : [])]);
    let accounts = data.accounts;
    const transactions = data.transactions.filter(
        (transaction) => !removed.has(transaction.id),
    );
    if (input) {
        const item = getPurchaseAsset(purchase, accounts);
        if (!item || item.asset.archived || item.payment.archived)
            throw new Error(
                "Depreciation requires a two-account asset purchase",
            );
        assertAmount(input.residualValue);
        if (input.residualValue < 0 || input.residualValue >= item.cost)
            throw new Error("Residual value must be less than purchase cost");
        const time = input.startTime ?? purchase.time;
        validateTransactionTimeRange({ time, endTime: input.endTime });
        if (time < purchase.time)
            throw new Error("Depreciation must start at or after purchase");
        let expense = input.expenseAccountId
            ? accounts.find((account) => account.id === input.expenseAccountId)
            : (accounts.find(
                  (account) =>
                      account.type === "expense" &&
                      (account.subtype === "depreciation" ||
                          account.presetKey === "template:depreciation") &&
                      account.currency === item.asset.currency &&
                      !account.archived,
              ) ??
              accounts.find(
                  (account) =>
                      account.type === "expense" &&
                      account.name === expenseName &&
                      account.currency === item.asset.currency &&
                      !account.archived,
              ));
        if (
            input.expenseAccountId &&
            (!expense ||
                expense.type !== "expense" ||
                expense.currency !== item.asset.currency ||
                expense.archived)
        )
            throw new Error("Invalid depreciation expense account");
        if (!expense) {
            expense = createAccount(
                {
                    id: generateId(),
                    name: expenseName,
                    type: "expense",
                    subtype: "depreciation",
                    currency: item.asset.currency,
                },
                accounts,
                now,
            );
            accounts = [...accounts, expense];
        }
        const amount = item.cost - input.residualValue;
        const child: Transaction = {
            id: oldChild?.id ?? generateId(),
            type: "depreciation",
            parentTransactionId: purchase.id,
            time,
            endTime: input.endTime,
            currency: item.asset.currency,
            creatorId: purchase.creatorId,
            tagIds: purchase.tagIds ? [...purchase.tagIds] : undefined,
            entries: [
                { accountId: expense.id, amount },
                { accountId: item.asset.id, amount: -amount },
            ],
            createdAt: oldChild?.createdAt ?? now,
            updatedAt: Math.max(now, oldChild?.updatedAt ?? now),
        };
        transactions.push(child);
    }
    transactions.push(purchase);
    return validateAccountingData({ ...data, accounts, transactions }, now);
}
