import { useVirtualizer } from "@tanstack/react-virtual";
import { useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import PopupLayout from "../../layouts/popup-layout";
import { amountToDecimal } from "../../ledger/accounting";
import {
    billImportGroups,
    canImportToPaymentAccount,
    importBillsToAccounting,
} from "../../ledger/accounting/import-bills";
import type { GlobalMeta } from "../../ledger/type";
import { useIntl } from "../../locale";
import { accountingStore } from "../../store/accounting";
import { useAccountingLabels } from "../accounting/i18n";
import { Field, FormError, selectClass } from "../accounting/shared";
import { Button } from "../ui/button";

export type PreviewState = {
    bills: unknown[];
    meta?: Partial<GlobalMeta>;
    paymentAccountId?: string;
    paymentAccountIds?: Record<string, string>;
    bookId?: string;
    revision?: number;
};
export function PreviewForm({
    edit,
    onCancel,
    onConfirm,
}: {
    edit?: PreviewState;
    onCancel?: () => void;
    onConfirm?: (value: PreviewState) => void;
}) {
    const t = useIntl();
    const { labelAccount, accountTypes } = useAccountingLabels();
    const current = useStore(accountingStore, (state) => state.current);
    const [accountId, setAccountId] = useState("");
    const [accountIds, setAccountIds] = useState<Record<string, string>>({});
    const groups = useMemo(
        () => billImportGroups(edit?.bills ?? []),
        [edit?.bills],
    );
    const grouped = groups.some(Boolean);
    const ready = grouped
        ? groups.every((group) => !!accountIds[group])
        : !!accountId;
    const accounts =
        current?.data.accounts.filter(canImportToPaymentAccount) ?? [];
    const preview = useMemo(() => {
        if (!current || !edit || !ready) return {};
        try {
            if (
                current.book.id !== edit.bookId ||
                current.book.revision !== edit.revision
            )
                throw new Error(t("accounting-import-book-changed"));
            return {
                result: importBillsToAccounting(
                    current.data,
                    edit.bills,
                    edit.meta,
                    grouped ? accountIds : accountId,
                    Date.now(),
                ),
            };
        } catch (error) {
            return {
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }, [current, edit, accountId, accountIds, grouped, ready, t]);
    const list = useRef<HTMLDivElement>(null);
    const transactions = preview.result?.added ?? [];
    const virtual = useVirtualizer({
        count: transactions.length,
        getScrollElement: () => list.current,
        estimateSize: () => 70,
        overscan: 4,
    });
    return (
        <PopupLayout
            title={t("accounting-bill-import-preview")}
            onBack={onCancel}
            className="h-full overflow-hidden"
        >
            <div className="flex-1 min-h-0 flex flex-col gap-3 p-4">
                <div className="space-y-2 max-h-[35vh] overflow-y-auto shrink-0">
                    {(grouped ? groups : [""]).map((group) => (
                        <Field
                            key={group}
                            label={
                                grouped
                                    ? `${group || t("accounting-import-unspecified-method")} · ${t("accounting-import-payment-account")}`
                                    : t("accounting-import-payment-account")
                            }
                        >
                            <select
                                className={selectClass}
                                value={
                                    grouped
                                        ? (accountIds[group] ?? "")
                                        : accountId
                                }
                                onChange={(event) =>
                                    grouped
                                        ? setAccountIds((values) => ({
                                              ...values,
                                              [group]: event.target.value,
                                          }))
                                        : setAccountId(event.target.value)
                                }
                            >
                                <option value="">
                                    {t("accounting-import-select-account")}
                                </option>
                                {accounts.map((account) => (
                                    <option key={account.id} value={account.id}>
                                        {labelAccount(account)} ·{" "}
                                        {accountTypes[account.type]} (
                                        {account.currency})
                                    </option>
                                ))}
                            </select>
                        </Field>
                    ))}
                </div>
                <p className="text-xs text-muted-foreground">
                    {t("accounting-import-double-entry-help")}
                </p>
                {!accounts.length && (
                    <FormError error={t("accounting-import-no-account")} />
                )}
                {preview.result && (
                    <div className="text-sm space-y-1">
                        <p>
                            {t("accounting-import-bills-summary", {
                                count: transactions.length,
                                skipped: preview.result.skipped,
                            })}
                        </p>
                        {Object.entries(preview.result.accountChanges).map(
                            ([id, amount]) => {
                                const account = accounts.find(
                                    (item) => item.id === id,
                                )!;
                                const change =
                                    account.type === "liability"
                                        ? -amount
                                        : amount;
                                return (
                                    <p key={id}>
                                        {t("accounting-import-account-change", {
                                            name: labelAccount(account),
                                            type: accountTypes[account.type],
                                            amount:
                                                (change > 0 ? "+" : "") +
                                                amountToDecimal(change),
                                            currency: account.currency,
                                        })}
                                    </p>
                                );
                            },
                        )}
                    </div>
                )}
                <FormError error={preview.error} />
                <div
                    ref={list}
                    className="flex-1 min-h-0 overflow-y-auto rounded-md border"
                >
                    <div
                        style={{
                            height: virtual.getTotalSize(),
                            position: "relative",
                        }}
                    >
                        {virtual.getVirtualItems().map((row) => {
                            const transaction = transactions[row.index];
                            const category = preview.result!.data.accounts.find(
                                (account) =>
                                    account.id ===
                                    transaction.entries[0].accountId,
                            )!;
                            return (
                                <div
                                    key={transaction.id}
                                    data-index={row.index}
                                    ref={virtual.measureElement}
                                    className="absolute left-0 top-0 w-full p-3 border-b text-sm"
                                    style={{
                                        transform:
                                            "translateY(" + row.start + "px)",
                                    }}
                                >
                                    <div className="flex justify-between gap-2">
                                        <span>{labelAccount(category)}</span>
                                        <span>
                                            {amountToDecimal(
                                                transaction.type === "income"
                                                    ? -transaction.entries[0]
                                                          .amount
                                                    : transaction.entries[0]
                                                          .amount,
                                            )}{" "}
                                            {transaction.currency}
                                        </span>
                                    </div>
                                    <p className="text-xs text-muted-foreground truncate">
                                        {new Date(
                                            transaction.time,
                                        ).toLocaleString()}{" "}
                                        {transaction.description}
                                    </p>
                                </div>
                            );
                        })}
                    </div>
                </div>
                <Button
                    disabled={
                        !edit ||
                        !ready ||
                        !transactions.length ||
                        !!preview.error
                    }
                    onClick={() => {
                        if (edit && preview.result)
                            onConfirm?.({
                                ...edit,
                                paymentAccountId: grouped
                                    ? undefined
                                    : accountId,
                                paymentAccountIds: grouped
                                    ? accountIds
                                    : undefined,
                            });
                    }}
                >
                    {t("confirm")}
                </Button>
            </div>
        </PopupLayout>
    );
}
