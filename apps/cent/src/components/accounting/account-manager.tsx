import { Collapsible } from "radix-ui";
import { useState } from "react";
import { useStore } from "zustand";
import { useAccountingView } from "../../hooks/use-accounting-view";
import PopupLayout from "../../layouts/popup-layout";
import {
    type Account,
    type AccountType,
    archiveAccount,
    deleteConfiguredAccount,
    getAccountIcon,
    getAccountTotalDisplayBalance,
    replayCurrencyCosts,
    updateAccount,
} from "../../ledger/accounting";
import { isCurrencyTradingGroup } from "../../ledger/accounting/currency-trading";
import { accountingStore } from "../../store/accounting";
import createConfirmProvider from "../confirm";
import { Button } from "../ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import AccountForm from "./account-form";
import AccountGuide from "./account-guide";
import AccountIcon from "./account-icon";
import { orderPickerAccounts } from "./account-picker-tree";
import { useAccountingLabels } from "./i18n";
import { FormError, Modal, money, useFormAction } from "./shared";

export default function AccountManager({
    edit,
    onCancel,
}: {
    edit?: AccountType;
    onCancel?: () => void;
    onConfirm?: () => void;
}) {
    const { t, accountTypes, labelAccount, labelAccountSubtype } =
        useAccountingLabels();
    const { current, busy } = useStore(accountingStore);
    const [tab, setTab] = useState<AccountType>(edit ?? "asset");
    const [accountEdit, setAccountEdit] = useState<Account | "new">();
    const [initial, setInitial] =
        useState<Pick<Account, "type" | "currency" | "parentId">>();
    const [showArchived, setShowArchived] = useState(false);
    const [removing, setRemoving] = useState<Account>();
    const { error, submitting, run } = useFormAction();
    const view = useAccountingView(current?.data);
    if (!current) return null;
    const data = current.data;
    const costBalances = replayCurrencyCosts(
        data.accounts,
        data.transactions,
        undefined,
        data.currencySettings?.baseCurrency,
    ).balances;
    const blocked = busy || submitting;
    const balance = (account: Account) => {
        if (isCurrencyTradingGroup(account))
            return t("accounting-exchange-group-help");
        try {
            return money(
                getAccountTotalDisplayBalance(
                    account,
                    data.accounts,
                    view.transactions,
                ),
                account.currency,
            );
        } catch {
            return t("accounting-balance-overflow");
        }
    };
    const addAccount = (parent?: Account) => {
        setInitial({
            type: tab,
            currency:
                parent?.currency ??
                data.currencySettings?.baseCurrency ??
                "CNY",
            parentId: parent?.id,
        });
        setAccountEdit("new");
    };
    const toggleArchive = (account: Account) =>
        void run(async () => {
            const now = Date.now();
            await accountingStore.getState().updateData((snapshot) => {
                const updated = account.archived
                    ? updateAccount(
                          account.id,
                          { archived: false },
                          snapshot.accounts,
                          snapshot.transactions,
                          now,
                      )
                    : archiveAccount(
                          account.id,
                          snapshot.accounts,
                          snapshot.transactions,
                          now,
                      );
                return {
                    ...snapshot,
                    accounts: snapshot.accounts.map((item) =>
                        item.id === account.id ? updated : item,
                    ),
                };
            }, now);
        });
    const visible = orderPickerAccounts(
        data.accounts.filter((account) => showArchived || !account.archived),
    );
    const renderAccount = (account: Account, depth = 0) => {
        const children = visible.filter((item) => item.parentId === account.id);
        const parent = data.accounts.find(
            (item) => item.id === account.parentId,
        );
        const hasChildren = data.accounts.some(
            (item) => item.parentId === account.id,
        );
        return (
            <Collapsible.Root
                key={account.id}
                asChild
                defaultOpen={
                    account.presetKey?.startsWith("starter:") ||
                    isCurrencyTradingGroup(account)
                }
            >
                <li
                    aria-label={t("accounting-account-node", {
                        name: labelAccount(account),
                    })}
                    className={
                        depth
                            ? "relative border-b last:border-b-0 before:absolute before:top-6 before:-left-3 before:w-3 before:border-t before:border-border"
                            : "rounded-md border shadow-sm bg-background"
                    }
                >
                    <div className="p-2 space-y-1">
                        <div className="flex items-start gap-1 min-w-0">
                            {children.length ? (
                                <Collapsible.Trigger asChild>
                                    <Button
                                        type="button"
                                        size="icon"
                                        variant="ghost"
                                        className="group size-7 mt-0.5 shrink-0"
                                        aria-label={t(
                                            "accounting-expand-child-accounts",
                                            { name: labelAccount(account) },
                                        )}
                                    >
                                        <i
                                            aria-hidden="true"
                                            className="icon-[mdi--chevron-right] size-5 transition-transform group-data-[state=open]:rotate-90"
                                        />
                                    </Button>
                                </Collapsible.Trigger>
                            ) : (
                                <span
                                    aria-hidden="true"
                                    className="w-7 shrink-0"
                                />
                            )}
                            <Button
                                type="button"
                                variant="ghost"
                                className="h-auto flex-1 min-w-0 py-1 px-1 gap-2 justify-start whitespace-normal text-left"
                                disabled={blocked}
                                aria-label={t("accounting-edit-named-account", {
                                    name: labelAccount(account),
                                })}
                                onClick={() => setAccountEdit(account)}
                            >
                                <AccountIcon
                                    icon={getAccountIcon(account)}
                                    className="size-6 shrink-0"
                                />
                                <span className="flex flex-col min-w-0 items-start gap-1">
                                    <span className="font-medium break-words w-full">
                                        {labelAccount(account)}
                                        {account.archived
                                            ? t("accounting-archived-suffix")
                                            : ""}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                        {hasChildren &&
                                            !isCurrencyTradingGroup(
                                                account,
                                            ) && (
                                                <span>
                                                    {t(
                                                        "accounting-account-inclusive-balance",
                                                    )}{" "}
                                                </span>
                                            )}
                                        {balance(account)}
                                    </span>
                                </span>
                            </Button>
                        </div>
                        <div className="ml-8 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                            <span className="rounded border bg-muted/50 px-1.5 py-0.5 text-foreground">
                                <span className="sr-only">
                                    {t("accounting-account-subtype")}:{" "}
                                </span>
                                {labelAccountSubtype(account)}
                            </span>
                            <span className="min-w-0 break-words">
                                {parent
                                    ? t("accounting-account-parent-label", {
                                          name: labelAccount(parent),
                                      })
                                    : t("accounting-account-independent")}
                            </span>
                            {!!children.length && (
                                <span>
                                    {t("accounting-account-child-count", {
                                        count: children.length,
                                    })}
                                </span>
                            )}
                        </div>
                        <div className="ml-8 flex items-center justify-end gap-1 flex-wrap">
                            <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                disabled={
                                    blocked ||
                                    account.archived ||
                                    isCurrencyTradingGroup(account) ||
                                    account.subtype === "currency_trading" ||
                                    current.data.currencySettings?.customCurrencies.some(
                                        (currency) =>
                                            currency.accountId === account.id,
                                    )
                                }
                                aria-label={t("accounting-add-child-account", {
                                    name: labelAccount(account),
                                })}
                                onClick={() => addAccount(account)}
                            >
                                ＋
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                disabled={
                                    blocked || isCurrencyTradingGroup(account)
                                }
                                aria-label={t(
                                    account.archived
                                        ? "accounting-restore-named-account"
                                        : "accounting-archive-named-account",
                                    { name: labelAccount(account) },
                                )}
                                onClick={() => toggleArchive(account)}
                            >
                                {account.archived
                                    ? t("accounting-restore")
                                    : t("accounting-archive")}
                            </Button>
                            <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                disabled={
                                    blocked || isCurrencyTradingGroup(account)
                                }
                                aria-label={t(
                                    "accounting-delete-named-account",
                                    {
                                        name: labelAccount(account),
                                    },
                                )}
                                onClick={() => setRemoving(account)}
                            >
                                {t("accounting-delete")}
                            </Button>
                        </div>
                    </div>
                    {costBalances.has(account.id) ? (
                        <div className="ml-10 mr-2 pb-2 text-xs text-muted-foreground">
                            {t("accounting-currency-remaining-cost")}{" "}
                            {costBalances.get(account.id)?.bookAmount ===
                            undefined
                                ? t("accounting-no-exchange-rate")
                                : money(
                                      costBalances.get(account.id)
                                          ?.bookAmount ?? 0,
                                      costBalances.get(account.id)
                                          ?.costCurrency ?? account.currency,
                                  )}
                        </div>
                    ) : null}
                    {!!children.length && (
                        <Collapsible.Content>
                            <ul
                                aria-label={t("accounting-account-children", {
                                    name: labelAccount(account),
                                })}
                                className={`border-l-2 border-border mr-2 mb-2 ${depth < 3 ? "ml-4 pl-3" : "ml-1 pl-1"}`}
                            >
                                {children.map((child) =>
                                    renderAccount(child, depth + 1),
                                )}
                            </ul>
                        </Collapsible.Content>
                    )}
                </li>
            </Collapsible.Root>
        );
    };
    return (
        <PopupLayout
            title={t("accounting-accounts")}
            onBack={onCancel}
            className="overflow-hidden h-full"
        >
            <Tabs
                value={tab}
                onValueChange={(value) => setTab(value as AccountType)}
                className="px-2 pb-4 flex flex-col flex-1 min-h-0 gap-2"
            >
                <TabsList className="w-full shrink-0">
                    {(Object.keys(accountTypes) as AccountType[]).map(
                        (type) => (
                            <TabsTrigger
                                key={type}
                                value={type}
                                className="flex-1 min-w-0 px-1 text-xs sm:text-sm"
                            >
                                {accountTypes[type]}
                            </TabsTrigger>
                        ),
                    )}
                </TabsList>
                <div className="flex justify-between items-center gap-2 px-1 text-xs shrink-0">
                    <span className="text-muted-foreground">
                        {t("accounting-account-list-help")}
                    </span>
                    <label className="flex gap-1 items-center shrink-0">
                        <input
                            type="checkbox"
                            checked={showArchived}
                            onChange={(event) =>
                                setShowArchived(event.target.checked)
                            }
                        />
                        {t("accounting-archived")}
                    </label>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hidden space-y-3">
                    <AccountGuide
                        type={tab}
                        initiallyExpanded={false}
                        showTemplate={data.accounts.some((account) =>
                            account.presetKey?.startsWith("template:"),
                        )}
                    />
                    <FormError error={error} />
                    {(Object.keys(accountTypes) as AccountType[]).map(
                        (type) => (
                            <TabsContent
                                key={type}
                                value={type}
                                className="mt-0 flex flex-col gap-2"
                            >
                                <Button
                                    type="button"
                                    variant="outline"
                                    disabled={blocked}
                                    onClick={() => addAccount()}
                                >
                                    {t("accounting-new-typed-account", {
                                        type: accountTypes[type],
                                    })}
                                </Button>
                                <ul
                                    aria-label={t("accounting-account-tree", {
                                        type: accountTypes[type],
                                    })}
                                    className="space-y-2"
                                >
                                    {visible
                                        .filter(
                                            (account) =>
                                                account.type === type &&
                                                !visible.some(
                                                    (parent) =>
                                                        parent.id ===
                                                        account.parentId,
                                                ),
                                        )
                                        .map((account) =>
                                            renderAccount(account),
                                        )}
                                </ul>
                            </TabsContent>
                        ),
                    )}
                </div>
            </Tabs>
            {accountEdit && (
                <AccountForm
                    key={
                        typeof accountEdit === "string" ? "new" : accountEdit.id
                    }
                    account={accountEdit === "new" ? undefined : accountEdit}
                    initial={initial}
                    onClose={() => setAccountEdit(undefined)}
                />
            )}
            {removing && (
                <Modal
                    title={t("accounting-delete-account")}
                    busy={blocked}
                    onClose={() => setRemoving(undefined)}
                >
                    <p className="text-sm mb-4">
                        {t("accounting-delete-account-warning", {
                            name: labelAccount(removing),
                        })}
                    </p>
                    <FormError error={error} />
                    <div className="flex gap-2 justify-end">
                        <Button
                            variant="outline"
                            disabled={blocked}
                            onClick={() => setRemoving(undefined)}
                        >
                            {t("accounting-cancel")}
                        </Button>
                        <Button
                            variant="destructive"
                            disabled={blocked}
                            onClick={() =>
                                void run(async () => {
                                    await accountingStore
                                        .getState()
                                        .updateData(
                                            (snapshot) =>
                                                deleteConfiguredAccount(
                                                    snapshot,
                                                    removing.id,
                                                ),
                                            Date.now(),
                                        );
                                    setRemoving(undefined);
                                })
                            }
                        >
                            {t("accounting-confirm-delete")}
                        </Button>
                    </div>
                </Modal>
            )}
        </PopupLayout>
    );
}

export const [AccountManagerProvider, showAccountManager] =
    createConfirmProvider<AccountType, void>(AccountManager, {
        dialogTitle: "accounting-accounts",
        dialogModalClose: true,
        contentClassName:
            "h-full w-full max-h-full max-w-full rounded-none sm:rounded-md sm:max-h-[min(520px,calc(100vh-32px))] sm:w-[90vw] sm:max-w-[500px]",
    });
