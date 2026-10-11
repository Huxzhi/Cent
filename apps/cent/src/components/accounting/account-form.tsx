import { useState } from "react";
import { useStore } from "zustand";
import { useCurrency } from "../../hooks/use-currency";
import {
    type Account,
    type AccountType,
    canCreateOpeningBalance,
    createAccount,
    createOpeningBalance,
    getAccountIcon,
    saveAccountConfiguration,
} from "../../ledger/accounting";
import { isCurrencyTradingGroup } from "../../ledger/accounting/currency-trading";
import { accountingStore } from "../../store/accounting";
import { parseBookDateTime } from "../../utils/time";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import AccountIcon from "./account-icon";
import AccountIconPicker from "./account-icon-picker";
import { useAccountingLabels } from "./i18n";
import {
    currencyLabel,
    dateInput,
    Field,
    FormError,
    isBaseCurrency,
    Modal,
    parseMoney,
    selectClass,
    useFormAction,
} from "./shared";

export default function AccountForm({
    account,
    onClose,
    initial,
    onSaved,
    fixedType,
    excludedCurrencies = [],
}: {
    account?: Account;
    onClose: () => void;
    onSaved?: (id: string) => void;
    fixedType?: AccountType;
    excludedCurrencies?: readonly string[];
    initial?: Pick<Account, "type" | "currency" | "parentId" | "subtype">;
}) {
    const { t, accountTypes, accountTypeDescriptions, labelAccount } =
        useAccountingLabels();
    const { current, busy } = useStore(accountingStore);
    const [id] = useState(() => account?.id ?? crypto.randomUUID());
    const [equityId] = useState(() => crypto.randomUUID());
    const [cardCurrencyId] = useState(
        () =>
            current?.data.currencySettings?.customCurrencies.find(
                (item) => item.accountId === account?.id,
            )?.id ?? crypto.randomUUID(),
    );
    const [originalLabel] = useState(() =>
        account ? labelAccount(account) : "",
    );
    const [name, setName] = useState(originalLabel);
    const [icon, setIcon] = useState(account?.icon);
    const [showIcons, setShowIcons] = useState(false);
    const [type, setType] = useState<AccountType>(
        account?.type ?? fixedType ?? initial?.type ?? "asset",
    );
    const { allCurrencies } = useCurrency();
    const availableCurrencies = allCurrencies.filter(
        (item) =>
            !excludedCurrencies.includes(item.id) &&
            (type !== "asset" ||
                !("accountId" in item) ||
                item.accountId === id),
    );
    const [currency, setCurrency] = useState(() => {
        const preferred =
            account?.currency ??
            initial?.currency ??
            current?.data.currencySettings?.baseCurrency ??
            "CNY";
        return excludedCurrencies.includes(preferred)
            ? (availableCurrencies[0]?.id ?? "")
            : preferred;
    });
    const [subtype, setSubtype] = useState(
        account?.subtype ?? initial?.subtype ?? "",
    );
    const [parentId, setParentId] = useState(
        account?.parentId ?? initial?.parentId ?? "",
    );
    const [paymentDisabled, setPaymentDisabled] = useState(
        (account?.subtype ?? initial?.subtype) === "subscription" ||
            (account?.paymentDisabled ?? false),
    );
    const [openingAmount, setOpeningAmount] = useState("0");
    const [openingTime, setOpeningTime] = useState(() => dateInput(Date.now()));
    const [offsetId, setOffsetId] = useState<string>();
    const { error, submitting, run } = useFormAction(onClose);
    if (!current) return null;
    const used = current.data.transactions.some((transaction) =>
        transaction.entries.some((entry) => entry.accountId === id),
    );
    const costCurrency = used
        ? account?.costCurrency
        : type === "asset" &&
            currency !== (current.data.currencySettings?.baseCurrency ?? "CNY")
          ? (current.data.currencySettings?.baseCurrency ?? "CNY")
          : undefined;
    const isCard = type === "asset" && subtype === "prepaid";
    const supportsOpeningBalance = canCreateOpeningBalance({
        type,
        subtype: subtype.trim() || undefined,
        costCurrency,
    });
    const isTradingChild = account?.subtype === "currency_trading";
    const isTradingGroup = !!account && isCurrencyTradingGroup(account);
    const accountCurrency = isCard ? cardCurrencyId : currency;
    const branch = new Set([id]);
    const pending = [id];
    while (pending.length) {
        const parent = pending.pop();
        for (const child of current.data.accounts) {
            if (child.parentId === parent && !branch.has(child.id)) {
                branch.add(child.id);
                pending.push(child.id);
            }
        }
    }
    const selectedIcon = getAccountIcon({
        name: account && name === originalLabel ? account.name : name.trim(),
        type,
        subtype,
        presetKey: account?.presetKey,
        icon,
    });
    const parents = current.data.accounts.filter(
        (item) =>
            !branch.has(item.id) &&
            item.type === type &&
            (isTradingChild
                ? isCurrencyTradingGroup(item)
                : item.currency === accountCurrency &&
                  !isCurrencyTradingGroup(item)) &&
            (!item.archived || item.id === account?.parentId),
    );
    const equityAccounts = current.data.accounts.filter(
        (item) =>
            item.type === "equity" &&
            item.subtype !== "currency_trading" &&
            !isCurrencyTradingGroup(item) &&
            item.currency === currency &&
            !item.archived,
    );
    const selectedOffsetId = offsetId ?? equityAccounts[0]?.id ?? "";
    const blocked = busy || submitting;
    return (
        <Modal
            title={
                account
                    ? t("accounting-edit-account")
                    : t("accounting-new-account")
            }
            onClose={onClose}
            busy={blocked}
        >
            <form
                id={`account-form-${id}`}
                className="flex flex-col gap-4"
                onSubmit={(event) => {
                    event.preventDefault();
                    void run(async () => {
                        const now = Date.now();
                        await accountingStore.getState().updateData((data) => {
                            const changes = {
                                name:
                                    account && name === originalLabel
                                        ? account.name
                                        : name.trim(),
                                type,
                                currency: accountCurrency.trim(),
                                costCurrency: isCard
                                    ? (current.data.currencySettings
                                          ?.baseCurrency ?? "CNY")
                                    : costCurrency,
                                subtype: subtype.trim() || undefined,
                                parentId: parentId || undefined,
                                icon: selectedIcon,
                                paymentDisabled:
                                    type === "asset"
                                        ? paymentDisabled ||
                                          subtype === "subscription"
                                        : undefined,
                            };
                            const saved = saveAccountConfiguration(
                                data,
                                { id, ...changes },
                                now,
                                { cardCurrencyId },
                            );
                            if (account) return saved;
                            const created = saved.accounts.find(
                                (item) => item.id === id,
                            );
                            if (!created)
                                throw new Error(
                                    t("accounting-account-missing"),
                                );
                            let accounts = saved.accounts;
                            let transactions = saved.transactions;
                            if (canCreateOpeningBalance(created)) {
                                const amount = parseMoney(openingAmount);
                                if (amount !== 0) {
                                    if (!selectedOffsetId)
                                        accounts = [
                                            ...accounts,
                                            createAccount(
                                                {
                                                    id: equityId,
                                                    name: t(
                                                        "accounting-default-equity",
                                                    ),
                                                    type: "equity",
                                                    subtype: "opening_balance",
                                                    currency: created.currency,
                                                },
                                                accounts,
                                                now,
                                            ),
                                        ];
                                    const opening = createOpeningBalance(
                                        {
                                            id: crypto.randomUUID(),

                                            accountId: id,
                                            equityAccountId:
                                                selectedOffsetId || equityId,
                                            amount,
                                            time: parseBookDateTime(
                                                openingTime,
                                            ),
                                        },
                                        accounts,
                                        transactions,
                                        now,
                                    );
                                    if (opening)
                                        transactions = [
                                            ...transactions,
                                            opening,
                                        ];
                                }
                            }
                            return { ...saved, accounts, transactions };
                        }, now);
                        onSaved?.(id);
                    });
                }}
            >
                <div className="flex items-end gap-3">
                    <Button
                        type="button"
                        variant="outline"
                        className="size-16 p-4 shrink-0 rounded-lg"
                        aria-label={t("accounting-account-icon")}
                        aria-expanded={showIcons}
                        disabled={blocked}
                        onClick={() => setShowIcons((visible) => !visible)}
                    >
                        <AccountIcon
                            icon={selectedIcon}
                            className="size-full"
                        />
                    </Button>
                    <div className="flex-1 min-w-0">
                        <Field label={t("accounting-account-name")}>
                            <Input
                                value={name}
                                onChange={(event) =>
                                    setName(event.target.value)
                                }
                                required
                                autoFocus
                            />
                        </Field>
                    </div>
                </div>
                <p className="text-xs text-muted-foreground">
                    {t("accounting-account-icon-help")}
                </p>
                {showIcons && (
                    <fieldset disabled={blocked} className="min-w-0">
                        <AccountIconPicker
                            value={selectedIcon}
                            onChange={setIcon}
                            className="h-72 p-0"
                        />
                    </fieldset>
                )}
                <div className="grid grid-cols-2 gap-3">
                    <Field label={t("accounting-account-type")}>
                        <select
                            className={selectClass}
                            value={type}
                            disabled={
                                used ||
                                isTradingChild ||
                                isTradingGroup ||
                                !!fixedType
                            }
                            onChange={(event) => {
                                setType(event.target.value as AccountType);
                                setSubtype("");
                                setParentId("");
                            }}
                        >
                            {Object.entries(accountTypes).map(
                                ([value, label]) => (
                                    <option key={value} value={value}>
                                        {label}
                                    </option>
                                ),
                            )}
                        </select>
                    </Field>
                    {!isCard && (
                        <Field label={t("accounting-currency")}>
                            <select
                                aria-label={t("accounting-currency")}
                                className={selectClass}
                                value={currency}
                                disabled={
                                    used || isTradingChild || isTradingGroup
                                }
                                onChange={(event) => {
                                    setCurrency(event.target.value);
                                    setParentId("");
                                    setOffsetId(undefined);
                                }}
                                required
                            >
                                {!allCurrencies.some(
                                    (c) => c.id === currency,
                                ) && (
                                    <option value={currency}>{currency}</option>
                                )}
                                {availableCurrencies.map((c) => (
                                    <option key={c.id} value={c.id}>
                                        {c.label}
                                        {!isBaseCurrency(c.id) &&
                                            ` · ${currencyLabel(c.id)}`}
                                    </option>
                                ))}
                            </select>
                        </Field>
                    )}
                </div>
                <p className="text-xs text-muted-foreground" aria-live="polite">
                    {accountTypes[type]} — {accountTypeDescriptions[type]}
                </p>
                {used && (
                    <p className="text-xs text-muted-foreground">
                        {t("accounting-used-account-help")}
                    </p>
                )}
                <div
                    className={`grid gap-3 ${!isTradingChild && !isTradingGroup ? "grid-cols-2" : "grid-cols-1"}`}
                >
                    <Field label={t("accounting-parent-account")}>
                        <select
                            className={selectClass}
                            value={parentId}
                            disabled={isTradingChild || isTradingGroup}
                            onChange={(event) =>
                                setParentId(event.target.value)
                            }
                        >
                            <option value="">
                                {t("accounting-standalone-account")}
                            </option>
                            {parents.map((item) => (
                                <option key={item.id} value={item.id}>
                                    {labelAccount(item)}
                                </option>
                            ))}
                        </select>
                    </Field>
                    {!isTradingChild && !isTradingGroup && (
                        <Field label={t("accounting-account-subtype")}>
                            <select
                                className={selectClass}
                                value={subtype}
                                disabled={
                                    used &&
                                    (account?.subtype === "prepaid" ||
                                        account?.subtype === "currency_trading")
                                }
                                onChange={(event) => {
                                    setSubtype(event.target.value);
                                    if (event.target.value === "subscription")
                                        setPaymentDisabled(true);
                                    if (event.target.value)
                                        setOpeningAmount("0");
                                    if (!used) setParentId("");
                                }}
                            >
                                <option value="">
                                    {t("accounting-ordinary-account")}
                                </option>
                                {(type === "asset" ||
                                    subtype === "prepaid") && (
                                    <option value="prepaid">
                                        {t("accounting-recharge-card")}
                                    </option>
                                )}

                                {(type === "asset" ||
                                    subtype === "fixed_asset") && (
                                    <option value="fixed_asset">
                                        {t("accounting-fixed-asset")}
                                    </option>
                                )}
                                {(type === "asset" ||
                                    subtype === "subscription") && (
                                    <option value="subscription">
                                        {t("accounting-subscription-asset")}
                                    </option>
                                )}
                                {type === "liability" && (
                                    <>
                                        <option value="credit_card">
                                            {t("accounting-credit-card")}
                                        </option>
                                        <option value="loan">
                                            {t("accounting-loan")}
                                        </option>
                                        <option value="payable">
                                            {t("accounting-payable")}
                                        </option>
                                    </>
                                )}
                                {subtype &&
                                    subtype !== "fixed_asset" &&
                                    subtype !== "prepaid" &&
                                    subtype !== "subscription" &&
                                    !(
                                        type === "liability" &&
                                        [
                                            "credit_card",
                                            "loan",
                                            "payable",
                                        ].includes(subtype)
                                    ) && (
                                        <option value={subtype}>
                                            {subtype === "currency_trading"
                                                ? t(
                                                      "accounting-exchange-clearing",
                                                      {
                                                          currency,
                                                      },
                                                  )
                                                : subtype === "opening_balance"
                                                  ? t(
                                                        "accounting-opening-equity",
                                                    )
                                                  : subtype === "prepaid"
                                                    ? t(
                                                          "accounting-prepaid-account",
                                                      )
                                                    : t(
                                                          "accounting-other-purpose",
                                                      )}
                                        </option>
                                    )}
                            </select>
                        </Field>
                    )}
                </div>
                {(isTradingChild || isTradingGroup) && (
                    <p className="text-xs text-muted-foreground">
                        {t("accounting-exchange-group-help")}
                    </p>
                )}
                {type === "asset" && (
                    <label className="flex items-center gap-2 text-sm">
                        <input
                            type="checkbox"
                            checked={
                                paymentDisabled || subtype === "subscription"
                            }
                            disabled={blocked || subtype === "subscription"}
                            onChange={(event) =>
                                setPaymentDisabled(event.target.checked)
                            }
                        />
                        {t("accounting-payment-disabled")}
                    </label>
                )}
                {isCard && (
                    <p className="text-xs text-muted-foreground">
                        {t("accounting-recharge-card-help")}
                    </p>
                )}
                {subtype === "fixed_asset" && (
                    <p className="text-xs text-muted-foreground">
                        {t("accounting-purchase-depreciation-account-help")}
                    </p>
                )}
                {!account && supportsOpeningBalance && (
                    <fieldset className="border rounded-lg p-3 flex flex-col gap-3">
                        <legend className="text-sm px-1">
                            {t("accounting-opening-balance")}
                        </legend>
                        {type === "asset" && (
                            <div className="space-y-2 text-xs text-muted-foreground">
                                <p>{t("accounting-opening-asset-help")}</p>
                                <p>
                                    {t("accounting-opening-asset-equity-help")}
                                </p>
                            </div>
                        )}
                        <Field label={t("accounting-opening-amount")}>
                            <Input
                                inputMode="decimal"
                                value={openingAmount}
                                onChange={(event) =>
                                    setOpeningAmount(event.target.value)
                                }
                            />
                        </Field>
                        <Field label={t("accounting-opening-date")}>
                            <Input
                                type="datetime-local"
                                value={openingTime}
                                onChange={(event) =>
                                    setOpeningTime(event.target.value)
                                }
                                required
                            />
                        </Field>
                        <Field label={t("accounting-opening-equity-account")}>
                            <select
                                className={selectClass}
                                value={selectedOffsetId}
                                onChange={(event) =>
                                    setOffsetId(event.target.value)
                                }
                            >
                                <option value="">
                                    {t("accounting-create-opening-equity")}
                                </option>
                                {equityAccounts.map((item) => (
                                    <option key={item.id} value={item.id}>
                                        {labelAccount(item)}
                                    </option>
                                ))}
                            </select>
                        </Field>
                    </fieldset>
                )}
                <FormError error={error} />
            </form>
            <Button
                form={`account-form-${id}`}
                className="w-full mt-4"
                type="submit"
                disabled={blocked}
            >
                {blocked
                    ? t("accounting-saving")
                    : t("accounting-save-account")}
            </Button>
        </Modal>
    );
}
