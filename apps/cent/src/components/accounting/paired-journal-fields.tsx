import type { Account } from "../../ledger/accounting";
import { Button } from "../ui/button";
import { useAccountingLabels } from "./i18n";
import {
    getPairedTemplateAccounts,
    type JournalDraftEntry,
    type PairedJournalTemplate,
    selectPairedTemplateAccount,
} from "./journal-editor";
import { accountName, currencyLabel, Field, selectClass } from "./shared";

const labels: Record<
    PairedJournalTemplate,
    { from: string; to: string; help: string }
> = {
    transfer: {
        from: "accounting-transfer-from",
        to: "accounting-transfer-to",
        help: "accounting-transfer-help",
    },
    liability_payment: {
        from: "accounting-repayment-asset",
        to: "accounting-repayment-liability",
        help: "accounting-repayment-help",
    },
    liability_borrowing: {
        from: "accounting-borrowing-liability",
        to: "accounting-borrowing-asset",
        help: "accounting-borrowing-help",
    },
    asset_purchase: {
        from: "accounting-purchase-payment",
        to: "accounting-purchase-asset",
        help: "accounting-asset-purchase-help",
    },
    depreciation: {
        from: "accounting-depreciation-asset",
        to: "accounting-depreciation-expense-account",
        help: "accounting-journal-depreciation-help",
    },
};

export default function PairedJournalFields({
    accounts,
    rows,
    template,
    disabled,
    onChange,
    onManage,
    onNewAsset,
}: {
    accounts: Account[];
    rows: JournalDraftEntry[];
    template: PairedJournalTemplate;
    disabled: boolean;
    onChange: (rows: JournalDraftEntry[]) => void;
    onManage: () => void;
    onNewAsset: () => void;
}) {
    const { t, labelAccount, accountTypes } = useAccountingLabels();
    const { sources, from, destinations, to } = getPairedTemplateAccounts(
        template,
        rows,
        accounts,
    );
    const caption = labels[template];
    const picker = (
        side: JournalDraftEntry["side"],
        label: string,
        items: Account[],
        value: string,
    ) => {
        const selected = side === "credit" ? from : to;
        const increases =
            selected &&
            (side === "credit"
                ? selected.type === "liability"
                : selected.type !== "liability");
        return (
            <div className="min-w-0 space-y-1">
                <Field label={label}>
                    <select
                        className={selectClass}
                        value={value}
                        disabled={disabled || (side === "debit" && !from)}
                        onChange={(event) =>
                            onChange(
                                selectPairedTemplateAccount(
                                    template,
                                    rows,
                                    accounts,
                                    side,
                                    event.target.value,
                                ),
                            )
                        }
                    >
                        <option value="">
                            {t("accounting-journal-select-account")}
                        </option>
                        {items.map((account) => (
                            <option key={account.id} value={account.id}>
                                {accountName(account, accounts, labelAccount)}
                                {account.currency !== from?.currency
                                    ? ` · ${currencyLabel(account.currency)}`
                                    : ""}
                            </option>
                        ))}
                    </select>
                </Field>
                {selected && (
                    <p className="text-xs text-muted-foreground">
                        {t(
                            increases
                                ? "accounting-paired-increase"
                                : "accounting-paired-decrease",
                            { type: accountTypes[selected.type] },
                        )}
                    </p>
                )}
            </div>
        );
    };
    return (
        <div className="space-y-3" data-testid="paired-journal-fields">
            <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-2 items-center">
                {picker("credit", t(caption.from), sources, from?.id ?? "")}
                <span aria-hidden className="text-muted-foreground">
                    →
                </span>
                {picker("debit", t(caption.to), destinations, to?.id ?? "")}
            </div>
            <p className="text-xs text-muted-foreground">
                {t("accounting-paired-amount-help")}
            </p>
            <p className="text-xs text-muted-foreground">{t(caption.help)}</p>
            {from && !destinations.length && (
                <output className="block text-xs text-muted-foreground">
                    {t("accounting-paired-no-destination", {
                        currency: currencyLabel(from.currency),
                    })}
                </output>
            )}
            <div className="flex flex-wrap gap-2">
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={disabled}
                    onClick={onManage}
                >
                    {t("accounting-accounts")}
                </Button>
                {template === "asset_purchase" && (
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={disabled}
                        onClick={onNewAsset}
                    >
                        {t("accounting-create-fixed-asset")}
                    </Button>
                )}
            </div>
        </div>
    );
}
