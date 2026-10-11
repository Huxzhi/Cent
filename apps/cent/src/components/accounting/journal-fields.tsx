import type { ReactNode } from "react";
import type { Account, AccountType } from "../../ledger/accounting";
import { cn } from "../../utils";
import { Button } from "../ui/button";
import { useAccountingLabels } from "./i18n";
import {
    getDraftTotals,
    type JournalDraftEntry,
    type JournalTemplate,
} from "./journal-editor";
import { accountName, money, selectClass } from "./shared";

const types: AccountType[] = [
    "asset",
    "liability",
    "income",
    "expense",
    "equity",
];
const templates: JournalTemplate[] = [
    "transfer",
    "liability_payment",
    "asset_purchase",
    "currency_exchange",
    "liability_borrowing",
    "depreciation",
    "custom",
];

export default function JournalFields({
    rows,
    accounts,
    currency,
    activeId,
    template,
    disabled,
    onRowsChange,
    onActiveChange,
    onTemplateChange,
    onManage,
    onAmountFocus,
    exchangeFields,
    pairedFields,
    periodFields,
}: {
    exchangeFields?: ReactNode;
    pairedFields?: ReactNode;
    periodFields?: ReactNode;
    rows: JournalDraftEntry[];
    accounts: Account[];
    currency: string;
    activeId: string;
    template: JournalTemplate;
    disabled: boolean;
    onRowsChange: (rows: JournalDraftEntry[]) => void;
    onActiveChange: (id: string) => void;
    onTemplateChange: (template: JournalTemplate) => void;
    onManage: () => void;
    onAmountFocus: (focused: boolean) => void;
}) {
    const { t, accountTypes, transactionTypes, labelAccount } =
        useAccountingLabels();
    let totals: ReturnType<typeof getDraftTotals> | undefined;
    try {
        totals = getDraftTotals(rows);
    } catch {
        /* 未填金额时显示说明，领域入口再次校验。 */
    }
    const patch = (id: string, values: Partial<JournalDraftEntry>) =>
        onRowsChange(
            rows.map((row) => (row.id === id ? { ...row, ...values } : row)),
        );
    return (
        <div className="space-y-2 min-w-0 w-full">
            <label className="flex items-center gap-2 text-xs">
                {t("accounting-journal-template")}
                <select
                    aria-label={t("accounting-journal-template")}
                    className={cn(
                        selectClass,
                        "flex-1 min-w-0",
                        template === "transfer" && "h-8",
                    )}
                    value={template}
                    disabled={disabled}
                    onChange={(event) =>
                        onTemplateChange(event.target.value as JournalTemplate)
                    }
                >
                    {templates.map((value) => (
                        <option key={value} value={value}>
                            {value === "currency_exchange"
                                ? t("accounting-template-funding")
                                : value === "custom" || value === "depreciation"
                                  ? t(`accounting-template-${value}`)
                                  : transactionTypes[value]}
                        </option>
                    ))}
                </select>
            </label>
            {template === "currency_exchange" ? (
                exchangeFields
            ) : template !== "custom" ? (
                <>
                    {pairedFields}
                    {template === "asset_purchase" && periodFields}
                </>
            ) : (
                <>
                    <p className="text-xs text-muted-foreground">
                        {t("accounting-journal-help")}
                    </p>
                    <p
                        className={`text-xs ${totals?.difference === 0 ? "text-green-700" : "text-muted-foreground"}`}
                        aria-live="polite"
                    >
                        {totals
                            ? t("accounting-journal-totals", {
                                  debit: money(totals.debit, currency),
                                  credit: money(totals.credit, currency),
                                  difference: money(
                                      totals.difference,
                                      currency,
                                  ),
                              })
                            : t("accounting-journal-fill-amounts")}
                    </p>
                    {rows.map((row, index) => (
                        <fieldset
                            key={row.id}
                            onFocusCapture={() => onActiveChange(row.id)}
                            disabled={disabled}
                            className={`min-w-0 rounded-md border p-2 space-y-2 ${row.id === activeId ? "border-slate-500" : ""}`}
                        >
                            <legend className="px-1 text-xs">
                                {t("accounting-journal-entry-number", {
                                    number: index + 1,
                                })}
                            </legend>
                            <div className="flex items-center gap-2">
                                <select
                                    className={cn(selectClass, "w-24 shrink-0")}
                                    value={row.side}
                                    aria-label={t(
                                        "accounting-journal-side-number",
                                        {
                                            number: index + 1,
                                        },
                                    )}
                                    onChange={(event) =>
                                        patch(row.id, {
                                            side: event.target
                                                .value as JournalDraftEntry["side"],
                                        })
                                    }
                                >
                                    <option value="debit">
                                        {t("accounting-journal-debit")}
                                    </option>
                                    <option value="credit">
                                        {t("accounting-journal-credit")}
                                    </option>
                                </select>
                                <input
                                    className="h-10 flex-1 w-0 min-w-0 rounded-md border bg-background px-2 text-right"
                                    inputMode="decimal"
                                    value={row.amount}
                                    placeholder="0.00"
                                    aria-label={t(
                                        "accounting-journal-amount-number",
                                        {
                                            number: index + 1,
                                        },
                                    )}
                                    onFocus={() => {
                                        onActiveChange(row.id);
                                        onAmountFocus(true);
                                    }}
                                    onBlur={() => onAmountFocus(false)}
                                    onChange={(event) =>
                                        patch(row.id, {
                                            amount: event.target.value
                                                .replaceAll("*", "×")
                                                .replaceAll("/", "÷")
                                                .replace(/(.)-/g, "$1−"),
                                        })
                                    }
                                />
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="shrink-0"
                                    disabled={rows.length <= 2}
                                    aria-label={t(
                                        "accounting-journal-remove-number",
                                        {
                                            number: index + 1,
                                        },
                                    )}
                                    onClick={() =>
                                        onRowsChange(
                                            rows.filter(
                                                (item) => item.id !== row.id,
                                            ),
                                        )
                                    }
                                >
                                    <i
                                        aria-hidden
                                        className="icon-[mdi--close] size-4"
                                    />
                                </Button>
                            </div>
                            <select
                                className={selectClass}
                                value={row.accountId}
                                aria-label={t(
                                    "accounting-journal-account-number",
                                    {
                                        number: index + 1,
                                    },
                                )}
                                onChange={(event) =>
                                    patch(row.id, {
                                        accountId: event.target.value,
                                    })
                                }
                            >
                                <option value="">
                                    {t("accounting-journal-select-account")}
                                </option>
                                {types.map((type) => (
                                    <optgroup
                                        key={type}
                                        label={accountTypes[type]}
                                    >
                                        {accounts
                                            .filter(
                                                (account) =>
                                                    account.type === type &&
                                                    !(
                                                        row.side === "credit" &&
                                                        type === "asset" &&
                                                        account.paymentDisabled
                                                    ),
                                            )
                                            .map((account) => (
                                                <option
                                                    key={account.id}
                                                    value={account.id}
                                                >
                                                    {accountName(
                                                        account,
                                                        accounts,
                                                        labelAccount,
                                                    )}
                                                </option>
                                            ))}
                                    </optgroup>
                                ))}
                            </select>
                        </fieldset>
                    ))}
                    <div className="flex flex-wrap gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                                const row: JournalDraftEntry = {
                                    id: crypto.randomUUID(),
                                    accountId: "",
                                    side: "debit",
                                    amount: "",
                                };
                                onRowsChange([...rows, row]);
                                onActiveChange(row.id);
                            }}
                        >
                            {t("accounting-journal-add-entry")}
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={onManage}
                        >
                            {t("accounting-accounts")}
                        </Button>
                    </div>
                </>
            )}
        </div>
    );
}
