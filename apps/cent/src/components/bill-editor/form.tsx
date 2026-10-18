import { RadioGroup } from "radix-ui";
import { useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { useCurrency } from "@/hooks/use-currency";
import { useWheelScrollX } from "@/hooks/use-wheel-scroll";
import { decodeApiKey } from "@/utils/api-key";
import PopupLayout from "../../layouts/popup-layout";
import {
    amountToDecimal,
    canReclassifyTransaction,
    createCurrencyExpense,
    createJournalTransaction,
    createTransaction,
    type Entry,
    getCurrencyExpenseCategory,
    getCurrencyExpenseEstimate,
    getEditableJournalInput,
    getEditableTransactionInput,
    getPurchaseAsset,
    getPurchaseDepreciation,
    type JournalTransactionInput,
    type JournalType,
    resolveCurrencyCostAccounts,
    resolvePurchaseEndDate,
    saveDepreciatingPurchase,
    type Transaction,
    type TransactionImage,
    type TransactionLocation,
    updateJournalTransaction,
} from "../../ledger/accounting";
import { getCurrencyExchangeAmounts } from "../../ledger/accounting/currency-exchange";
import { isCurrencyTradingGroup } from "../../ledger/accounting/currency-trading";
import {
    canEditFundingTransaction,
    saveFundingTransaction,
} from "../../ledger/accounting/funding";
import { accountingStore } from "../../store/accounting";
import { usePreferenceStore } from "../../store/preference";
import { bookDayjs, formatTime, parseBookDateTime } from "../../utils/time";
import AccountForm from "../accounting/account-form";
import { showAccountManager } from "../accounting/account-manager";
import AccountPicker from "../accounting/account-picker";
import { orderPickerAccounts } from "../accounting/account-picker-tree";
import {
    appendAmountKey,
    calculateAmount,
} from "../accounting/amount-calculator";
import ExchangeFields, {
    type ExchangeDraft,
} from "../accounting/exchange-fields";
import { useAccountingLabels } from "../accounting/i18n";
import {
    createTemplateDraft,
    draftToEntries,
    entriesToDraft,
    getDraftTotals,
    getPairedTemplateAccounts,
    isPairedTemplate,
    type JournalDraftEntry,
    type JournalTemplate,
    matchesPairedTemplate,
} from "../accounting/journal-editor";
import JournalFields from "../accounting/journal-fields";
import PairedJournalFields from "../accounting/paired-journal-fields";
import {
    currencyLabel,
    dateInput,
    FormError,
    money,
    parseMoney,
    useFormAction,
} from "../accounting/shared";
import { readTransactionImage } from "../accounting/transaction-image";
import { showTagList } from "../bill-tag";
import { DatePicker } from "../date-picker";
import Deletable from "../deletable";
import { FORMAT_IMAGE_SUPPORTED, showFilePicker } from "../file-picker";
import SmartImage from "../image";
import Calculator from "../keyboard";
import {
    LocationPickerProvider,
    showLocationPicker,
} from "../map/location-picker";
import CurrentLocation from "../simple-location";
import { Button } from "../ui/button";
import { getQuickModeDraft } from "./mode";
import ResizeHandle from "./resize";
import TagGroupSelector from "./tag-group";

type EditorMode = "expense" | "income" | "configuration";
const modes: EditorMode[] = ["expense", "income", "configuration"];
const modeClasses = {
    expense: "data-[state=checked]:bg-semantic-expense",
    income: "data-[state=checked]:bg-semantic-income",
    configuration: "data-[state=checked]:bg-slate-700",
};

export default function EditorForm({
    edit: transaction,
    onCancel,
    onConfirm,
}: {
    edit?: Transaction;
    onCancel?: () => void;
    onConfirm?: () => void;
}) {
    const { t, transactionTypes } = useAccountingLabels();
    const { current, busy } = useStore(accountingStore);
    const { multiCurrency } = useCurrency();
    const allowMultiCurrency =
        multiCurrency ||
        (!!transaction &&
            ["currency_exchange", "topup"].includes(transaction.type)) ||
        (!!transaction &&
            transaction.currency !==
                (current?.data.currencySettings?.baseCurrency ?? "CNY"));
    const keyboardHeight = usePreferenceStore(
        (state) => state.keyboardHeight ?? 50,
    );
    const initialInput =
        transaction &&
        getEditableTransactionInput(transaction, current?.data.accounts ?? []);
    const initialJournal =
        transaction &&
        getEditableJournalInput(transaction, current?.data.accounts ?? []);
    const initialExpenseAccount =
        initialInput?.type === "expense"
            ? current?.data.accounts.find(
                  (account) => account.id === initialInput.expenseAccountId,
              )
            : undefined;
    const initialExpenseCategory = initialExpenseAccount
        ? getCurrencyExpenseCategory(
              initialExpenseAccount,
              current?.data.accounts ?? [],
          )
        : undefined;
    const initialExchange =
        transaction?.exchange &&
        ["currency_exchange", "topup"].includes(transaction.type)
            ? transaction.exchange
            : transaction?.type === "topup" && initialInput?.type === "topup"
              ? {
                    fromAccountId: initialInput.fromAccountId,
                    toAccountId: initialInput.toAccountId,
                }
              : undefined;
    const initialExchangeAmounts = transaction?.exchange
        ? getCurrencyExchangeAmounts(transaction)
        : initialExchange && initialInput
          ? {
                withdrawn: initialInput.amount,
                received: initialInput.amount,
                fee: 0,
            }
          : undefined;
    const [exchangeDraft, setExchangeDraft] = useState<ExchangeDraft>({
        fromAccountId: initialExchange?.fromAccountId ?? "",
        toAccountId: initialExchange?.toAccountId ?? "",
        received: initialExchange
            ? amountToDecimal(initialExchangeAmounts?.received ?? 0)
            : "",
        fee: initialExchange
            ? amountToDecimal(initialExchangeAmounts?.fee ?? 0)
            : "",
        feeAccountId: transaction?.exchange?.feeAccountId ?? "",
    });
    const [exchangeActiveAmount, setExchangeActiveAmount] = useState<
        "withdrawn" | "received" | "fee"
    >("withdrawn");
    const [id, setId] = useState(() => transaction?.id ?? crypto.randomUUID());
    const [mode, setMode] = useState<EditorMode>(
        initialInput?.type === "expense" || initialInput?.type === "income"
            ? initialInput.type
            : transaction
              ? "configuration"
              : "expense",
    );
    const [currency, setCurrency] = useState(
        (initialInput?.type === "expense"
            ? current?.data.accounts.find(
                  (account) => account.id === initialInput.paymentAccountId,
              )?.currency
            : undefined) ??
            transaction?.currency ??
            current?.data.currencySettings?.baseCurrency ??
            current?.data.accounts.find(
                (account) => !account.archived && account.type === "asset",
            )?.currency ??
            "CNY",
    );
    const [leftId, setLeftId] = useState(
        initialInput?.type === "income"
            ? initialInput.depositAccountId
            : initialInput?.type === "expense"
              ? initialInput.paymentAccountId
              : "",
    );
    const [rightId, setRightId] = useState(
        initialInput?.type === "income"
            ? initialInput.incomeAccountId
            : initialInput?.type === "expense"
              ? initialExpenseCategory
                  ? initialExpenseCategory.archived
                      ? (initialExpenseAccount?.id ?? initialExpenseCategory.id)
                      : initialExpenseCategory.id
                  : initialInput.expenseAccountId
              : "",
    );
    const [quickAmount, setQuickAmount] = useState(
        initialExchange
            ? amountToDecimal(initialExchangeAmounts?.withdrawn ?? 0)
            : initialInput
              ? amountToDecimal(initialInput.amount)
              : "",
    );
    const [rows, setRows] = useState<JournalDraftEntry[]>(() =>
        initialJournal
            ? entriesToDraft(initialJournal.entries)
            : createTemplateDraft(
                  "transfer",
                  (current?.data.accounts ?? []).filter(
                      (account) => account.currency === currency,
                  ),
                  "",
                  () => crypto.randomUUID(),
              ),
    );
    const [activeId, setActiveId] = useState("");
    const [journalType, setJournalType] = useState<JournalType>(
        initialJournal?.type ?? "transfer",
    );
    const [template, setTemplate] = useState<JournalTemplate>(() => {
        if (initialExchange) return "currency_exchange";
        const type = initialJournal?.type;
        if (!initialJournal) return transaction ? "custom" : "transfer";
        if (
            (type === "asset_purchase" ||
                type === "liability_payment" ||
                type === "transfer" ||
                type === "liability_borrowing") &&
            !matchesPairedTemplate(
                type,
                entriesToDraft(initialJournal.entries),
                (current?.data.accounts ?? []).map((account) => ({
                    ...account,
                    paymentDisabled: false,
                })),
            )
        )
            return "custom";
        return type === "asset_purchase" ||
            type === "liability_payment" ||
            type === "transfer" ||
            type === "liability_borrowing"
            ? type
            : "custom";
    });
    const [time, setTime] = useState(() =>
        dateInput(transaction?.time ?? Date.now()),
    );
    const originalDepreciation =
        transaction &&
        getPurchaseDepreciation(
            transaction.id,
            current?.data.transactions ?? [],
        );
    const originalPurchase =
        transaction &&
        getPurchaseAsset(transaction, current?.data.accounts ?? []);
    const [periodEnabled, setPeriodEnabled] = useState(!!originalDepreciation);
    const [serviceEnd, setServiceEnd] = useState(
        originalDepreciation?.endTime
            ? dateInput(originalDepreciation.endTime).slice(0, 10)
            : "",
    );
    const [residual, setResidual] = useState(() =>
        amountToDecimal(
            originalPurchase && originalDepreciation
                ? originalPurchase.cost +
                      (originalDepreciation?.entries.find(
                          (entry) =>
                              entry.accountId === originalPurchase.asset.id,
                      )?.amount ?? 0)
                : 0,
        ),
    );
    const [depreciationMonths, setDepreciationMonths] = useState(() => {
        if (!originalDepreciation?.endTime) return "1";
        const start = bookDayjs(originalDepreciation.time),
            end = bookDayjs(originalDepreciation.endTime);
        return String(
            Math.max(
                1,
                (end.year() - start.year()) * 12 + end.month() - start.month(),
            ),
        );
    });
    const defaultServiceEnd = resolvePurchaseEndDate(time.slice(0, 10), 1);
    const [description, setDescription] = useState(
        transaction?.description ?? "",
    );
    const [images, setImages] = useState<TransactionImage[]>(
        () => transaction?.images?.map((image) => ({ ...image })) ?? [],
    );
    const [location, setLocation] = useState<TransactionLocation | null>(
        transaction?.location ? { ...transaction.location } : null,
    );
    const [mediaError, setMediaError] = useState<string>();
    const [addingImages, setAddingImages] = useState(false);
    const [managingLocation, setManagingLocation] = useState(false);
    const locationRef = useRef<HTMLButtonElement>(null);
    useEffect(() => {
        if (!transaction && usePreferenceStore.getState().autoLocateWhenAddBill)
            locationRef.current?.click();
    }, [transaction]);
    const addImages = async () => {
        setAddingImages(true);
        setMediaError(undefined);
        try {
            const files = await showFilePicker({
                accept: FORMAT_IMAGE_SUPPORTED,
                multiple: true,
            });
            if (files.length > 3 - images.length)
                throw new Error(t("accounting-images-limit"));
            const added = await Promise.all(
                files.map((file) =>
                    readTransactionImage(file, crypto.randomUUID()),
                ),
            );
            setImages((previous) => [...previous, ...added]);
        } catch (failure) {
            setMediaError(
                failure instanceof Error &&
                    failure.message === t("accounting-images-limit")
                    ? failure.message
                    : t("accounting-images-failed"),
            );
        } finally {
            setAddingImages(false);
        }
    };
    const editLocation = async () => {
        const config = current?.data.mapConfig;
        if (!location || !config?.amapKey || !config.amapSecurityCode) {
            setMediaError(t("accounting-map-config-required"));
            return;
        }
        setManagingLocation(true);
        try {
            const selected = await showLocationPicker({
                location,
                amapKey: decodeApiKey(config.amapKey),
                amapSecurityCode: decodeApiKey(config.amapSecurityCode),
            });
            if (selected) setLocation(selected);
        } catch {
            /* 取消选择不修改位置。 */
        } finally {
            setManagingLocation(false);
        }
    };
    const [tagIds, setTagIds] = useState<string[] | undefined>(
        transaction ? [...(transaction.tagIds ?? [])] : undefined,
    );
    const tagSelectorRef = useRef<HTMLDivElement>(null);
    useWheelScrollX(tagSelectorRef);
    const [amountFocused, setAmountFocused] = useState(true);
    const [newFixedAsset, setNewFixedAsset] = useState(false);
    const [newExchangeAsset, setNewExchangeAsset] = useState(false);
    const [managingTags, setManagingTags] = useState(false);
    const [calculatorError, setCalculatorError] = useState<string>();
    const { error, submitting, run } = useFormAction();
    const blocked = busy || submitting || addingImages;
    const configuring = mode === "configuration";
    const exchanging = configuring && template === "currency_exchange";
    const paired =
        configuring &&
        isPairedTemplate(template) &&
        rows.length === 2 &&
        rows.filter((row) => row.side === "credit").length === 1 &&
        rows.filter((row) => row.side === "debit").length === 1;
    const exchangeFrom = current?.data.accounts.find(
        (a) => a.id === exchangeDraft.fromAccountId,
    );
    const exchangeTo = current?.data.accounts.find(
        (a) => a.id === exchangeDraft.toAccountId,
    );
    const activeRow = rows.find((row) => row.id === activeId) ?? rows[0];
    const amount =
        configuring && !exchanging ? (activeRow?.amount ?? "") : quickAmount;
    const setAmount = (value: string) => {
        if (configuring && !exchanging) {
            setRows((previous) =>
                previous.map((row) =>
                    paired || row.id === activeRow?.id
                        ? { ...row, amount: value }
                        : row,
                ),
            );
        } else setQuickAmount(value);
    };
    const accounts = resolveCurrencyCostAccounts(
        current?.data.accounts ?? [],
        current?.data.transactions ?? [],
        current?.data.currencySettings?.baseCurrency,
    )
        .filter(
            (account) =>
                !account.archived &&
                (account.subtype !== "prepaid" || !!account.costCurrency) &&
                account.subtype !== "currency_trading" &&
                !isCurrencyTradingGroup(account),
        )
        .map((account) =>
            transaction?.entries.some((entry) => entry.accountId === account.id)
                ? { ...account, paymentDisabled: false }
                : account,
        );
    const currencies = [
        ...new Set(accounts.map((account) => account.currency)),
    ].sort((leftCurrency, rightCurrency) => {
        const quick = current?.data.currencySettings?.quickCurrencies ?? [];
        const rank = (value: string) => {
            const index = quick.indexOf(value);
            return index === -1 ? quick.length : index;
        };
        return (
            rank(leftCurrency) - rank(rightCurrency) ||
            leftCurrency.localeCompare(rightCurrency)
        );
    });
    const eligible = accounts.filter(
        (account) => account.currency === currency,
    );
    const leftAccounts = accounts.filter(
        (account) =>
            (account.type === "asset" &&
                (mode !== "expense" || !account.paymentDisabled)) ||
            (mode === "expense" && account.type === "liability"),
    );
    const left = leftId
        ? (leftAccounts.find((account) => account.id === leftId)?.id ?? "")
        : (leftAccounts.find(
              (account) =>
                  account.currency === currency &&
                  account.presetKey === "starter:asset",
          )?.id ??
          leftAccounts.find((account) => account.currency === currency)?.id ??
          leftAccounts[0]?.id ??
          "");
    const payment = accounts.find((account) => account.id === left);
    const paymentCurrency =
        paired && isPairedTemplate(template)
            ? getPairedTemplateAccounts(template, rows, accounts).from?.currency
            : payment?.currency;
    useEffect(() => {
        if (
            (!configuring || paired) &&
            paymentCurrency &&
            paymentCurrency !== currency
        )
            setCurrency(paymentCurrency);
    }, [configuring, paired, paymentCurrency, currency]);
    let expenseEstimate: ReturnType<typeof getCurrencyExpenseEstimate>;
    if (!configuring && mode === "expense" && payment?.costCurrency) {
        try {
            expenseEstimate = getCurrencyExpenseEstimate(
                left,
                parseMoney(calculateAmount(amount)),
                current?.data.accounts ?? [],
                current?.data.transactions ?? [],
                {
                    id,
                    time:
                        transaction && time === dateInput(transaction.time)
                            ? transaction.time
                            : parseBookDateTime(time),
                    createdAt: transaction?.createdAt ?? Date.now(),
                },
                current?.data.currencySettings?.baseCurrency,
            );
        } catch {
            /* 草稿金额和缺少成本依据时不猜测预览。 */
        }
    }
    const rightAccounts = accounts.filter(
        (account) =>
            account.type === mode &&
            (getCurrencyExpenseCategory(account, accounts).id === account.id ||
                getCurrencyExpenseCategory(account, accounts).archived) &&
            (account.currency === currency ||
                (mode === "expense" &&
                    account.currency === payment?.costCurrency)),
    );
    const right =
        rightAccounts.find((account) => account.id === rightId)?.id ??
        orderPickerAccounts(rightAccounts)[0]?.id ??
        rightAccounts[0]?.id ??
        "";
    const canUseQuick =
        !transaction ||
        canReclassifyTransaction(transaction, current?.data.accounts ?? []);
    let journalReady = false;
    try {
        journalReady =
            rows.length >= 2 &&
            getDraftTotals(rows).difference === 0 &&
            rows.every((row) =>
                eligible.some(
                    (account) =>
                        account.id === row.accountId &&
                        !(
                            template === "custom" &&
                            row.side === "credit" &&
                            account.type === "asset" &&
                            account.paymentDisabled
                        ),
                ),
            ) &&
            new Set(rows.map((row) => row.accountId)).size >= 2;
        if (
            configuring &&
            isPairedTemplate(template) &&
            !matchesPairedTemplate(template, rows, accounts)
        )
            journalReady = false;
    } catch {
        /* 草稿允许尚未填完。 */
    }
    let exchangeReady = false;
    let executionRate: number | undefined;
    try {
        const withdrawn = parseMoney(calculateAmount(quickAmount));
        const received = parseMoney(calculateAmount(exchangeDraft.received));
        const fee = exchangeDraft.fee.trim()
            ? parseMoney(calculateAmount(exchangeDraft.fee))
            : 0;
        const feeAccount = accounts.find(
            (a) => a.id === exchangeDraft.feeAccountId,
        );
        exchangeReady =
            !!exchangeFrom &&
            !!exchangeTo &&
            ["asset", "liability"].includes(exchangeFrom.type) &&
            exchangeTo.type === "asset" &&
            !exchangeFrom.archived &&
            (!exchangeFrom.paymentDisabled ||
                transaction?.exchange?.fromAccountId === exchangeFrom.id) &&
            !exchangeTo.archived &&
            exchangeFrom.id !== exchangeTo.id &&
            (exchangeFrom.currency !== exchangeTo.currency ||
                (exchangeFrom.type === "asset" &&
                    withdrawn === received &&
                    fee === 0)) &&
            withdrawn > fee &&
            received > 0 &&
            fee >= 0 &&
            (!fee ||
                (feeAccount?.type === "expense" &&
                    feeAccount.currency === exchangeFrom.currency));
        if (exchangeReady && exchangeFrom?.currency !== exchangeTo?.currency)
            executionRate = received / (withdrawn - fee);
    } catch {
        /* 草稿允许未填写。 */
    }
    const canSave = configuring
        ? exchanging
            ? exchangeReady &&
              (!transaction ||
                  canEditFundingTransaction(
                      transaction,
                      current?.data.accounts ?? [],
                  ))
            : journalReady && canUseQuick
        : !!left && !!right && canUseQuick;
    const switchMode = (value: EditorMode) => {
        if (value === "configuration" && mode !== "configuration") {
            setRows([
                {
                    id:
                        rows.find((row) => row.side === "debit")?.id ??
                        crypto.randomUUID(),
                    side: "debit",
                    accountId: mode === "expense" ? right : left,
                    amount: quickAmount,
                },
                {
                    id:
                        rows.find((row) => row.side === "credit")?.id ??
                        crypto.randomUUID(),
                    side: "credit",
                    accountId: mode === "expense" ? left : right,
                    amount: quickAmount,
                },
            ]);
            setTemplate("custom");
            setJournalType(mode === "income" ? "income" : "expense");
            setActiveId("");
        }
        if (value !== "configuration") {
            if (configuring) {
                let entries: Entry[] = [];
                try {
                    entries = exchanging
                        ? [
                              {
                                  accountId: exchangeDraft.fromAccountId,
                                  amount: -parseMoney(
                                      calculateAmount(quickAmount),
                                  ),
                              },
                              {
                                  accountId: exchangeDraft.toAccountId,
                                  amount: parseMoney(
                                      calculateAmount(exchangeDraft.received),
                                  ),
                              },
                          ]
                        : draftToEntries(rows);
                } catch {
                    // An incomplete draft may still switch modes; its amount remains editable.
                }
                const draft = getQuickModeDraft(value, entries, accounts);
                setLeftId(draft.leftId);
                setRightId(draft.rightId);
                setQuickAmount(draft.amount);
                if (draft.currency) setCurrency(draft.currency);
            } else {
                if (
                    leftId &&
                    !eligible.some(
                        (account) =>
                            account.id === leftId &&
                            (account.type === "asset" ||
                                (value === "expense" &&
                                    account.type === "liability")),
                    )
                )
                    setLeftId("");
                if (
                    rightId &&
                    !eligible.some(
                        (account) =>
                            account.id === rightId && account.type === value,
                    )
                )
                    setRightId("");
            }
        }
        setMode(value);
        setCalculatorError(undefined);
    };
    const selectTemplate = (value: JournalTemplate) => {
        setTemplate(value);
        if (value !== "asset_purchase") setPeriodEnabled(false);
        setJournalType(
            value === "custom" || value === "currency_exchange"
                ? "journal"
                : value === "depreciation"
                  ? "expense"
                  : value,
        );
        if (value === "currency_exchange") {
            if (!exchangeDraft.fromAccountId) {
                const asset =
                    accounts.find(
                        (a) =>
                            a.id === left &&
                            a.type === "asset" &&
                            !a.paymentDisabled,
                    ) ??
                    accounts.find(
                        (a) => a.type === "asset" && !a.paymentDisabled,
                    );
                if (asset) {
                    setExchangeDraft((previous) => ({
                        ...previous,
                        fromAccountId: asset.id,
                    }));
                    setCurrency(asset.currency);
                }
            }
        } else if (value !== "custom") {
            const next = createTemplateDraft(value, eligible, amount, () =>
                crypto.randomUUID(),
            );
            setRows(next);
            setActiveId(next[0].id);
        }
    };
    const save = (again = false) =>
        run(async () => {
            const now = Date.now();
            await accountingStore.getState().updateData((data) => {
                const common = {
                    id,
                    currency,
                    ...(transaction?.endTime === undefined
                        ? {}
                        : { endTime: transaction.endTime }),
                    time:
                        transaction && time === dateInput(transaction.time)
                            ? transaction.time
                            : parseBookDateTime(time),
                    description: description.trim() || undefined,
                    parentTransactionId: transaction?.parentTransactionId,
                    creatorId: transaction?.creatorId,
                    tagIds,
                    images,
                    location,
                };
                const history = data.transactions.filter(
                    (item) => item.id !== transaction?.id,
                );
                const replace = (
                    saved: Transaction,
                    accounts = data.accounts,
                ) =>
                    originalDepreciation && saved.type !== "asset_purchase"
                        ? saveDepreciatingPurchase(
                              { ...data, accounts },
                              saved,
                              undefined,
                              now,
                              () => crypto.randomUUID(),
                              t("accounting-depreciation-expense"),
                          )
                        : {
                              ...data,
                              accounts,
                              transactions: [...history, saved],
                          };
                if (exchanging) {
                    if (!exchangeFrom)
                        throw new Error(t("accounting-journal-select-account"));
                    const input = {
                        ...common,
                        ...exchangeDraft,
                        withdrawn: parseMoney(calculateAmount(quickAmount)),
                        received: parseMoney(
                            calculateAmount(exchangeDraft.received),
                        ),
                        fee: exchangeDraft.fee.trim()
                            ? parseMoney(calculateAmount(exchangeDraft.fee))
                            : 0,
                    };
                    const trading = {
                        fromId: crypto.randomUUID(),
                        toId: crypto.randomUUID(),
                        name: currencyLabel,
                        groupId: crypto.randomUUID(),
                        groupName: t("accounting-exchange-group"),
                        baseCurrency: data.currencySettings?.baseCurrency,
                    };
                    const saved = saveFundingTransaction(
                        input,
                        data.accounts,
                        data.transactions,
                        now,
                        trading,
                        !!transaction,
                    );
                    return replace(saved.transaction, saved.accounts);
                }
                let input: JournalTransactionInput;
                if (
                    !configuring &&
                    mode === "expense" &&
                    payment?.type === "asset"
                ) {
                    const saved = createCurrencyExpense(
                        {
                            ...common,
                            type: "expense",
                            amount: parseMoney(calculateAmount(amount)),
                            paymentAccountId: left,
                            expenseAccountId: right,
                        },
                        data.accounts,
                        data.transactions,
                        now,
                        {
                            edit: !!transaction,
                            baseCurrency: data.currencySettings?.baseCurrency,
                        },
                    );
                    return replace(saved.transaction, saved.accounts);
                }
                if (configuring) {
                    input = {
                        ...common,
                        type: journalType,
                        entries: draftToEntries(rows),
                    };
                } else {
                    if (!canUseQuick)
                        throw new Error(t("accounting-journal-complex-edit"));
                    const parsedAmount = parseMoney(calculateAmount(amount));
                    const candidate = createTransaction(
                        mode === "expense"
                            ? {
                                  ...common,
                                  type: "expense",
                                  amount: parsedAmount,
                                  paymentAccountId: left,
                                  expenseAccountId: right,
                              }
                            : {
                                  ...common,
                                  type: "income",
                                  amount: parsedAmount,
                                  depositAccountId: left,
                                  incomeAccountId: right,
                              },
                        data.accounts,
                        history,
                        now,
                    );
                    input = {
                        ...common,
                        type: candidate.type as JournalType,
                        entries: candidate.entries,
                    };
                }
                const saved = transaction
                    ? updateJournalTransaction(
                          input,
                          data.accounts,
                          data.transactions,
                          now,
                      )
                    : createJournalTransaction(
                          input,
                          data.accounts,
                          history,
                          now,
                      );
                if (
                    (configuring && template === "asset_purchase") ||
                    originalDepreciation
                ) {
                    return saveDepreciatingPurchase(
                        data,
                        saved,
                        configuring &&
                            template === "asset_purchase" &&
                            periodEnabled
                            ? {
                                  endTime: parseBookDateTime(
                                      `${serviceEnd || defaultServiceEnd}T00:00:00`,
                                  ),
                                  residualValue: parseMoney(residual),
                              }
                            : undefined,
                        now,
                        () => crypto.randomUUID(),
                        t("accounting-depreciation-expense"),
                    );
                }
                return { ...data, transactions: [...history, saved] };
            }, now);
            if (again) {
                setId(crypto.randomUUID());
                setPeriodEnabled(false);
                setServiceEnd("");
                setResidual("0");
                setQuickAmount("");
                setExchangeDraft((previous) => ({
                    ...previous,
                    received: "",
                    fee: "",
                }));
                setRows((previous) =>
                    previous.map((row) => ({
                        ...row,
                        id: crypto.randomUUID(),
                        amount: "",
                    })),
                );
                setActiveId("");
                setDescription("");
                setImages([]);
                setLocation(null);
                setMediaError(undefined);
                setCalculatorError(undefined);
            } else onConfirm?.();
        });
    const pressKey = (raw: string) => {
        const key =
            (
                { c: "backspace", r: "again", x: "×", "-": "−" } as Record<
                    string,
                    string
                >
            )[raw] ?? raw;
        if (key === "again") {
            if (transaction) {
                if (exchanging) {
                    setQuickAmount("");
                    setExchangeDraft((previous) => ({
                        ...previous,
                        received: "",
                        fee: "",
                    }));
                    setExchangeActiveAmount("withdrawn");
                } else if (configuring)
                    setRows((previous) =>
                        previous.map((row) => ({ ...row, amount: "" })),
                    );
                else setQuickAmount("");
                setCalculatorError(undefined);
            } else void save(true);
            return;
        }
        try {
            if (exchanging && exchangeActiveAmount !== "withdrawn") {
                const value = appendAmountKey(
                    exchangeDraft[exchangeActiveAmount],
                    key,
                );
                setExchangeDraft((previous) => ({
                    ...previous,
                    [exchangeActiveAmount]: value,
                }));
            } else setAmount(appendAmountKey(amount, key));
            setCalculatorError(undefined);
        } catch (failure) {
            setCalculatorError(
                failure instanceof Error
                    ? failure.message
                    : t("accounting-calculation-failed"),
            );
        }
    };
    useEffect(() => {
        if (
            !amountFocused ||
            blocked ||
            newFixedAsset ||
            newExchangeAsset ||
            managingTags ||
            managingLocation
        )
            return;
        const onKey = (event: KeyboardEvent) => {
            if (
                event.target instanceof HTMLInputElement ||
                event.target instanceof HTMLSelectElement ||
                event.ctrlKey ||
                event.metaKey ||
                event.altKey ||
                (event.target instanceof Element &&
                    event.target.closest(
                        '[data-tag-selector], [role="menu"], [data-slot="popover-content"]',
                    ))
            )
                return;
            const key = event.key;
            if (
                key === "Enter" &&
                event.target instanceof Element &&
                event.target.closest('[role="radiogroup"]')
            )
                return;
            if (
                /^[\d.+\-=*/]$/.test(key) ||
                key === "Backspace" ||
                key === "Enter"
            ) {
                event.preventDefault();
                if (key === "Enter") {
                    if (canSave) void save();
                } else
                    pressKey(
                        (
                            { Backspace: "c", "*": "x", "/": "÷" } as Record<
                                string,
                                string
                            >
                        )[key] ?? key,
                    );
            }
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    });
    if (!current) return null;
    const liveParent = current.data.transactions.find(
        (item) => item.id === transaction?.id,
    );
    return (
        <PopupLayout
            className="h-full gap-2 pb-0 scrollbar-hidden"
            onBack={() => {
                if (!blocked) onCancel?.();
            }}
            title={
                <fieldset
                    disabled={blocked}
                    className="pl-[54px] min-w-0 w-full min-h-12 rounded-lg flex gap-2 pt-2 pb-0 overflow-hidden"
                    aria-label={t("accounting-type-amount")}
                >
                    <RadioGroup.Root
                        aria-label={t("accounting-entry-mode")}
                        orientation="horizontal"
                        value={mode}
                        disabled={blocked}
                        onValueChange={(value) => {
                            const selected = modes.find(
                                (item) => item === value,
                            );
                            if (selected) switchMode(selected);
                        }}
                        className="w-36 sm:w-48 h-12 grid grid-cols-3 gap-1 rounded-lg bg-stone-900 p-1 shrink-0"
                    >
                        {modes.map((value) => (
                            <RadioGroup.Item
                                key={value}
                                value={value}
                                disabled={
                                    blocked ||
                                    (value !== "configuration" && !canUseQuick)
                                }
                                className={
                                    "min-w-0 min-h-10 rounded-md px-0.5 text-[10px] sm:text-xs text-white/70 data-[state=checked]:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 " +
                                    modeClasses[value]
                                }
                            >
                                {value === "configuration"
                                    ? t("accounting-configuration")
                                    : transactionTypes[value]}
                            </RadioGroup.Item>
                        ))}
                    </RadioGroup.Root>
                    <div className="flex-1 min-w-0 flex bg-stone-400 rounded-lg px-2 relative items-center">
                        {(currencies.length > 1 ||
                            currency !==
                                (current?.data.currencySettings?.baseCurrency ??
                                    "CNY") ||
                            exchanging) &&
                            (configuring && template === "custom" ? (
                                <select
                                    aria-label={t("accounting-currency")}
                                    className="w-10 sm:w-12 shrink-0 bg-transparent text-white text-[10px] sm:text-xs"
                                    value={currency}
                                    disabled={exchanging || !allowMultiCurrency}
                                    onChange={(event) => {
                                        setCurrency(event.target.value);
                                        setLeftId("");
                                        setRightId("");
                                        setRows((previous) =>
                                            previous.map((row) => ({
                                                ...row,
                                                accountId: "",
                                            })),
                                        );
                                    }}
                                >
                                    {(currencies.length
                                        ? currencies
                                        : [currency]
                                    ).map((value) => (
                                        <option
                                            key={value}
                                            value={value}
                                            className="text-foreground bg-background"
                                        >
                                            {currencyLabel(value)}
                                        </option>
                                    ))}
                                </select>
                            ) : (
                                <output
                                    aria-label={t("accounting-currency")}
                                    title={currencyLabel(currency)}
                                    className="max-w-24 truncate shrink-0 text-white text-xs"
                                >
                                    {currencyLabel(currency)}
                                </output>
                            ))}
                        <input
                            aria-label={
                                exchanging
                                    ? t("accounting-exchange-withdrawn")
                                    : t("accounting-amount")
                            }
                            value={amount}
                            inputMode="decimal"
                            placeholder="0.00"
                            className={`flex-1 min-w-0 bg-transparent text-white font-semibold text-right outline-none ${amount.length > 8 ? "text-xs sm:text-2xl" : "text-2xl sm:text-3xl"}`}
                            onFocus={() => {
                                setAmountFocused(true);
                                setExchangeActiveAmount("withdrawn");
                            }}
                            onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                    event.preventDefault();
                                    if (canSave) void save();
                                }
                            }}
                            onChange={(event) => {
                                setAmount(
                                    event.target.value
                                        .replaceAll("*", "×")
                                        .replaceAll("/", "÷")
                                        .replace(/(.)-/g, "$1−"),
                                );
                                setCalculatorError(undefined);
                            }}
                        />
                    </div>
                </fieldset>
            }
        >
            <fieldset
                disabled={blocked}
                className="flex-1 min-w-0 min-h-0 overflow-y-auto scrollbar-hidden flex flex-col px-2 text-sm font-medium gap-2 pb-1"
            >
                {!configuring && transaction && initialInput?.type !== mode && (
                    <p className="text-xs text-muted-foreground">
                        {t("accounting-quick-reclassification-help")}
                    </p>
                )}
                {configuring ? (
                    <>
                        {transaction && !initialJournal && !initialExchange ? (
                            <p role="alert">
                                {t("accounting-journal-dedicated-editor")}
                            </p>
                        ) : (
                            <JournalFields
                                periodFields={
                                    <div className="rounded-md border p-2 space-y-2">
                                        <label className="flex items-center gap-2">
                                            <input
                                                type="checkbox"
                                                checked={periodEnabled}
                                                onChange={(event) =>
                                                    setPeriodEnabled(
                                                        event.target.checked,
                                                    )
                                                }
                                            />
                                            {t("accounting-period-enable")}
                                        </label>
                                        {periodEnabled && (
                                            <>
                                                <label className="flex items-center gap-2">
                                                    {t("accounting-period-end")}
                                                    <input
                                                        type="date"
                                                        className="min-w-0 rounded-md border bg-background p-2"
                                                        value={
                                                            serviceEnd ||
                                                            defaultServiceEnd
                                                        }
                                                        min={time.slice(0, 10)}
                                                        onChange={(event) =>
                                                            setServiceEnd(
                                                                event.target
                                                                    .value,
                                                            )
                                                        }
                                                    />
                                                </label>
                                                <label className="flex items-center gap-2">
                                                    {t(
                                                        "accounting-purchase-depreciation-months",
                                                    )}
                                                    <input
                                                        type="number"
                                                        min="1"
                                                        max="1200"
                                                        className="min-w-0 w-24 rounded-md border bg-background p-2"
                                                        value={
                                                            depreciationMonths
                                                        }
                                                        onChange={(event) => {
                                                            setDepreciationMonths(
                                                                event.target
                                                                    .value,
                                                            );
                                                            const months =
                                                                Number(
                                                                    event.target
                                                                        .value,
                                                                );
                                                            if (
                                                                Number.isInteger(
                                                                    months,
                                                                ) &&
                                                                months > 0 &&
                                                                months <= 1200
                                                            )
                                                                setServiceEnd(
                                                                    resolvePurchaseEndDate(
                                                                        time.slice(
                                                                            0,
                                                                            10,
                                                                        ),
                                                                        months,
                                                                    ),
                                                                );
                                                        }}
                                                    />
                                                </label>
                                                <label className="flex items-center gap-2">
                                                    {t(
                                                        "accounting-depreciation-residual",
                                                    )}
                                                    <input
                                                        inputMode="decimal"
                                                        className="min-w-0 w-24 rounded-md border bg-background p-2"
                                                        value={residual}
                                                        onChange={(event) =>
                                                            setResidual(
                                                                event.target
                                                                    .value,
                                                            )
                                                        }
                                                    />
                                                </label>
                                                <p className="text-xs text-muted-foreground">
                                                    {t(
                                                        "accounting-depreciation-default-expense-help",
                                                    )}
                                                </p>
                                                <p className="text-xs text-muted-foreground">
                                                    {t(
                                                        "accounting-period-purchase-help",
                                                    )}
                                                </p>
                                            </>
                                        )}
                                    </div>
                                }
                                exchangeFields={
                                    <>
                                        <ExchangeFields
                                            accounts={(
                                                current?.data.accounts ?? []
                                            ).filter(
                                                (account) =>
                                                    !account.archived &&
                                                    account.subtype !==
                                                        "currency_trading" &&
                                                    !isCurrencyTradingGroup(
                                                        account,
                                                    ) &&
                                                    (account.subtype !==
                                                        "prepaid" ||
                                                        !!account.costCurrency),
                                            )}
                                            draft={exchangeDraft}
                                            onCreateDestination={() =>
                                                setNewExchangeAsset(true)
                                            }
                                            onActiveAmount={
                                                setExchangeActiveAmount
                                            }
                                            onChange={(next) => {
                                                setExchangeDraft(next);
                                                const source = accounts.find(
                                                    (a) =>
                                                        a.id ===
                                                        next.fromAccountId,
                                                );
                                                if (source) {
                                                    setCurrency(
                                                        source.currency,
                                                    );
                                                }
                                            }}
                                            onAmountFocus={(focused) =>
                                                setAmountFocused(!focused)
                                            }
                                        />
                                        {executionRate !== undefined && (
                                            <p className="text-xs text-muted-foreground">
                                                {t("accounting-exchange-rate", {
                                                    from: exchangeFrom
                                                        ? currencyLabel(
                                                              exchangeFrom.currency,
                                                          )
                                                        : "",
                                                    to: exchangeTo
                                                        ? currencyLabel(
                                                              exchangeTo.currency,
                                                          )
                                                        : "",
                                                    rate: executionRate.toPrecision(
                                                        10,
                                                    ),
                                                })}
                                            </p>
                                        )}
                                    </>
                                }
                                pairedFields={
                                    isPairedTemplate(template) ? (
                                        <PairedJournalFields
                                            template={template}
                                            accounts={accounts}
                                            rows={rows}
                                            disabled={blocked}
                                            onChange={(next) => {
                                                setRows(next);
                                                const source =
                                                    getPairedTemplateAccounts(
                                                        template,
                                                        next,
                                                        accounts,
                                                    ).from;
                                                if (source) {
                                                    setCurrency(
                                                        source.currency,
                                                    );
                                                }
                                            }}
                                            onManage={() => {
                                                void showAccountManager(
                                                    "asset",
                                                ).catch(() => {});
                                            }}
                                            onNewAsset={() =>
                                                setNewFixedAsset(true)
                                            }
                                        />
                                    ) : undefined
                                }
                                rows={rows}
                                accounts={eligible}
                                currency={currency}
                                activeId={activeRow?.id ?? ""}
                                template={template}
                                disabled={blocked}
                                onRowsChange={(next) => {
                                    setRows(next);
                                }}
                                onActiveChange={setActiveId}
                                onTemplateChange={selectTemplate}
                                onAmountFocus={(focused) =>
                                    setAmountFocused(!focused)
                                }
                                onManage={() => {
                                    void showAccountManager("asset").catch(
                                        () => {},
                                    );
                                }}
                            />
                        )}
                        {!canUseQuick && !initialExchange && (
                            <p className="text-xs text-muted-foreground">
                                {t("accounting-journal-complex-edit")}
                            </p>
                        )}
                    </>
                ) : (
                    <>
                        <AccountPicker
                            label={
                                mode === "income"
                                    ? t("accounting-receiving-asset")
                                    : t("accounting-payment-account")
                            }
                            accounts={leftAccounts}
                            value={left}
                            onChange={(accountId) => {
                                const account = leftAccounts.find(
                                    (item) => item.id === accountId,
                                );
                                if (account) {
                                    setLeftId(account.id);
                                    setCurrency(account.currency);
                                }
                            }}
                            disabled={blocked}
                            hierarchical
                            compact
                        />
                        {expenseEstimate && (
                            <p
                                className="text-xs text-muted-foreground"
                                title={t("accounting-currency-estimate-help")}
                            >
                                {t("accounting-currency-estimate")} ≈{" "}
                                {money(
                                    expenseEstimate.amount,
                                    expenseEstimate.currency,
                                )}
                            </p>
                        )}
                        <AccountPicker
                            label={
                                mode === "expense"
                                    ? t("accounting-expense-category-account")
                                    : t("accounting-income-category-account")
                            }
                            accounts={rightAccounts}
                            value={right}
                            onChange={setRightId}
                            disabled={blocked}
                            hierarchical
                            onManage={() => {
                                void showAccountManager(mode).catch(() => {});
                            }}
                        />
                        {(!left || !right) && (
                            <p className="text-xs text-muted-foreground">
                                {t("accounting-settings-create-account")}
                            </p>
                        )}
                    </>
                )}
                {!!liveParent?.children?.length && (
                    <section
                        data-testid="transaction-children"
                        className="rounded-md border p-3 space-y-2 shrink-0"
                    >
                        <h3 className="text-sm font-medium">
                            {t("accounting-child-transactions", {
                                count: liveParent.children.length,
                            })}
                        </h3>
                        <p className="text-xs text-muted-foreground">
                            {t("accounting-children-edit-help")}
                        </p>
                        {liveParent.children.map((child) => (
                            <div
                                key={child.id}
                                className="text-sm border-t pt-2"
                            >
                                <p>
                                    {child.description ||
                                        transactionTypes[child.type]}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                    {formatTime(child.time)}
                                    {child.endTime !== undefined && (
                                        <> → {formatTime(child.endTime)}</>
                                    )}
                                </p>
                            </div>
                        ))}
                    </section>
                )}
            </fieldset>
            <fieldset disabled={blocked} className="shrink-0 min-w-0">
                <div
                    ref={tagSelectorRef}
                    data-tag-selector
                    className="w-full h-10 flex gap-1 py-1 items-center overflow-x-auto px-2 text-sm font-medium scrollbar-hidden"
                >
                    <TagGroupSelector
                        isCreate={!transaction}
                        selectedTags={tagIds}
                        onSelectChange={(selected, extra) => {
                            setTagIds(selected);
                            if (
                                !exchanging &&
                                allowMultiCurrency &&
                                extra?.preferCurrency &&
                                extra.preferCurrency !== currency &&
                                currencies.includes(extra.preferCurrency)
                            ) {
                                setCurrency(extra.preferCurrency);
                                setLeftId("");
                                setRightId("");
                                setRows((previous) =>
                                    previous.map((row) => ({
                                        ...row,
                                        accountId: "",
                                    })),
                                );
                            }
                        }}
                    />
                    <button
                        type="button"
                        className="rounded-lg border py-1 px-2 h-8 shrink-0 flex gap-2 items-center justify-center whitespace-nowrap cursor-pointer"
                        onClick={() => {
                            setManagingTags(true);
                            void showTagList()
                                .catch(() => {})
                                .finally(() => setManagingTags(false));
                        }}
                    >
                        <i
                            aria-hidden
                            className="icon-[mdi--tag-text-outline]"
                        />
                        {t("edit-tags")}
                    </button>
                </div>
            </fieldset>
            <fieldset
                disabled={blocked}
                style={
                    { "--bekh": keyboardHeight / 100 } as React.CSSProperties
                }
                className="relative min-w-0 bg-stone-900 text-white flex flex-col gap-2 p-2 shrink-0 h-[min(48dvh,calc(480px+160px*(var(--bekh,0.5)-0.5)))] sm:h-[min(48dvh,calc(380px+160px*(var(--bekh,0.5)-0.5)))]"
            >
                <ResizeHandle />
                <div className="flex justify-between items-center gap-2 h-10 shrink-0">
                    <div className="flex min-w-0 items-center gap-2">
                        {!!images.length && (
                            <div className="flex items-center gap-2 shrink-0 py-1 px-1">
                                {images.map((image) => (
                                    <Deletable
                                        key={image.id}
                                        deleteLabel={t(
                                            "accounting-remove-image",
                                        )}
                                        onDelete={() => {
                                            if (!blocked)
                                                setImages((previous) =>
                                                    previous.filter(
                                                        (item) =>
                                                            item.id !==
                                                            image.id,
                                                    ),
                                                );
                                        }}
                                    >
                                        <SmartImage
                                            source={image.dataUrl}
                                            alt={image.name}
                                            className="size-6 rounded object-cover"
                                        />
                                    </Deletable>
                                ))}
                            </div>
                        )}

                        {images.length < 3 && (
                            <button
                                type="button"
                                disabled={blocked}
                                aria-label={t("accounting-add-image")}
                                title={t("accounting-add-image")}
                                onClick={() => void addImages()}
                                className="shrink-0 flex items-center"
                            >
                                <i className="icon-[mdi--image-plus-outline] size-5" />
                            </button>
                        )}
                        {location ? (
                            <Deletable
                                deleteLabel={t("accounting-remove-location")}
                                onDelete={() => {
                                    if (!blocked) setLocation(null);
                                }}
                            >
                                <button
                                    type="button"
                                    disabled={blocked}
                                    aria-label={t("accounting-edit-location")}
                                    title={`${location.latitude}, ${location.longitude}`}
                                    onClick={() => void editLocation()}
                                    className="flex items-center"
                                >
                                    <i className="icon-[mdi--map-marker-radius] size-5" />
                                </button>
                            </Deletable>
                        ) : (
                            <CurrentLocation
                                ref={locationRef}
                                label={t("accounting-add-location")}
                                disabled={blocked}
                                onValueChange={(value) => {
                                    setLocation(value);
                                    setMediaError(undefined);
                                }}
                                onError={() =>
                                    setMediaError(
                                        t("accounting-location-failed"),
                                    )
                                }
                            >
                                <i className="icon-[mdi--add-location] size-5" />
                            </CurrentLocation>
                        )}
                        <DatePicker
                            fixedTime
                            value={
                                transaction &&
                                time === dateInput(transaction.time)
                                    ? transaction.time
                                    : parseBookDateTime(time)
                            }
                            onChange={(value) => setTime(dateInput(value))}
                        />
                    </div>
                    <input
                        aria-label={t("accounting-remark")}
                        value={description}
                        placeholder={t("accounting-remark")}
                        className="min-w-0 w-1/3 bg-transparent text-white text-right outline-none"
                        onFocus={() => setAmountFocused(false)}
                        onBlur={() => setAmountFocused(true)}
                        onChange={(event) => setDescription(event.target.value)}
                    />
                </div>
                {exchanging && (
                    <p className="text-xs opacity-75">
                        {t("accounting-exchange-keyboard", {
                            field: t(
                                exchangeActiveAmount === "withdrawn"
                                    ? "accounting-exchange-withdrawn"
                                    : exchangeActiveAmount === "received"
                                      ? "accounting-exchange-received"
                                      : "accounting-exchange-fee",
                            ),
                            currency: currencyLabel(
                                exchangeActiveAmount === "received"
                                    ? (exchangeTo?.currency ?? currency)
                                    : (exchangeFrom?.currency ?? currency),
                            ),
                        })}
                    </p>
                )}
                <FormError error={mediaError || calculatorError || error} />
                <Button
                    type="button"
                    aria-label={t("accounting-save-transaction")}
                    onClick={() => void save()}
                    disabled={blocked || !canSave}
                    className="h-[clamp(3rem,8dvh,5rem)] shrink-0 w-full bg-green-700 hover:bg-green-800 text-white text-xl"
                >
                    {blocked ? (
                        t("accounting-saving")
                    ) : (
                        <i aria-hidden className="icon-[mdi--check] size-6" />
                    )}
                </Button>
                <Calculator.Keyboard
                    className="flex-1 min-h-0"
                    disabled={blocked}
                    repeatDisabled={!amount || !canSave}
                    repeatLabel={
                        transaction
                            ? t("accounting-clear")
                            : t("accounting-add-again")
                    }
                    onKey={pressKey}
                />
            </fieldset>
            {newFixedAsset && (
                <AccountForm
                    fixedType="asset"
                    initial={{
                        type: "asset",
                        currency,
                        subtype: "fixed_asset",
                    }}
                    onClose={() => setNewFixedAsset(false)}
                    onSaved={(accountId) =>
                        setRows((previous) =>
                            previous.map((row, index) =>
                                (template === "depreciation"
                                    ? row.side === "credit"
                                    : row.side === "debit") &&
                                index === (template === "depreciation" ? 1 : 0)
                                    ? { ...row, accountId }
                                    : row,
                            ),
                        )
                    }
                />
            )}
            {newExchangeAsset && (
                <AccountForm
                    fixedType="asset"
                    initial={{
                        type: "asset",
                        currency:
                            exchangeTo?.currency ??
                            exchangeFrom?.currency ??
                            currency,
                    }}
                    onClose={() => setNewExchangeAsset(false)}
                    onSaved={(accountId) => {
                        const created = accountingStore
                            .getState()
                            .current?.data.accounts.find(
                                (account) => account.id === accountId,
                            );
                        setExchangeDraft((previous) => ({
                            ...previous,
                            toAccountId: accountId,
                            ...(created?.currency === exchangeFrom?.currency
                                ? { fee: "", feeAccountId: "" }
                                : {}),
                        }));
                    }}
                />
            )}
            <LocationPickerProvider />
        </PopupLayout>
    );
}
