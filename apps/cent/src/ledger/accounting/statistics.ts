import { addZonedDays, parseZonedDateTime, zonedDate } from "../../utils/time";
import { getAccountingHistoryThrough } from "./accounting-history";
import { amountToNumber, sumAmounts } from "./amount";
import { calculateAverageCost } from "./average-cost";
import type { AccountingData } from "./backup";
import {
    type CurrencyCostBalance,
    type CurrencyCostReplay,
    replayCurrencyCosts,
} from "./currency-cost";
import { getCurrencyExpenseCategory } from "./currency-expense";
import { getEntryAmount } from "./entry-amount";
import {
    convertDisplayAmount,
    getIncomeExpenseEntryDisplayAmount,
} from "./presentation";
import {
    getPurchaseAsset,
    getPurchaseDepreciationState,
} from "./purchase-depreciation";
import {
    getTransactionAmountInRange,
    matchesTransactionDateRange,
} from "./time-range";
import type { Account, AccountType, Transaction } from "./types";
import { getAccountValuationRows, getBalanceValuationRows } from "./valuation";

export interface StatisticsFilter {
    start: number;
    end: number;
    accountId?: string;
    relatedAccountId?: string;
    tagId?: string;
    creatorId?: string;
    transactionType?: Transaction["type"];
    accountTypes?: AccountType[];
    /** 未指定时直接分析 entry.amount；指定时仅分析该币种的原币金额。 */
    amountCurrency?: string;
    derivedOnly?: boolean;
    /** 多选精确账户 ID；层级选择器负责展开子账户，单个 accountId 用于图表下钻。 */
    accountIds?: string[];
    relatedAccountIds?: string[];
    tagIds?: string[];
    excludeTagIds?: string[];
    creatorIds?: string[];
    comment?: string;
    minAmountNumber?: number;
    maxAmountNumber?: number;
    assetUsage?: StatisticsAssetUsage;
    depreciationStatus?: StatisticsDepreciationStatus;
}
export type StatisticsAssetUsage = "ordinary" | "prepaid" | "fixed_asset";
export type StatisticsDepreciationStatus = "in_use" | "fully_depreciated";

/** 账户用途仅用于分组；折旧金额来自购买交易的区间子交易。 */
export function getStatisticsAssetUsage(
    account: Account,
): StatisticsAssetUsage {
    if (account.subtype === "subscription") return "fixed_asset";
    return account.subtype === "prepaid" || account.subtype === "fixed_asset"
        ? account.subtype
        : "ordinary";
}

export interface StatisticsLine {
    transaction: Transaction;
    accountId: string;
    nativeAccountId: string;
    type: AccountType;
    amount: number;
    purchaseId?: string;
}
export interface StatisticsAccountRow {
    account: Account;
    amount: number;
    direct: boolean;
    expandable: boolean;
}
export type StatisticsValueRate = (
    from: string,
    to: string,
) => number | undefined;

/** 账户独立记账；父账户只在查询时包含任意深度的后代。 */
export function getStatisticsAccountIds(
    accounts: readonly Account[],
    id: string,
): Set<string> {
    const ids = new Set([id]);
    let changed = true;
    while (changed) {
        changed = false;
        for (const account of accounts)
            if (
                account.parentId &&
                ids.has(account.parentId) &&
                !ids.has(account.id)
            ) {
                ids.add(account.id);
                changed = true;
            }
    }
    return ids;
}

export function matchesStatisticsTransaction(
    transaction: Transaction,
    filter: StatisticsFilter,
    accounts: readonly Account[],
) {
    const keyword = filter.comment?.trim().toLocaleLowerCase();
    if (
        keyword &&
        !transaction.description?.toLocaleLowerCase().includes(keyword)
    )
        return false;
    if (
        filter.tagIds?.length &&
        !filter.tagIds.some((id) => transaction.tagIds?.includes(id))
    )
        return false;
    if (filter.excludeTagIds?.some((id) => transaction.tagIds?.includes(id)))
        return false;
    if (
        filter.creatorIds &&
        !filter.creatorIds.includes(String(transaction.creatorId ?? ""))
    )
        return false;
    if (
        filter.relatedAccountIds &&
        !transaction.entries.some((entry) =>
            filter.relatedAccountIds?.includes(entry.accountId),
        )
    )
        return false;
    if (filter.tagId && !transaction.tagIds?.includes(filter.tagId))
        return false;
    if (
        filter.creatorId &&
        String(transaction.creatorId ?? "") !== filter.creatorId
    )
        return false;
    if (filter.transactionType && transaction.type !== filter.transactionType)
        return false;
    if (filter.relatedAccountId) {
        const ids = getStatisticsAccountIds(accounts, filter.relatedAccountId);
        if (!transaction.entries.some((entry) => ids.has(entry.accountId)))
            return false;
    }
    return true;
}

/** 条目条件只筛选报告结果；账户范围与日期不截断历史成本重放。 */
export function hasStatisticsTransactionFilters(
    filter: Partial<StatisticsFilter>,
) {
    return !!(
        filter.comment?.trim() ||
        filter.transactionType ||
        filter.relatedAccountId ||
        filter.relatedAccountIds !== undefined ||
        filter.creatorId ||
        filter.creatorIds !== undefined ||
        filter.tagId ||
        filter.tagIds?.length ||
        filter.excludeTagIds?.length ||
        filter.minAmountNumber !== undefined ||
        filter.maxAmountNumber !== undefined
    );
}

export function matchesStatisticsAmount(
    amount: number,
    filter: Partial<StatisticsFilter>,
) {
    const magnitude = Math.abs(amountToNumber(amount));
    return (
        (filter.minAmountNumber === undefined ||
            magnitude >= filter.minAmountNumber) &&
        (filter.maxAmountNumber === undefined ||
            magnitude <= filter.maxAmountNumber)
    );
}

/** 折旧可以由购入记录提供筛选元数据，独立备注仍优先使用。 */
export function statisticsFilterSource(
    transaction: Transaction,
    purchase?: Transaction,
    filter?: Partial<StatisticsFilter>,
): Transaction {
    if (!purchase) return transaction;
    return {
        ...transaction,
        description: transaction.description || purchase.description,
        creatorId: transaction.creatorId ?? purchase.creatorId,
        tagIds: transaction.tagIds ?? purchase.tagIds,
        type:
            filter?.transactionType === purchase.type
                ? purchase.type
                : transaction.type,
        entries: [...transaction.entries, ...purchase.entries],
    };
}

/** 完整历史用于余额与成本重放；期间过滤只能在重放之后进行。 */
export function getStatisticsHistory(data: AccountingData, asOf: number) {
    return getAccountingHistoryThrough(data, asOf);
}

/** 每笔物品用其购买成本换算折旧，避免共用账户的不同购入汇率互相影响。 */
function purchaseDepreciationAmount(
    purchase: Transaction,
    amount: number,
    data: AccountingData,
    currency: string,
    valueRate: StatisticsValueRate,
    history: CurrencyCostReplay,
) {
    const item = getPurchaseAsset(purchase, data.accounts);
    if (!item) throw new Error("Depreciation purchase missing");
    if (item.asset.currency === currency || !amount) return amount;
    const cost = history.changes.get(purchase.id)?.get(item.asset.id);
    const costCurrency = history.accounts.find(
        (account) => account.id === item.asset.id,
    )?.costCurrency;
    if (cost !== undefined && cost >= 0 && costCurrency === currency)
        return calculateAverageCost(cost, item.cost, amount);
    const rate = valueRate(item.asset.currency, currency);
    if (rate === undefined) throw new Error("Missing display conversion basis");
    return convertDisplayAmount(amount, rate);
}

/** 收支按分录筛选；期间子交易按自然日分摊，不向数据库写入每日记录。 */
export function getStatisticsLines(
    data: AccountingData,
    filter: StatisticsFilter,
    currency: string,
    valueRate: StatisticsValueRate,
    asOf: number,
): StatisticsLine[] {
    const end = Math.min(filter.end, asOf);
    if (filter.start > end) return [];
    const history = replayCurrencyCosts(
        data.accounts,
        getStatisticsHistory(data, asOf),
        undefined,
        currency,
    );
    const byId = new Map(data.accounts.map((account) => [account.id, account]));
    const selected = filter.accountId
        ? getStatisticsAccountIds(data.accounts, filter.accountId)
        : undefined;
    const lines: StatisticsLine[] = [];
    const append = (
        transaction: Transaction,
        allocation?: { source: Transaction; start: number; end: number },
        purchase?: Transaction,
    ) => {
        if (
            transaction.time < filter.start ||
            transaction.time > end ||
            !matchesStatisticsTransaction(
                statisticsFilterSource(
                    transaction,
                    filter.derivedOnly ? purchase : undefined,
                    filter,
                ),
                filter,
                data.accounts,
            )
        )
            return;
        for (const entry of transaction.entries) {
            const account = byId.get(entry.accountId);
            if (
                !account ||
                (account.type !== "expense" && account.type !== "income")
            )
                continue;
            const category = getCurrencyExpenseCategory(account, data.accounts);
            if (
                filter.accountIds &&
                !filter.accountIds.includes(category.id) &&
                !filter.accountIds.includes(account.id)
            )
                continue;
            if (
                selected &&
                !selected.has(category.id) &&
                !selected.has(account.id)
            )
                continue;
            let amount = purchase
                ? purchaseDepreciationAmount(
                      purchase,
                      getEntryAmount(entry),
                      data,
                      currency,
                      valueRate,
                      history,
                  )
                : getIncomeExpenseEntryDisplayAmount(
                      entry,
                      account,
                      transaction,
                      data.accounts,
                      currency,
                      valueRate,
                      history,
                  );
            if (allocation && purchase) {
                // 先分摊原币累计金额再换算，两端差额保证每日之和与资产成本扣减一致。
                const convertedThrough = (until: number) =>
                    purchaseDepreciationAmount(
                        purchase,
                        getTransactionAmountInRange(
                            allocation.source,
                            getEntryAmount(entry),
                            allocation.source.time,
                            until,
                            data.timeZone,
                        ),
                        data,
                        currency,
                        valueRate,
                        history,
                    );
                amount = sumAmounts([
                    convertedThrough(allocation.end),
                    -convertedThrough(allocation.start),
                ]);
            } else if (allocation)
                amount = getTransactionAmountInRange(
                    allocation.source,
                    amount,
                    allocation.start,
                    allocation.end,
                    data.timeZone,
                );
            if (!amount) continue;
            if (!matchesStatisticsAmount(amount, filter)) continue;
            lines.push({
                transaction,
                accountId: category.id,
                nativeAccountId: account.id,
                type: account.type,
                amount: account.type === "income" ? -amount : amount,
                ...(purchase ? { purchaseId: purchase.id } : {}),
            });
        }
    };
    for (const transaction of data.transactions) {
        const purchase =
            transaction.type === "depreciation"
                ? data.transactions.find(
                      (item) => item.id === transaction.parentTransactionId,
                  )
                : undefined;
        if (
            purchase &&
            filter.depreciationStatus &&
            getPurchaseDepreciationState(
                purchase,
                data.accounts,
                data.transactions,
                end,
                data.timeZone,
            )?.status !== filter.depreciationStatus
        )
            continue;
        if (transaction.endTime !== undefined) {
            if (filter.derivedOnly && !purchase) continue;
            const until = end + 1;
            if (!matchesTransactionDateRange(transaction, filter.start, until))
                continue;
            let day = zonedDate(
                Math.max(transaction.time, filter.start),
                data.timeZone,
            )
                .startOf("day")
                .valueOf();
            while (day < Math.min(transaction.endTime, until)) {
                const next = addZonedDays(day, 1, data.timeZone);
                const start = Math.max(day, transaction.time, filter.start);
                append(
                    { ...transaction, time: start },
                    {
                        source: transaction,
                        start,
                        end: Math.min(next, until),
                    },
                    purchase,
                );
                day = next;
            }
            continue;
        }
        if (!filter.derivedOnly) append(transaction);
    }
    return lines;
}

export function getStatisticsTotals(lines: readonly StatisticsLine[]) {
    const income = sumAmounts(
        lines
            .filter((line) => line.type === "income")
            .map((line) => line.amount),
    );
    const expense = sumAmounts(
        lines
            .filter((line) => line.type === "expense")
            .map((line) => line.amount),
    );
    return { income, expense, net: sumAmounts([income, -expense]) };
}

/** 每一层由互不重叠的账户组组成；父账户自身分录单独保留。 */
export function getStatisticsAccountGroups(
    accounts: readonly Account[],
    type: AccountType,
    parentId?: string,
) {
    const candidates = accounts.filter(
        (account) =>
            account.type === type &&
            getCurrencyExpenseCategory(account, accounts).id === account.id,
    );
    const children = (id: string) =>
        candidates.filter((account) => account.parentId === id);
    const roots = candidates.filter(
        (account) =>
            !account.parentId ||
            !candidates.some((parent) => parent.id === account.parentId),
    );
    const groups = parentId
        ? [
              {
                  account: candidates.find(
                      (account) => account.id === parentId,
                  ),
                  direct: true,
              },
              ...children(parentId).map((account) => ({
                  account,
                  direct: false,
              })),
          ]
        : roots.flatMap((account) =>
              account.presetKey === `starter:${type}` &&
              children(account.id).length
                  ? [
                        { account, direct: true },
                        ...children(account.id).map((child) => ({
                            account: child,
                            direct: false,
                        })),
                    ]
                  : [{ account, direct: false }],
          );
    return groups.flatMap(({ account, direct }) =>
        account
            ? [
                  {
                      account,
                      direct,
                      expandable: !direct && children(account.id).length > 0,
                      ids: direct
                          ? new Set([account.id])
                          : getStatisticsAccountIds(accounts, account.id),
                  },
              ]
            : [],
    );
}

export function getStatisticsAccountRows(
    lines: readonly StatisticsLine[],
    accounts: readonly Account[],
    type: AccountType,
    parentId?: string,
): StatisticsAccountRow[] {
    return getStatisticsAccountGroups(accounts, type, parentId)
        .map(({ ids, ...row }) => ({
            ...row,
            amount: sumAmounts(
                lines
                    .filter(
                        (line) => line.type === type && ids.has(line.accountId),
                    )
                    .map((line) => line.amount),
            ),
        }))
        .filter((row) => row.amount !== 0)
        .sort((a, b) => b.amount - a.amount);
}

export interface StatisticsBucket {
    time: number;
    end: number;
}
export function getStatisticsBuckets(
    start: number,
    end: number,
    monthly: boolean,
    timeZone?: string,
): StatisticsBucket[] {
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end)
        return [];
    let date = zonedDate(start, timeZone)
        .startOf(monthly ? "month" : "day")
        .valueOf();
    const result: StatisticsBucket[] = [];
    while (date <= end) {
        const time = date;
        date = monthly
            ? parseZonedDateTime(
                  zonedDate(date, timeZone)
                      .add(1, "month")
                      .format("YYYY-MM-01"),
                  timeZone,
              )
            : addZonedDays(date, 1, timeZone);
        result.push({ time, end: Math.min(date - 1, end) });
    }
    return result;
}

export function getStatisticsTrend(
    lines: readonly StatisticsLine[],
    buckets: readonly StatisticsBucket[],
) {
    return buckets.map((bucket) => ({
        ...bucket,
        ...getStatisticsTotals(
            lines.filter(
                (line) =>
                    line.transaction.time >= bucket.time &&
                    line.transaction.time <= bucket.end,
            ),
        ),
    }));
}

/** 余额使用截至当日的完整历史；交易日期/标签筛选不能截断余额历史。 */
export function getStatisticsBalances(
    data: AccountingData,
    currency: string,
    valueRate: StatisticsValueRate,
    asOf: number,
    accountId?: string,
    assetUsage?: StatisticsAssetUsage,
) {
    const selected = accountId
        ? getStatisticsAccountIds(data.accounts, accountId)
        : undefined;
    const rows = getAccountValuationRows(
        data.accounts,
        getStatisticsHistory(data, asOf),
        (from) => (from === currency ? 1 : valueRate(from, currency)),
        currency,
    ).filter(
        (row) =>
            (!selected || selected.has(row.account.id)) &&
            (!assetUsage ||
                (row.account.type === "asset" &&
                    getStatisticsAssetUsage(row.account) === assetUsage)),
    );
    if (rows.some((row) => row.amount === undefined))
        throw new Error("Missing display conversion basis");
    const asset = sumAmounts(
        rows
            .filter((row) => row.account.type === "asset")
            .map((row) => row.amount ?? 0),
    );
    const liability = sumAmounts(
        rows
            .filter((row) => row.account.type === "liability")
            .map((row) => row.amount ?? 0),
    );
    return { asset, liability, net: sumAmounts([asset, -liability]), rows };
}

export function getStatisticsBalanceRows(
    balances: ReturnType<typeof getStatisticsBalances>,
    accounts: readonly Account[],
    type: "asset" | "liability",
    parentId?: string,
): StatisticsAccountRow[] {
    return getStatisticsAccountGroups(accounts, type, parentId)
        .map(({ ids, ...row }) => ({
            ...row,
            amount: sumAmounts(
                balances.rows
                    .filter((item) => ids.has(item.account.id))
                    .map((item) => item.amount ?? 0),
            ),
        }))
        .filter((row) => row.amount !== 0)
        .sort((a, b) => b.amount - a.amount);
}

export interface StatisticsBalanceLine {
    transaction: Transaction;
    amount: number;
    time: number;
}
export interface StatisticsBalanceActivity {
    opening: number;
    increase: number;
    decrease: number;
    closing: number;
    lines: StatisticsBalanceLine[];
    /** 各独立账户的命中期间变动，保留全历史成本基础。 */
    accountChanges: Map<string, number>;
}

/** 每笔交易先合并所选账户的变动。组内转账抵消；期初加期间净变动严格等于期末。 */
export function getStatisticsBalanceActivity(
    data: AccountingData,
    start: number,
    end: number,
    currency: string,
    valueRate: StatisticsValueRate,
    metric: "asset" | "liability" | "net",
    accountId?: string,
    direct = false,
    assetUsage?: StatisticsAssetUsage,
    filter?: StatisticsFilter,
    transactionIds?: ReadonlySet<string>,
): StatisticsBalanceActivity {
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end)
        throw new Error("Invalid statistics range");
    const ids = accountId
        ? direct
            ? new Set([accountId])
            : getStatisticsAccountIds(data.accounts, accountId)
        : undefined;
    const accounts = data.accounts.filter(
        (account) =>
            (account.type === "asset" || account.type === "liability") &&
            (metric === "net" || account.type === metric) &&
            (!ids || ids.has(account.id)) &&
            (!assetUsage ||
                account.type === "liability" ||
                getStatisticsAssetUsage(account) === assetUsage),
    );
    const history = replayCurrencyCosts(
        data.accounts,
        getAccountingHistoryThrough(data, end, start),
        undefined,
        currency,
    );
    const native = new Map<string, number>();
    const selectedAccounts = new Set(accounts.map((account) => account.id));
    const costs = new Map<string, CurrencyCostBalance>(
        history.accounts
            .filter((account) => account.costCurrency)
            .map((account) => [
                account.id,
                {
                    amount: 0,
                    bookAmount: 0,
                    costCurrency: account.costCurrency!,
                },
            ]),
    );
    const snapshot = () =>
        new Map(
            getBalanceValuationRows(
                data.accounts,
                costs,
                (account) =>
                    (native.get(account.id) ?? 0) *
                    (account.type === "liability" ? -1 : 1),
                (from) => (from === currency ? 1 : valueRate(from, currency)),
                currency,
            )
                .filter((row) => selectedAccounts.has(row.account.id))
                .map((row) => {
                    if (row.amount === undefined)
                        throw new Error("Missing display conversion basis");
                    const amount =
                        metric === "net" && row.account.type === "liability"
                            ? -row.amount
                            : row.amount;
                    return [row.account.id, amount] as const;
                }),
        );
    const total = (values: Map<string, number>) =>
        sumAmounts([...values.values()]);
    const activity: StatisticsBalanceActivity = {
        opening: 0,
        increase: 0,
        decrease: 0,
        closing: 0,
        lines: [],
        accountChanges: new Map(),
    };
    let started = false;
    let previous = new Map<string, number>();
    for (const transaction of [...history.transactions].sort(
        (a, b) =>
            a.time - b.time ||
            a.createdAt - b.createdAt ||
            (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )) {
        if (transaction.time >= start && !started) {
            previous = snapshot();
            activity.opening = activity.closing = total(previous);
            started = true;
        }
        const deltas = new Map<string, number>();
        for (const entry of transaction.entries)
            deltas.set(
                entry.accountId,
                sumAmounts([
                    deltas.get(entry.accountId) ?? 0,
                    getEntryAmount(entry),
                ]),
            );
        for (const [id, delta] of deltas) {
            native.set(id, sumAmounts([native.get(id) ?? 0, delta]));
            const cost = costs.get(id);
            if (!cost) continue;
            if (delta === 0 && !history.changes.get(transaction.id)?.has(id))
                continue;
            const amount = sumAmounts([cost.amount, delta]);
            const change = history.changes.get(transaction.id)?.get(id);
            costs.set(id, {
                ...cost,
                amount,
                bookAmount:
                    amount === 0
                        ? 0
                        : change === undefined || cost.bookAmount === undefined
                          ? undefined
                          : sumAmounts([cost.bookAmount, change]),
            });
        }
        if (!started) continue;
        const values = snapshot();
        const closing = total(values);
        const amount = sumAmounts([closing, -activity.closing]);
        const original =
            data.transactions.find((item) => item.id === transaction.id) ??
            transaction;
        const purchase = original.parentTransactionId
            ? data.transactions.find(
                  (item) => item.id === original.parentTransactionId,
              )
            : undefined;
        const matches = transactionIds
            ? transactionIds.has(original.id)
            : !filter ||
              (matchesStatisticsTransaction(
                  statisticsFilterSource(
                      original,
                      original.type === "depreciation" ? purchase : undefined,
                      filter,
                  ),
                  filter,
                  data.accounts,
              ) &&
                  matchesStatisticsAmount(amount, filter));
        if (matches)
            for (const [id, value] of values)
                activity.accountChanges.set(
                    id,
                    sumAmounts([
                        activity.accountChanges.get(id) ?? 0,
                        value,
                        -(previous.get(id) ?? 0),
                    ]),
                );
        const moved = [...values].some(
            ([id, value]) => value !== (previous.get(id) ?? 0),
        );
        if (matches && (amount || ((filter || transactionIds) && moved))) {
            activity.lines.push({
                transaction: original,
                amount,
                time: transaction.time,
            });
            if (amount > 0)
                activity.increase = sumAmounts([activity.increase, amount]);
            else activity.decrease = sumAmounts([activity.decrease, -amount]);
        }
        activity.closing = closing;
        previous = values;
    }
    if (!started) activity.opening = activity.closing = total(snapshot());
    return activity;
}

/** 三个指标共用按当前指标命中的交易集合，保持净资产变化＝资产变化－负债变化。 */
export function getStatisticsFilteredBalanceActivities(
    data: AccountingData,
    filter: StatisticsFilter,
    currency: string,
    valueRate: StatisticsValueRate,
    metric: "net" | "asset" | "liability",
    assetUsage?: StatisticsAssetUsage,
) {
    const selected = getStatisticsBalanceActivity(
        data,
        filter.start,
        filter.end,
        currency,
        valueRate,
        metric,
        filter.accountId,
        false,
        assetUsage,
        filter,
    );
    const ids = new Set(selected.lines.map((line) => line.transaction.id));
    return (["net", "asset", "liability"] as const).map((metric) =>
        getStatisticsBalanceActivity(
            data,
            filter.start,
            filter.end,
            currency,
            valueRate,
            metric,
            filter.accountId,
            false,
            assetUsage,
            undefined,
            ids,
        ),
    );
}

export function getStatisticsDepreciationState(
    data: AccountingData,
    currency: string,
    valueRate: StatisticsValueRate,
    asOf: number,
    assetId?: string,
    status?: StatisticsDepreciationStatus,
    statusAsOf = asOf,
) {
    const history = replayCurrencyCosts(
        data.accounts,
        data.transactions.filter((transaction) => transaction.time <= asOf),
        undefined,
        currency,
    );
    const selected = assetId
        ? getStatisticsAccountIds(data.accounts, assetId)
        : undefined;
    const purchases = data.transactions.flatMap((purchase) => {
        if (purchase.type !== "asset_purchase" || purchase.time > asOf)
            return [];
        const state = getPurchaseDepreciationState(
            purchase,
            data.accounts,
            data.transactions,
            asOf,
            data.timeZone,
        );
        if (
            !state ||
            (selected && !selected.has(state.asset.id)) ||
            (status &&
                getPurchaseDepreciationState(
                    purchase,
                    data.accounts,
                    data.transactions,
                    statusAsOf,
                    data.timeZone,
                )?.status !== status)
        )
            return [];
        const accumulated = purchaseDepreciationAmount(
            purchase,
            state.depreciation,
            data,
            currency,
            valueRate,
            history,
        );
        return [
            {
                id: purchase.id,
                purchase,
                asset: state.asset,
                accumulated,
                remaining: sumAmounts([
                    purchaseDepreciationAmount(
                        purchase,
                        state.cost,
                        data,
                        currency,
                        valueRate,
                        history,
                    ),
                    -accumulated,
                ]),
            },
        ];
    });
    return purchases;
}
