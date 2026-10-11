import { sumAmounts } from "./amount";
import { calculateAverageCost } from "./average-cost";
import type { CurrencyCostReplay } from "./currency-cost";
import {
    getCurrencyExchangeAmounts,
    getCurrencyExchangeRate,
} from "./currency-exchange";
import {
    getEntryAmount,
    getEntryCurrency,
    getEntryDisplayAmount,
} from "./entry-amount";
import { getTransactionEquityChange } from "./equity-change";
import { getTransactionListRule } from "./list-rules";
import { convertDisplayAmount } from "./presentation";
import { projectTransactionThrough } from "./time-range";
import type { Account, Transaction } from "./types";

export interface TransactionListAmount {
    amount: number | undefined;
    currency: string;
    estimate: boolean;
    receipt: boolean;
}

/** 区间条目展示截止已确认金额；详情与存储仍保留整个期间的总额。 */
export function getTransactionListAmountThrough(
    transaction: Transaction,
    accounts: readonly Account[],
    through: number,
    displayCurrency?: string,
    valueRate?: (from: string, to: string) => number | undefined,
    history?: CurrencyCostReplay,
    timeZone?: string,
): TransactionListAmount {
    if (transaction.endTime === undefined)
        return getTransactionListAmount(
            transaction,
            accounts,
            displayCurrency,
            valueRate,
            history,
        );
    const snapshot = projectTransactionThrough(transaction, through, timeZone);
    if (!snapshot)
        return {
            amount: 0,
            currency: displayCurrency ?? transaction.currency,
            estimate: false,
            receipt: false,
        };
    return getTransactionListAmount(
        snapshot,
        accounts,
        displayCurrency,
        valueRate,
        history,
    );
}

/** 本金与手续费只是同一交易的两行展示；换算后的舍入余数留在本金，避免重复扣款。 */
export function getCurrencyExchangeListAmounts(
    transaction: Transaction,
    accounts: readonly Account[],
    displayCurrency?: string,
    valueRate?: (from: string, to: string) => number | undefined,
    history?: CurrencyCostReplay,
): { principal: TransactionListAmount; fee?: TransactionListAmount } {
    const exchange = transaction.exchange;
    if (!exchange || !["currency_exchange", "topup"].includes(transaction.type))
        throw new Error("Missing currency exchange details");
    const from = accounts.find(
        (account) => account.id === exchange.fromAccountId,
    );
    const to = accounts.find((account) => account.id === exchange.toAccountId);
    if (!from || !to) throw new Error("Missing exchange account");
    const amounts = getCurrencyExchangeAmounts(transaction);
    const currency = displayCurrency ?? from.currency;
    let principal: number | undefined;
    let fee: number | undefined;
    let estimate = false;
    const receipt = transaction.type !== "topup" && currency === to.currency;
    if (receipt) {
        principal = amounts.received;
        fee = amounts.fee
            ? -convertDisplayAmount(
                  amounts.fee,
                  getCurrencyExchangeRate(transaction),
              )
            : 0;
    } else if (currency === from.currency) {
        principal = sumAmounts([-amounts.withdrawn, amounts.fee]);
        fee = -amounts.fee;
    } else if (transaction.type === "topup" && currency === to.currency) {
        // 充值始终表示付款方向；到账单位只用于换算，不改变金额方向。
        estimate = true;
        principal = -amounts.received;
        fee = amounts.fee
            ? -convertDisplayAmount(
                  amounts.fee,
                  getCurrencyExchangeRate(transaction),
              )
            : 0;
    } else {
        estimate = true;
        const costCurrency = history?.accounts.find(
            (account) => account.id === from.id,
        )?.costCurrency;
        const cost = history?.changes.get(transaction.id)?.get(from.id);
        let total: number | undefined;
        if (costCurrency === currency && cost !== undefined) {
            total = cost;
            fee = amounts.fee
                ? -calculateAverageCost(-cost, amounts.withdrawn, amounts.fee)
                : 0;
        } else {
            const rate = valueRate?.(from.currency, currency);
            if (rate !== undefined) {
                total = convertDisplayAmount(-amounts.withdrawn, rate);
                fee = amounts.fee
                    ? -convertDisplayAmount(amounts.fee, rate)
                    : 0;
            }
        }
        if (total !== undefined && fee !== undefined)
            principal = sumAmounts([total, -fee]);
    }
    return {
        principal: { amount: principal, currency, estimate, receipt },
        ...(amounts.fee > 0
            ? {
                  fee: {
                      amount: fee,
                      currency,
                      estimate: estimate || receipt,
                      receipt: false,
                  },
              }
            : {}),
    };
}

/** 列表统一展示币种；只派生预览，不修改账户或分录。缺少依据时不冒充本币。 */
export function getTransactionListAmount(
    transaction: Transaction,
    accounts: readonly Account[],
    displayCurrency?: string,
    valueRate?: (from: string, to: string) => number | undefined,
    history?: CurrencyCostReplay,
): TransactionListAmount {
    const rule = getTransactionListRule(transaction.type);
    if (
        transaction.exchange &&
        ["currency_exchange", "topup"].includes(transaction.type)
    ) {
        return getCurrencyExchangeListAmounts(
            transaction,
            accounts,
            displayCurrency,
            valueRate,
            history,
        ).principal;
    }
    if (rule.amount === "borrowing" || rule.amount === "repayment") {
        const direction = rule.amount === "borrowing" ? -1 : 1;
        const entries = transaction.entries.flatMap((entry) => {
            const account = accounts.find(
                (item) => item.id === entry.accountId,
            );
            return account?.type === "liability" &&
                Math.sign(getEntryAmount(entry)) === direction
                ? [{ entry, account }]
                : [];
        });
        if (!entries.length) throw new Error("Missing liability principal");
        const currency =
            displayCurrency ??
            getEntryCurrency(entries[0].entry, entries[0].account);
        const amounts = entries.map(({ entry, account }) => {
            const preview = getEntryDisplayAmount(entry, account, currency);
            if (preview !== undefined) return -preview;
            const rate = valueRate?.(
                getEntryCurrency(entry, account),
                currency,
            );
            return rate === undefined
                ? undefined
                : -convertDisplayAmount(getEntryAmount(entry), rate);
        });
        return {
            amount: amounts.every(
                (amount): amount is number => amount !== undefined,
            )
                ? sumAmounts(amounts)
                : undefined,
            currency,
            estimate: entries.some(
                ({ entry, account }) =>
                    getEntryCurrency(entry, account) !== currency,
            ),
            receipt: rule.amount === "borrowing",
        };
    }
    if (rule.amount === "receipt") {
        const currency = displayCurrency ?? transaction.currency;
        const destinations = accounts.filter(
            (account) =>
                account.type === "asset" &&
                transaction.entries.some(
                    (entry) =>
                        entry.accountId === account.id &&
                        getEntryAmount(entry) > 0,
                ),
        );
        if (!destinations.length)
            throw new Error("Missing transfer destination");
        const increases = destinations.map((account) => {
            const entries = transaction.entries.filter(
                (entry) =>
                    entry.accountId === account.id && getEntryAmount(entry) > 0,
            );
            const previews = entries.map((entry) =>
                getEntryDisplayAmount(entry, account, currency),
            );
            if (
                previews.every(
                    (amount): amount is number => amount !== undefined,
                )
            )
                return sumAmounts(previews);
            const costCurrency = history?.accounts.find(
                (item) => item.id === account.id,
            )?.costCurrency;
            const cost = history?.changes.get(transaction.id)?.get(account.id);
            if (
                costCurrency === currency &&
                cost !== undefined &&
                !transaction.entries.some(
                    (entry) =>
                        entry.accountId === account.id &&
                        getEntryAmount(entry) < 0,
                )
            )
                return cost;
            const converted = entries.map((entry) => {
                const rate = valueRate?.(
                    getEntryCurrency(entry, account),
                    currency,
                );
                return rate === undefined
                    ? undefined
                    : convertDisplayAmount(getEntryAmount(entry), rate);
            });
            return converted.every(
                (amount): amount is number => amount !== undefined,
            )
                ? sumAmounts(converted)
                : undefined;
        });
        return {
            amount: increases.every(
                (amount): amount is number => amount !== undefined,
            )
                ? sumAmounts(increases)
                : undefined,
            currency,
            estimate: destinations.some(
                (account) => account.currency !== currency,
            ),
            receipt: true,
        };
    }
    if (rule.amount === "payment") {
        // “第一个账户”指输入界面的付款方，不能依赖保存后的分录顺序。
        const source = transaction.entries.find(
            (entry) =>
                getEntryAmount(entry) < 0 &&
                accounts.some(
                    (account) =>
                        account.id === entry.accountId &&
                        ["asset", "liability"].includes(account.type),
                ),
        );
        const account = accounts.find((item) => item.id === source?.accountId);
        if (!source || !account) throw new Error("Missing payment source");
        const sourceCurrency = getEntryCurrency(source, account);
        const currency = displayCurrency ?? sourceCurrency;
        const preview = getEntryDisplayAmount(source, account, currency);
        const costCurrency = history?.accounts.find(
            (account) => account.id === source.accountId,
        )?.costCurrency;
        const cost = history?.changes
            .get(transaction.id)
            ?.get(source.accountId);
        const rate =
            currency === sourceCurrency
                ? 1
                : valueRate?.(sourceCurrency, currency);
        return {
            amount:
                preview ??
                (costCurrency === currency && cost !== undefined
                    ? cost
                    : rate === undefined
                      ? undefined
                      : convertDisplayAmount(getEntryAmount(source), rate)),
            currency,
            estimate: currency !== sourceCurrency,
            receipt: false,
        };
    }
    if (
        displayCurrency &&
        transaction.entries.some(
            (entry) => entry.currency?.base === displayCurrency,
        )
    ) {
        const previews = transaction.entries.flatMap((entry) => {
            const account = accounts.find(
                (item) => item.id === entry.accountId,
            );
            return account && ["asset", "liability"].includes(account.type)
                ? [getEntryDisplayAmount(entry, account, displayCurrency)]
                : [];
        });
        if (
            previews.length &&
            previews.every((amount): amount is number => amount !== undefined)
        )
            return {
                amount: sumAmounts(previews),
                currency: displayCurrency,
                estimate: true,
                receipt: false,
            };
    }
    const change = getTransactionEquityChange(
        transaction,
        accounts,
        displayCurrency,
        valueRate,
        history,
    );
    const currency = displayCurrency ?? change.currency;
    return {
        amount: change.currency === currency ? change.amount : undefined,
        currency,
        estimate:
            currency !== transaction.currency ||
            transaction.entries.some(
                (entry) => entry.currency?.base === currency,
            ),
        receipt: false,
    };
}
