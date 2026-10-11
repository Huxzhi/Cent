import { Fragment } from "react";
import type {
    ListAmountPresentation,
    ListAmountTone,
    TransactionListPresentation,
} from "../../ledger/accounting/list-presentation";
import { bookDayjs } from "../../utils/time";
import { listMoney, money } from "../accounting/shared";

type Translate = (key: string) => string;
export function listAmountClass(tone: ListAmountTone) {
    return tone === "neutral"
        ? "text-muted-foreground"
        : tone === "expense"
          ? "text-semantic-expense"
          : tone === "income"
            ? "text-semantic-income"
            : "";
}
export function formatListAmount(value: ListAmountPresentation, t: Translate) {
    const prefix = value.arrow ? `${value.arrow} ` : "";
    return (
        prefix +
        (value.amount === undefined
            ? t("accounting-conversion-pending")
            : `${value.estimate ? "≈ " : ""}${value.amount > 0 && value.showPlus ? "+" : ""}${listMoney(value.amount, value.currency)}`)
    );
}
export function formatListLabel(
    display: TransactionListPresentation,
    t: Translate,
    compact = false,
    showPeriodDates = false,
) {
    const period = display.period;
    if (compact && period?.depreciation)
        return t("accounting-depreciation-accumulated");
    let label = t(display.labelKey);
    if (period) {
        label += ` · ${t("accounting-period-recognized")}`;
        if (showPeriodDates && !period.depreciation)
            label += ` · ${t("accounting-period-range")} ${bookDayjs(period.start).format("YYYY-MM-DD")} → ${bookDayjs(period.end).format("YYYY-MM-DD")}`;
    }
    if (!compact && display.related)
        label += ` · ${t("accounting-child-transaction")}`;
    return label;
}

/** 类型、备注及原币/到账数量统一同行；窄屏按内容自然换行。 */
export function TransactionMetadata({
    label,
    description,
    supplement,
    t,
}: {
    label?: string;
    description?: string;
    supplement?: TransactionListPresentation["supplement"];
    t: Translate;
}) {
    const hasSupplement = supplement && supplement.amounts.length > 0;
    if (!label && !description && !hasSupplement) return null;
    return (
        <span
            className="block text-xs text-left break-words"
            data-transaction-metadata
        >
            {label && <span>{label}</span>}
            {description && (
                <>
                    {label && <span className="px-1">|</span>}
                    <span>{description}</span>
                </>
            )}
            {hasSupplement && (
                <>
                    {(label || description) && <span className="px-1">|</span>}
                    <span
                        className="text-muted-foreground tabular-nums"
                        data-native-amount
                    >
                        {t(supplement.labelKey)}{" "}
                        {supplement.amounts.map((value, index) => (
                            <Fragment key={`${value.currency}-${index}`}>
                                {index > 0 && " · "}
                                <span className="whitespace-nowrap">
                                    {money(value.amount, value.currency, true)}
                                </span>
                            </Fragment>
                        ))}
                    </span>
                </>
            )}
        </span>
    );
}

export function TransactionPeriod({
    period,
    t,
}: {
    period: TransactionListPresentation["period"];
    t: Translate;
}) {
    if (!period?.depreciation || !period.endingAmount) return null;
    return (
        <span className="flex flex-wrap justify-between gap-x-3 gap-y-1 pt-1 text-xs text-muted-foreground">
            <span
                className="tabular-nums"
                data-child-period
                title={t("accounting-period-range-help")}
            >
                {bookDayjs(period.start).format("YYYY-MM-DD")} →{" "}
                {bookDayjs(period.end).format("YYYY-MM-DD")}
            </span>
            <span className="tabular-nums" data-child-ending-amount>
                {t("accounting-period-ending-amount")}{" "}
                {formatListAmount(period.endingAmount, t)}
            </span>
        </span>
    );
}
