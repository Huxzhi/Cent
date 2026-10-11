import type { TransactionType } from "./types";

type ListRule = {
    amount: "equity" | "receipt" | "payment" | "borrowing" | "repayment";
    neutral: boolean;
    arrow: "" | "→" | "↔";
    showPlus: boolean;
    titleKey: string;
    supplement: "native" | "received";
};

const defaultRule: ListRule = {
    amount: "equity",
    neutral: false,
    arrow: "",
    showPlus: true,
    titleKey: "accounting-equity-change-help",
    supplement: "native",
};
const rules: Partial<Record<TransactionType, Partial<ListRule>>> = {
    transfer: {
        amount: "receipt",
        neutral: true,
        arrow: "↔",
        showPlus: false,
        titleKey: "accounting-transfer-amount",
    },
    topup: {
        amount: "payment",
        neutral: true,
        arrow: "→",
        titleKey: "accounting-topup-principal",
        supplement: "received",
    },
    currency_exchange: {
        neutral: true,
        titleKey: "accounting-exchange-principal",
    },
    asset_purchase: {
        amount: "payment",
        neutral: true,
        arrow: "→",
        titleKey: "accounting-purchase-payment",
    },
    liability_borrowing: {
        amount: "borrowing",
        neutral: true,
        arrow: "→",
        titleKey: "accounting-borrowing-principal",
    },
    liability_payment: {
        amount: "repayment",
        neutral: true,
        arrow: "→",
        titleKey: "accounting-repayment-principal",
    },
};

/** type 选择展示用途；金额和账户方向仍由分录提供。 */
export function getTransactionListRule(type: TransactionType): ListRule {
    return { ...defaultRule, ...rules[type] };
}
