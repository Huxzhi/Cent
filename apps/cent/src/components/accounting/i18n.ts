import { useStore } from "zustand";
import { useIntl } from "@/locale";
import type {
    Account,
    AccountType,
    Transaction,
} from "../../ledger/accounting";
import { getCurrencyExpenseCategory } from "../../ledger/accounting/currency-expense";
import { isCurrencyTradingGroup } from "../../ledger/accounting/currency-trading";
import { accountingStore } from "../../store/accounting";
import { getAccountLabelKey } from "./account-label";
import { currencyLabel } from "./shared";

export function useAccountingLabels() {
    const t = useIntl();
    const accounts = useStore(
        accountingStore,
        (state) => state.current?.data.accounts,
    );
    const types: AccountType[] = [
        "asset",
        "liability",
        "income",
        "expense",
        "equity",
    ];
    const accountTypes = Object.fromEntries(
        types.map((type) => [type, t(`accounting-type-${type}`)]),
    ) as Record<AccountType, string>;
    const accountTypeDescriptions = Object.fromEntries(
        types.map((type) => [type, t(`accounting-description-${type}`)]),
    ) as Record<AccountType, string>;
    const transactionTypes = Object.fromEntries(
        [
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
        ].map((type) => [
            type,
            t(`accounting-transaction-type-${type.replaceAll("_", "-")}`),
        ]),
    );
    const labelAccount = (account: Account) => {
        if (isCurrencyTradingGroup(account))
            return t("accounting-exchange-group");
        if (account.subtype === "currency_trading")
            return currencyLabel(account.currency);
        const category = getCurrencyExpenseCategory(account, accounts ?? []);
        const key = getAccountLabelKey(
            category.name === account.name ? category : account,
        );
        return key ? t(key) : account.name;
    };
    const labelAccountSubtype = (account: Account) => {
        if (isCurrencyTradingGroup(account))
            return t("accounting-account-system-group");
        const keys: Record<string, string> = {
            prepaid: "accounting-recharge-card",
            fixed_asset: "accounting-fixed-asset",
            subscription: "accounting-subscription-asset",
            credit_card: "accounting-credit-card",
            loan: "accounting-loan",
            payable: "accounting-payable",
            opening_balance: "accounting-opening-equity",
            depreciation: "accounting-depreciation-expense",
            currency_trading: "accounting-account-exchange-balancing",
        };
        return !account.subtype
            ? t("accounting-ordinary-account")
            : keys[account.subtype]
              ? t(keys[account.subtype])
              : t("accounting-account-custom-subtype", {
                    subtype: account.subtype,
                });
    };
    return {
        t,
        labelTransaction: (transaction: Pick<Transaction, "type">) =>
            transactionTypes[transaction.type],
        accountTypes,
        accountTypeDescriptions,
        transactionTypes,
        labelAccount,
        labelAccountSubtype,
    };
}
