import {
    cloneElement,
    createContext,
    type ReactElement,
    type ReactNode,
    useContext,
    useEffect,
    useId,
    useRef,
    useState,
} from "react";
import PopupLayout from "@/layouts/popup-layout";
import { t, useIntl } from "@/locale";
import {
    type Account,
    type AccountType,
    amountToDecimal,
    decimalToAmount,
    getEntryAmount,
    type Transaction,
} from "../../ledger/accounting";
import { accountingStore } from "../../store/accounting";
import { bookDayjs } from "../../utils/time";
import createConfirmProvider from "../confirm";
import { isCancelError } from "../confirm/state";
import { getAccountLabelKey } from "./account-label";

export const accountTypes: Record<AccountType, string> = {
    asset: "资产",
    liability: "负债",
    income: "收入",
    expense: "费用",
    equity: "权益",
};
export const accountTypeDescriptions: Record<AccountType, string> = {
    asset: "你拥有、可以使用的钱或物品，例如现金、银行卡余额、储值卡和电脑。",
    liability: "你还需要偿还的钱，例如信用卡欠款、借款和未付账款。",
    income: "你赚到的钱，按来源记录，例如工资、奖金和利息收入。",
    expense: "你花掉或消耗的价值，按用途记录，例如餐饮、交通和折旧费用。",
    equity: "记录开始记账前已有的净资产或你投入的资金，例如期初权益。",
};
export const selectClass =
    "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";
export function Field({
    label,
    children,
}: {
    label: string;
    children: ReactElement<{ id?: string }>;
}) {
    const generatedId = useId();
    const id = children.props.id ?? generatedId;
    return (
        <div className="flex flex-col gap-2 text-sm font-medium">
            <label htmlFor={id}>{label}</label>
            {cloneElement(children, { id })}
        </div>
    );
}
type ModalProps = {
    title: string;
    children: ReactNode;
    onClose: () => void;
    busy?: boolean;
};
const ModalContext = createContext<ModalProps | undefined>(undefined);
function useModalContent() {
    const value = useContext(ModalContext);
    if (!value) throw new Error("Modal content requires its provider");
    return value;
}
function ModalTitle() {
    return useModalContent().title;
}
function ModalDescription() {
    const t = useIntl();
    return t("accounting-form-description", { title: useModalContent().title });
}
function ModalContent({ onCancel }: { onCancel?: () => void }) {
    const { title, children, busy } = useModalContent();
    return (
        <PopupLayout
            title={title}
            onBack={busy ? undefined : onCancel}
            hideBack={busy}
            className="h-full overflow-hidden"
        >
            <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
                {children}
            </div>
        </PopupLayout>
    );
}
/** Controlled forms share the original provider's stack, backdrop and history handling. */
export function Modal(props: ModalProps) {
    const latest = useRef(props);
    latest.current = props;
    const [[Provider, , open]] = useState(() =>
        createConfirmProvider<void, void>(ModalContent, {
            dialogTitle: <ModalTitle />,
            dialogDescription: <ModalDescription />,
            dialogModalClose: true,
            closeDisabled: () => !!latest.current.busy,
            swipe: false,
            contentClassName:
                "h-full w-full max-h-full max-w-full rounded-none sm:rounded-md sm:max-h-[min(520px,calc(100vh-32px))] sm:w-[90vw] sm:max-w-[500px] overflow-hidden",
        }),
    );
    useEffect(() => {
        let disposed = false;
        let settled = false;
        let controller: ReturnType<typeof open> | undefined;
        // StrictMode's first setup is discarded before a history entry is opened.
        void Promise.resolve().then(() => {
            if (disposed) return;
            controller = open();
            void controller.promise.then(
                () => {
                    settled = true;
                },
                (error) => {
                    settled = true;
                    if (!disposed && isCancelError(error))
                        latest.current.onClose();
                },
            );
        });
        return () => {
            disposed = true;
            if (!settled) controller?.cancel();
        };
    }, [open]);
    return (
        <ModalContext.Provider value={props}>
            <Provider />
        </ModalContext.Provider>
    );
}
export function FormError({ error }: { error?: string }) {
    return error ? (
        <p
            role="alert"
            className="text-sm text-destructive whitespace-pre-wrap"
        >
            {error}
        </p>
    ) : null;
}
export function useFormAction(onDone?: () => void) {
    const t = useIntl();
    const [error, setError] = useState<string>();
    const [submitting, setSubmitting] = useState(false);
    const run = async (action: () => Promise<void>) => {
        if (submitting) return;
        setSubmitting(true);
        setError(undefined);
        try {
            await action();
            onDone?.();
        } catch (failure) {
            setError(
                failure instanceof Error
                    ? failure.message
                    : t("accounting-action-failed"),
            );
        } finally {
            setSubmitting(false);
        }
    };
    return { error, submitting, run };
}
export function parseMoney(text: string) {
    return decimalToAmount(text);
}
export function isBaseCurrency(currency: string) {
    return (
        currency ===
        (accountingStore.getState().current?.data.currencySettings
            ?.baseCurrency ?? "CNY")
    );
}

export function money(
    amount: number,
    currency: string,
    showCurrency = !isBaseCurrency(currency),
) {
    const [whole, fraction = ""] = amountToDecimal(amount).split(".");
    const sign = whole.startsWith("-") ? "-" : "";
    const grouped = BigInt(sign ? whole.slice(1) : whole).toLocaleString();
    return `${sign}${grouped}.${fraction.padEnd(2, "0")}${showCurrency ? ` ${currencyLabel(currency)}` : ""}`;
}

/** 列表按分四舍五入，仅改变展示，不改写分录或统计使用的四位精度金额。 */
export function listMoney(amount: number, currency: string) {
    const value = BigInt(amount);
    const cents = ((value < 0n ? -value : value) + 50n) / 100n;
    const sign = value < 0n && cents !== 0n ? "-" : "";
    return `${sign}${(cents / 100n).toLocaleString()}.${(cents % 100n).toString().padStart(2, "0")}${isBaseCurrency(currency) ? "" : ` ${currencyLabel(currency)}`}`;
}

export function currencyLabel(currency: string) {
    const custom = accountingStore
        .getState()
        .current?.data.currencySettings?.customCurrencies.find(
            (item) => item.id === currency,
        );
    if (!custom) return currency;
    if (custom.symbol) return custom.symbol;
    const account = accountingStore
        .getState()
        .current?.data.accounts.find(
            (account) =>
                account.id === custom.accountId && account.name === custom.name,
        );
    const key = account && getAccountLabelKey(account);
    return key ? t(key) : custom.name;
}
export function dateInput(time: number) {
    return bookDayjs(time).format("YYYY-MM-DDTHH:mm");
}
export function accountName(
    account: Account,
    accounts: readonly Account[],
    label: (account: Account) => string = (item) => item.name,
) {
    const parent = accounts.find((item) => item.id === account.parentId);
    return parent ? `${label(parent)} / ${label(account)}` : label(account);
}

export function accountFlow(
    transaction: Transaction,
    accounts: readonly Account[],
    label: (account: Account) => string,
) {
    const accountLabels = (from: boolean) =>
        [
            ...new Set(
                transaction.entries
                    .filter(
                        (entry) =>
                            !transaction.exchange ||
                            entry.accountId ===
                                transaction.exchange?.fromAccountId ||
                            entry.accountId ===
                                transaction.exchange?.toAccountId,
                    )
                    .filter((entry) =>
                        from
                            ? getEntryAmount(entry) < 0
                            : getEntryAmount(entry) > 0,
                    )
                    .map((entry) => entry.accountId),
            ),
        ]
            .map((id) => {
                const account = accounts.find((item) => item.id === id);
                return account ? label(account) : id;
            })
            .join("、");
    return `${accountLabels(true)} → ${accountLabels(false)}`;
}
