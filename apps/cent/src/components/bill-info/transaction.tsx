import { createId } from "@glink25/sync-sdk";
import { type ReactNode, useState } from "react";
import { useStore } from "zustand";
import { useTag } from "../../hooks/use-tag";
import {
    duplicateTransaction,
    getAccountIcon,
    getChildTransactions,
    getCurrencyExchangeRate,
    getEditableJournalInput,
    getEditableTransactionInput,
    getEntryAmount,
    getTransactionEditTarget,
    replayCurrencyCosts,
    sumAmounts,
    type Transaction,
} from "../../ledger/accounting";
import { getTransactionEquityChange } from "../../ledger/accounting/equity-change";
import {
    getTransactionDescription,
    getTransactionPresentation,
} from "../../ledger/accounting/presentation";
import { measure } from "../../measurement";
import { accountingStore } from "../../store/accounting";
import { useUserStore } from "../../store/user";
import { formatTime } from "../../utils/time";
import AccountIcon from "../accounting/account-icon";
import { useAccountingLabels } from "../accounting/i18n";
import {
    accountFlow,
    accountName,
    currencyLabel,
    FormError,
    Modal,
    money,
    useFormAction,
} from "../accounting/shared";
import { goAddBill } from "../bill-editor";
import createConfirmProvider from "../confirm";
import SmartImage from "../image";
import { Button } from "../ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import BillInfoLayout from "./layout";

function DetailRow({
    label,
    children,
}: {
    label: string;
    children: ReactNode;
}) {
    return (
        <div className="flex justify-between items-start my-1 gap-2">
            <div className="shrink-0">{label}:</div>
            <div className="min-w-0 text-right break-words">{children}</div>
        </div>
    );
}

function TransactionInfo({
    edit,
    onCancel,
}: {
    edit?: Transaction;
    onCancel?: () => void;
    onConfirm?: () => void;
}) {
    const { current, busy } = useStore(accountingStore);
    const { t, labelTransaction, accountTypes, labelAccount } =
        useAccountingLabels();
    const { tags } = useTag();
    const userId = useUserStore((state) => state.id);
    const cachedUsers = useUserStore((state) => state.cachedUsers);
    const [removing, setRemoving] = useState(false);
    const { error, submitting, run } = useFormAction();
    if (!current || !edit) return null;
    const transaction = current.data.transactions.find(
        (item) => item.id === edit.id,
    );
    if (!transaction) return null;
    const accounts = current.data.accounts;
    const children = getChildTransactions(
        transaction.id,
        current.data.transactions,
    );
    const parent = current.data.transactions.find(
        (item) => item.id === transaction.parentTransactionId,
    );
    const editTarget = getTransactionEditTarget(
        transaction,
        current.data.transactions,
    );
    const editable =
        getEditableTransactionInput(editTarget, accounts) ||
        getEditableJournalInput(editTarget, accounts) ||
        ["currency_exchange", "topup"].includes(editTarget.type);
    const blocked = busy || submitting;
    let row: ReturnType<typeof getTransactionPresentation> | undefined;
    let change: ReturnType<typeof getTransactionEquityChange> | undefined;
    try {
        row = getTransactionPresentation(transaction, accounts);
        change = getTransactionEquityChange(
            transaction,
            accounts,
            undefined,
            undefined,
            replayCurrencyCosts(
                accounts,
                current.data.transactions,
                undefined,
                current.data.currencySettings?.baseCurrency,
            ),
        );
    } catch {
        // 分录单独可显示时，合计超限仍允许打开详情。
    }
    const amountLabel =
        change === undefined
            ? t("accounting-detail-amount-overflow")
            : `${transaction.entries.some((entry) => entry.currency?.base === change.currency) ? "≈ " : ""}${change.amount > 0 ? "+" : ""}${money(change.amount, change.currency)}`;
    const creator = transaction.creatorId;
    const creatorLabel =
        creator === undefined
            ? t("me")
            : String(creator) === String(userId) || creator === "me"
              ? t("me")
              : Object.values(cachedUsers).find(
                    (user) => String(user.id) === String(creator),
                )?.name || t("me");

    return (
        <>
            <BillInfoLayout
                header={
                    <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center min-w-0">
                            <div className="w-12 h-12 shrink-0 rounded-full bg-background border p-4 flex items-center justify-center">
                                <AccountIcon
                                    icon={
                                        row?.account
                                            ? getAccountIcon(row.account)
                                            : "icon-[mdi--swap-horizontal]"
                                    }
                                />
                            </div>
                            <div className="text-md font-semibold px-2 min-w-0 break-words">
                                {accountFlow(
                                    transaction,
                                    accounts,
                                    labelAccount,
                                )}
                            </div>
                        </div>
                        <div
                            title={t(
                                transaction.endTime === undefined
                                    ? "accounting-equity-change-help"
                                    : "accounting-period-total",
                            )}
                            className={`text-xl sm:text-2xl font-bold shrink-0 max-w-[50%] break-words text-right ${change && change.amount < 0 ? "text-semantic-expense" : change && change.amount > 0 ? "text-semantic-income" : "text-foreground"}`}
                        >
                            {amountLabel}
                            <div className="text-xs font-normal text-muted-foreground">
                                {t(
                                    transaction.endTime === undefined
                                        ? "accounting-equity-change"
                                        : "accounting-period-total",
                                )}
                            </div>
                        </div>
                    </div>
                }
                footer={
                    <>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    className="text-base font-normal cursor-pointer"
                                    disabled={blocked}
                                >
                                    {t("more-actions")}
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start">
                                <DropdownMenuItem
                                    disabled={blocked}
                                    onClick={() =>
                                        void run(async () => {
                                            const now = Date.now();
                                            await accountingStore
                                                .getState()
                                                .updateData(
                                                    (data) => ({
                                                        ...data,
                                                        transactions: [
                                                            ...data.transactions,
                                                            ...duplicateTransaction(
                                                                transaction.id,
                                                                data.transactions,
                                                                now,
                                                                createId,
                                                            ),
                                                        ],
                                                    }),
                                                    now,
                                                );
                                            measure("bill_created", {
                                                source: "duplicate",
                                                item_count: 1,
                                            });
                                            onCancel?.();
                                        })
                                    }
                                >
                                    <i
                                        aria-hidden
                                        className="icon-[mdi--content-copy]"
                                    />
                                    {t("duplicate")}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    className="text-red-600"
                                    disabled={
                                        blocked ||
                                        !!children.length ||
                                        transaction.type === "depreciation"
                                    }
                                    title={
                                        children.length
                                            ? t("accounting-delete-parent-help")
                                            : undefined
                                    }
                                    onClick={() => setRemoving(true)}
                                >
                                    <i
                                        aria-hidden
                                        className="icon-[mdi--trash-can-outline]"
                                    />
                                    {t("delete")}
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                        <div className="flex shrink-0">
                            <button
                                type="button"
                                className="buttoned px-2 rounded-md cursor-pointer"
                                disabled={blocked}
                                onClick={onCancel}
                            >
                                {t("cancel")}
                            </button>
                            {editable && (
                                <button
                                    type="button"
                                    className="buttoned ml-2 px-2 rounded-md font-semibold cursor-pointer"
                                    disabled={blocked}
                                    onClick={() => {
                                        void goAddBill(transaction)
                                            .then(() => onCancel?.())
                                            .catch(() => {});
                                    }}
                                >
                                    {t(
                                        parent
                                            ? "accounting-edit-parent-transaction"
                                            : "edit",
                                    )}
                                </button>
                            )}
                        </div>
                    </>
                }
            >
                <div className="text-gray-500">
                    <DetailRow label={t("comment")}>
                        {getTransactionDescription(transaction, parent)}
                    </DetailRow>
                    <DetailRow label={t("creator")}>{creatorLabel}</DetailRow>
                    <DetailRow label={t("time")}>
                        {formatTime(transaction.time)}
                    </DetailRow>
                    {transaction.endTime !== undefined && (
                        <DetailRow label={t("accounting-period-range")}>
                            {formatTime(transaction.time)} →{" "}
                            {formatTime(transaction.endTime)}
                            <p className="text-xs">
                                {t("accounting-period-range-help")}
                            </p>
                        </DetailRow>
                    )}
                    <DetailRow label={t("accounting-transaction-type")}>
                        {labelTransaction(transaction)}
                    </DetailRow>
                    {transaction.type === "depreciation" && (
                        <p className="text-xs text-muted-foreground py-2">
                            {t("accounting-asset-rule-generated-help")}
                        </p>
                    )}
                    {transaction.location && (
                        <DetailRow label={t("location")}>
                            ({transaction.location.latitude.toFixed(4)},{" "}
                            {transaction.location.longitude.toFixed(4)})
                        </DetailRow>
                    )}
                    {transaction.entries.find((entry) => entry.currency)
                        ?.currency && (
                        <p className="text-xs text-muted-foreground py-2">
                            {t("accounting-currency-estimate-help")}
                        </p>
                    )}
                    {!!transaction.tagIds?.length && (
                        <DetailRow label={t("tags")}>
                            <div className="flex flex-wrap gap-1 justify-end">
                                {transaction.tagIds.map((id) => (
                                    <span key={id}>
                                        #
                                        {tags.find((tag) => tag.id === id)
                                            ?.name ?? id}
                                    </span>
                                ))}
                            </div>
                        </DetailRow>
                    )}
                    {transaction.parentTransactionId && (
                        <DetailRow label={t("accounting-parent-transaction")}>
                            {parent ? (
                                <button
                                    type="button"
                                    className="underline cursor-pointer"
                                    onClick={() => {
                                        void showTransactionInfo(parent).catch(
                                            () => {},
                                        );
                                    }}
                                >
                                    {parent.description ||
                                        accountFlow(
                                            parent,
                                            accounts,
                                            labelAccount,
                                        )}
                                </button>
                            ) : (
                                transaction.parentTransactionId
                            )}
                        </DetailRow>
                    )}
                    {!!children.length && (
                        <DetailRow
                            label={t("accounting-child-transactions", {
                                count: children.length,
                            })}
                        >
                            <div className="flex flex-col gap-1">
                                {children.map((child) => (
                                    <button
                                        key={child.id}
                                        type="button"
                                        className="underline cursor-pointer text-right"
                                        onClick={() => {
                                            void showTransactionInfo(
                                                child,
                                            ).catch(() => {});
                                        }}
                                    >
                                        {formatTime(child.time)} ·{" "}
                                        {getTransactionDescription(
                                            child,
                                            transaction,
                                        ) || labelTransaction(child)}
                                    </button>
                                ))}
                            </div>
                        </DetailRow>
                    )}
                </div>
                {transaction.exchange && (
                    <p className="text-sm text-muted-foreground py-2">
                        {t("accounting-exchange-rate", {
                            from: currencyLabel(
                                accounts.find(
                                    (a) =>
                                        a.id ===
                                        transaction.exchange?.fromAccountId,
                                )?.currency ?? transaction.currency,
                            ),
                            to: currencyLabel(
                                accounts.find(
                                    (a) =>
                                        a.id ===
                                        transaction.exchange?.toAccountId,
                                )?.currency ?? transaction.currency,
                            ),
                            rate: getCurrencyExchangeRate(
                                transaction,
                            ).toPrecision(10),
                        })}
                    </p>
                )}
                <section
                    aria-label={t("accounting-account-changes")}
                    className="rounded-md border divide-y mt-3 shrink-0"
                >
                    <h3 className="p-3 text-sm font-medium">
                        {t("accounting-account-changes")}
                    </h3>
                    {[
                        ...new Set(
                            transaction.entries.map((entry) => entry.accountId),
                        ),
                    ].map((accountId) => {
                        const account = accounts.find(
                            (item) => item.id === accountId,
                        );
                        const entries = transaction.entries.filter(
                            (entry) => entry.accountId === accountId,
                        );
                        let amount: number | undefined;
                        try {
                            amount = sumAmounts(entries.map(getEntryAmount));
                        } catch {
                            // 个别账户变动合计超限不影响展示其他账户。
                        }
                        return (
                            <div
                                key={accountId}
                                className="flex justify-between items-start gap-3 p-3 text-sm"
                            >
                                <span className="flex items-center gap-2 min-w-0">
                                    <AccountIcon
                                        icon={
                                            account
                                                ? getAccountIcon(account)
                                                : "icon-[mdi--swap-horizontal]"
                                        }
                                        className="shrink-0"
                                    />
                                    <span className="min-w-0 break-words">
                                        <span className="block">
                                            {account
                                                ? accountName(
                                                      account,
                                                      accounts,
                                                      labelAccount,
                                                  )
                                                : accountId}
                                        </span>
                                        {account && (
                                            <span className="block text-xs text-muted-foreground mt-1">
                                                {accountTypes[account.type]}
                                            </span>
                                        )}
                                    </span>
                                </span>
                                <span className="text-right shrink-0 max-w-[50%] break-words">
                                    <span className="block font-medium">
                                        {amount === undefined
                                            ? t(
                                                  "accounting-detail-amount-overflow",
                                              )
                                            : `${amount > 0 ? "+" : ""}${money(amount, account?.currency ?? transaction.currency, !!transaction.exchange || undefined)}`}
                                    </span>
                                    {amount !== undefined && (
                                        <span className="block text-xs text-muted-foreground mt-1">
                                            {t(
                                                amount > 0
                                                    ? "accounting-journal-debit"
                                                    : amount < 0
                                                      ? "accounting-journal-credit"
                                                      : "accounting-balance-unchanged",
                                            )}
                                        </span>
                                    )}
                                </span>
                            </div>
                        );
                    })}
                </section>
                {!!transaction.images?.length && (
                    <div className="py-2 flex gap-2 items-center justify-center max-w-full overflow-x-auto hidden-scrollbar shrink-0">
                        {transaction.images.map((image) => (
                            <SmartImage
                                key={image.id}
                                source={image.dataUrl}
                                alt={image.name}
                                className="max-h-[200px] object-contain rounded min-w-24 min-h-24 data-[state=loading]:animate-pulse bg-primary/10"
                            />
                        ))}
                    </div>
                )}
                {!!children.length && (
                    <p className="text-xs text-muted-foreground mt-2">
                        {t("accounting-delete-parent-help")}
                    </p>
                )}
                <FormError error={error} />
            </BillInfoLayout>
            {removing && (
                <Modal
                    title={t("accounting-delete-transaction")}
                    busy={blocked}
                    onClose={() => setRemoving(false)}
                >
                    <p className="text-sm my-4">
                        {t("accounting-delete-transaction-warning")}
                    </p>
                    <FormError error={error} />
                    <div className="flex justify-end gap-2">
                        <Button
                            variant="outline"
                            disabled={blocked}
                            onClick={() => setRemoving(false)}
                        >
                            {t("cancel")}
                        </Button>
                        <Button
                            variant="destructive"
                            disabled={blocked}
                            onClick={() =>
                                void run(async () => {
                                    await accountingStore.getState().updateData(
                                        (data) => ({
                                            ...data,
                                            transactions:
                                                data.transactions.filter(
                                                    (item) =>
                                                        item.id !==
                                                        transaction.id,
                                                ),
                                        }),
                                        Date.now(),
                                    );
                                    setRemoving(false);
                                    onCancel?.();
                                })
                            }
                        >
                            {t("delete")}
                        </Button>
                    </div>
                </Modal>
            )}
        </>
    );
}

export const [TransactionInfoProvider, showTransactionInfo] =
    createConfirmProvider<Transaction, void>(TransactionInfo, {
        dialogTitle: "accounting-transaction-details",
        dialogModalClose: true,
        fade: true,
        swipe: false,
        contentClassName:
            "max-h-[85dvh] w-[90vw] max-w-[500px] rounded-md overflow-hidden",
    });
