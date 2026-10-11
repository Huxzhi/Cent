import type { Account } from "../../ledger/accounting";
import { useAccountingLabels } from "./i18n";
import { accountName, currencyLabel, Field, selectClass } from "./shared";

export interface ExchangeDraft {
    fromAccountId: string;
    toAccountId: string;
    received: string;
    fee: string;
    feeAccountId: string;
}
export default function ExchangeFields({
    accounts,
    draft,
    onChange,
    onAmountFocus,
    onActiveAmount,
    onCreateDestination,
}: {
    accounts: Account[];
    draft: ExchangeDraft;
    onChange: (draft: ExchangeDraft) => void;
    onAmountFocus: (focused: boolean) => void;
    onActiveAmount: (field: "received" | "fee") => void;
    onCreateDestination: () => void;
}) {
    const { t, labelAccount } = useAccountingLabels();
    const from = accounts.find((a) => a.id === draft.fromAccountId);
    const to = accounts.find((a) => a.id === draft.toAccountId);
    const assets = accounts.filter((a) => a.type === "asset");
    const sameCurrency = !!from && !!to && from.currency === to.currency;
    const picker = (
        field: "fromAccountId" | "toAccountId" | "feeAccountId",
        label: string,
        items: Account[],
    ) => (
        <Field label={label}>
            <select
                aria-label={label}
                className={selectClass}
                value={draft[field]}
                onChange={(event) => {
                    if (
                        field === "toAccountId" &&
                        event.target.value === "__new_account__"
                    ) {
                        onCreateDestination();
                        return;
                    }
                    onChange({
                        ...draft,
                        [field]: event.target.value,
                        ...(field === "fromAccountId"
                            ? { toAccountId: "", feeAccountId: "" }
                            : {}),
                        ...(field === "toAccountId" &&
                        items.find((a) => a.id === event.target.value)
                            ?.currency === from?.currency
                            ? { fee: "", feeAccountId: "" }
                            : {}),
                    });
                }}
            >
                <option value="">
                    {t("accounting-journal-select-account")}
                </option>
                {field === "toAccountId" && (
                    <option value="__new_account__">
                        {t("accounting-exchange-new-to-account")}
                    </option>
                )}
                {items.map((a) => (
                    <option key={a.id} value={a.id}>
                        {accountName(a, accounts, labelAccount)} ·{" "}
                        {currencyLabel(a.currency)}
                    </option>
                ))}
            </select>
        </Field>
    );
    const amount = (field: "received" | "fee", label: string) => (
        <Field label={label}>
            <input
                aria-label={label}
                className={selectClass}
                inputMode="decimal"
                placeholder="0.00"
                value={draft[field]}
                onFocus={() => {
                    onAmountFocus(true);
                    onActiveAmount(field);
                }}
                onBlur={() => onAmountFocus(false)}
                onChange={(event) =>
                    onChange({ ...draft, [field]: event.target.value })
                }
            />
        </Field>
    );
    return (
        <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
                {t("accounting-exchange-help")}
            </p>
            {to?.subtype === "prepaid" && (
                <p className="text-xs text-muted-foreground">
                    {t("accounting-funding-topup-help")}
                </p>
            )}
            <div className="grid grid-cols-2 gap-2">
                {picker(
                    "fromAccountId",
                    t("accounting-exchange-from"),
                    accounts.filter(
                        (a) =>
                            (a.type === "asset" && !a.paymentDisabled) ||
                            a.type === "liability",
                    ),
                )}
                {picker(
                    "toAccountId",
                    t("accounting-exchange-to"),
                    assets.filter((a) => a.id !== from?.id),
                )}
                {amount(
                    "received",
                    `${t("accounting-exchange-received")} (${to ? currencyLabel(to.currency) : "—"})`,
                )}
                {!sameCurrency &&
                    amount(
                        "fee",
                        `${t("accounting-exchange-fee")} (${from ? currencyLabel(from.currency) : "—"})`,
                    )}
            </div>
            {!sameCurrency &&
                draft.fee &&
                draft.fee !== "0" &&
                picker(
                    "feeAccountId",
                    t("accounting-exchange-fee-account"),
                    accounts.filter(
                        (a) =>
                            a.type === "expense" &&
                            a.currency === from?.currency,
                    ),
                )}
        </div>
    );
}
