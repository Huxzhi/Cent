import type { CurrencyCostReplay } from "./currency-cost";
import { getCurrencyExchangeAmounts } from "./currency-exchange";
import { getEntryAmount, getEntryCurrency } from "./entry-amount";
import {
    getCurrencyExchangeListAmounts,
    getTransactionListAmountThrough,
    type TransactionListAmount,
} from "./list-amount";
import { getTransactionListRule } from "./list-rules";
import {
    getTransactionDescription,
    getTransactionPresentation,
} from "./presentation";
import { projectTransactionThrough } from "./time-range";
import type { Account, Transaction } from "./types";

export type ListAmountTone = "neutral" | "expense" | "income" | "default";
export type ListAmountPresentation = TransactionListAmount & {
    tone: ListAmountTone;
    arrow: "" | "→" | "↔";
    showPlus: boolean;
    titleKey: string;
};
type NativeAmount = { amount: number; currency: string };
type Supplement = { labelKey: string; amounts: NativeAmount[] };
export type TransactionListContext = {
    accounts: readonly Account[];
    through: number;
    baseCurrency: string;
    displayCurrency?: string;
    valueRate?: (from: string, to: string) => number | undefined;
    costLedger?: CurrencyCostReplay;
    timeZone?: string;
};

function describeAmount(
    amount: TransactionListAmount,
    rule: ReturnType<typeof getTransactionListRule>,
    titleKey = rule.titleKey,
): ListAmountPresentation {
    return {
        ...amount,
        tone:
            rule.neutral || amount.amount === undefined
                ? "neutral"
                : amount.amount < 0
                  ? "expense"
                  : amount.amount > 0
                    ? "income"
                    : "default",
        arrow: rule.arrow,
        showPlus: rule.showPlus,
        titleKey:
            amount.amount === undefined
                ? "accounting-rate-missing"
                : amount.estimate
                  ? "accounting-base-display-help"
                  : titleKey,
    };
}

/** 原币数量仅来自保存的分录；不读取成本或展示汇率。 */
function getSupplement(
    transaction: Transaction,
    context: TransactionListContext,
): Supplement | undefined {
    const { accounts, through, baseCurrency, timeZone } = context;
    const rule = getTransactionListRule(transaction.type);
    try {
        const snapshot =
            transaction.endTime === undefined
                ? transaction
                : projectTransactionThrough(transaction, through, timeZone);
        if (!snapshot) return undefined;
        let amounts: NativeAmount[];
        if (rule.supplement === "received") {
            amounts = snapshot.entries.flatMap((entry) => {
                const account = accounts.find(
                    (item) => item.id === entry.accountId,
                );
                return account?.type === "asset" && getEntryAmount(entry) > 0
                    ? [
                          {
                              amount: getEntryAmount(entry),
                              currency: getEntryCurrency(entry, account),
                          },
                      ]
                    : [];
            });
        } else {
            const native = getTransactionListAmountThrough(
                transaction,
                accounts,
                through,
                undefined,
                undefined,
                undefined,
                timeZone,
            );
            amounts =
                native.amount !== undefined && native.currency !== baseCurrency
                    ? [{ amount: native.amount, currency: native.currency }]
                    : [];
            const destination = accounts.find(
                (account) => account.id === transaction.exchange?.toAccountId,
            );
            if (
                transaction.exchange &&
                destination &&
                destination.currency !== baseCurrency &&
                destination.currency !== native.currency
            )
                amounts.push({
                    amount: getCurrencyExchangeAmounts(snapshot).received,
                    currency: destination.currency,
                });
        }
        return amounts.length
            ? {
                  labelKey:
                      rule.supplement === "received"
                          ? "accounting-exchange-received"
                          : "accounting-original-amount",
                  amounts,
              }
            : undefined;
    } catch {
        return undefined;
    }
}

/** 主条目与子条目共用展示数据，不改写交易或参与账务统计。 */
export function getTransactionListPresentation(
    transaction: Transaction,
    context: TransactionListContext,
    parent?: Transaction,
) {
    const {
        accounts,
        through,
        displayCurrency,
        valueRate,
        costLedger,
        timeZone,
    } = context;
    const rule = getTransactionListRule(transaction.type);
    const readAmount = (end: number) => {
        try {
            return getTransactionListAmountThrough(
                transaction,
                accounts,
                end,
                displayCurrency,
                valueRate,
                costLedger,
                timeZone,
            );
        } catch {
            return {
                amount: undefined,
                currency: displayCurrency ?? transaction.currency,
                estimate: false,
                receipt: false,
            };
        }
    };
    const change = readAmount(through);
    const exchangeRows =
        transaction.exchange &&
        ["topup", "currency_exchange"].includes(transaction.type)
            ? getCurrencyExchangeListAmounts(
                  transaction,
                  accounts,
                  displayCurrency,
                  valueRate,
                  costLedger,
              )
            : undefined;
    const fee = exchangeRows?.fee;
    const source = accounts.find(
        (account) => account.id === transaction.exchange?.fromAccountId,
    );
    const feeAccount = accounts.find(
        (account) => account.id === transaction.exchange?.feeAccountId,
    );
    const labelKey = fee
        ? transaction.type === "topup"
            ? "accounting-topup-principal"
            : "accounting-exchange-principal"
        : `accounting-transaction-type-${transaction.type.replaceAll("_", "-")}`;
    return {
        account: getTransactionPresentation(transaction, accounts).account,
        labelKey,
        description: getTransactionDescription(transaction, parent),
        related: !!transaction.parentTransactionId,
        amount: describeAmount(
            change,
            rule,
            transaction.type === "currency_exchange" && change.receipt
                ? "accounting-exchange-received"
                : rule.titleKey,
        ),
        supplement: getSupplement(transaction, context),
        period:
            transaction.endTime === undefined
                ? undefined
                : {
                      start: transaction.time,
                      end: transaction.endTime,
                      depreciation: transaction.type === "depreciation",
                      endingAmount:
                          transaction.type === "depreciation"
                              ? describeAmount(
                                    readAmount(transaction.endTime),
                                    rule,
                                )
                              : undefined,
                  },
        fee:
            fee && source && feeAccount
                ? {
                      source,
                      account: feeAccount,
                      labelKey:
                          transaction.type === "topup"
                              ? "accounting-topup-fee-row"
                              : "accounting-exchange-fee-row",
                      amount: describeAmount(
                          fee,
                          getTransactionListRule("expense"),
                      ),
                      supplement:
                          source.currency === context.baseCurrency
                              ? undefined
                              : {
                                    labelKey: "accounting-original-amount",
                                    amounts: [
                                        {
                                            amount:
                                                -getCurrencyExchangeAmounts(
                                                    transaction,
                                                ).fee,
                                            currency: source.currency,
                                        },
                                    ],
                                },
                  }
                : undefined,
    };
}
export type TransactionListPresentation = ReturnType<
    typeof getTransactionListPresentation
>;
