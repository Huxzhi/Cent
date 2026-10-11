import { useState } from "react";
import { amountToNumber, getAccountIcon } from "../../ledger/accounting";
import type { StatisticsAccountRow } from "../../ledger/accounting/statistics";
import { useIntl } from "../../locale";
import { overallTrendOption, structureOption } from "../../utils/charts";
import { getCSSVariable } from "../../utils/color";
import { bookDayjs } from "../../utils/time";
import AccountIcon from "../accounting/account-icon";
import { useAccountingLabels } from "../accounting/i18n";
import { money } from "../accounting/shared";
import Chart from "../chart";
import { Button } from "../ui/button";
import CalendarDetail from "./calendar-detail";
import type { ViewType } from "./date-slice";

export function AccountingTrend({
    source,
    names,
    selected,
    viewType,
    range,
    balances = false,
    title,
    expenseFirst = false,
}: {
    source: (string | number)[][];
    names: string[];
    selected: number;
    viewType: ViewType;
    range: [number, number];
    balances?: boolean;
    title?: string;
    expenseFirst?: boolean;
}) {
    const t = useIntl();
    const [calendar, setCalendar] = useState(false);
    const dataset = { source: [["date", ...names], ...source] };
    return (
        <section className="shrink-0 w-full min-h-[300px] border rounded-md relative pt-12">
            <div className="absolute top-3 left-3 z-2">
                {viewType !== "custom" && (
                    <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t(
                            calendar ? "stat-show-trend" : "stat-show-calendar",
                        )}
                        onClick={() => setCalendar(!calendar)}
                    >
                        <i
                            aria-hidden
                            className={
                                calendar
                                    ? "icon-[mdi--chart-line]"
                                    : "icon-[mdi--calendar-month-outline]"
                            }
                        />
                    </Button>
                )}
            </div>
            <h2 className="absolute top-4 left-16 right-4 text-center font-semibold">
                {title ?? t("overall-trend")}
            </h2>
            {calendar && viewType !== "custom" ? (
                <CalendarDetail
                    viewType={viewType}
                    range={range}
                    dataset={dataset}
                    selectedColumn={selected}
                    unsigned={balances}
                    dimension={balances ? "user" : "category"}
                    focusType={
                        (["income", "expense", "balance"] as const)[selected]
                    }
                />
            ) : (
                <Chart
                    className="w-full h-[280px]"
                    option={overallTrendOption(dataset, {
                        ...(expenseFirst
                            ? {
                                  series: [
                                      {
                                          type: "line",
                                          color: getCSSVariable(
                                              "--color-expense",
                                          ),
                                      },
                                  ],
                              }
                            : {}),
                        grid: { top: 40, bottom: 40, left: 60, right: 25 },
                        legend: {
                            top: 0,
                            left: "center",
                            selected: Object.fromEntries(
                                names.map((name, index) => [
                                    name,
                                    index === selected,
                                ]),
                            ),
                        },
                    })}
                />
            )}
        </section>
    );
}

export function AccountingStructure({
    rows,
    currency,
    title,
    onSelect,
    onDetails,
    chart = "pie",
}: {
    rows: StatisticsAccountRow[];
    currency: string;
    title: string;
    onSelect: (row: StatisticsAccountRow) => void;
    onDetails?: (row: StatisticsAccountRow) => void;
    chart?: "pie" | "bar";
}) {
    const { t, labelAccount } = useAccountingLabels();
    const [list, setList] = useState(false);
    const hasNegative = rows.some((row) => row.amount < 0);
    const signedBars = chart === "bar";
    const showList = list || (hasNegative && !signedBars);
    const total = rows.reduce((value, row) => value + Math.abs(row.amount), 0);
    const label = (row: StatisticsAccountRow) =>
        `${labelAccount(row.account)}${row.direct ? ` · ${t("stat-account-direct")}` : ""}`;
    return (
        <section className="shrink-0 w-full border rounded-md relative pt-12 pb-3">
            <Button
                className="absolute top-2 left-2 z-2"
                size="sm"
                variant="ghost"
                aria-label={t(
                    list
                        ? signedBars
                            ? "stat-show-bar"
                            : "stat-show-pie"
                        : "stat-show-list",
                )}
                onClick={() => setList(!list)}
                disabled={hasNegative && !signedBars}
            >
                <i
                    aria-hidden
                    className={
                        list
                            ? signedBars
                                ? "icon-[mdi--chart-bar]"
                                : "icon-[mdi--chart-pie]"
                            : "icon-[mdi--format-list-bulleted]"
                    }
                />
            </Button>
            <h2 className="absolute top-4 left-16 right-4 text-center font-semibold">
                {title}
            </h2>
            {!rows.length ? (
                <p className="text-center text-muted-foreground text-sm py-12">
                    {t("stat-no-data")}
                </p>
            ) : showList ? (
                <div className="px-3 divide-y">
                    {hasNegative && !signedBars && (
                        <p className="text-xs text-muted-foreground pb-3">
                            {t("stat-negative-list-help")}
                        </p>
                    )}
                    {rows.map((row) => (
                        <div
                            key={`${row.account.id}:${row.direct}`}
                            className="flex items-center gap-2 min-h-14 py-2 text-sm"
                        >
                            <button
                                type="button"
                                className="flex items-center gap-2 min-w-0 flex-1 text-left cursor-pointer"
                                onClick={() => onSelect(row)}
                            >
                                <span className="border size-10 shrink-0 rounded-full p-2">
                                    <AccountIcon
                                        icon={getAccountIcon(row.account)}
                                    />
                                </span>
                                <span className="truncate">{label(row)}</span>
                                {row.expandable && (
                                    <i
                                        aria-hidden
                                        className="icon-[mdi--chevron-right] shrink-0"
                                    />
                                )}
                            </button>
                            {!hasNegative && !signedBars && (
                                <span className="text-muted-foreground">
                                    {total
                                        ? ((row.amount / total) * 100).toFixed(
                                              1,
                                          )
                                        : "0"}
                                    %
                                </span>
                            )}
                            <button
                                type="button"
                                className="font-medium cursor-pointer shrink-0"
                                onClick={() =>
                                    onDetails ? onDetails(row) : onSelect(row)
                                }
                                aria-label={t("stat-account-details", {
                                    account: label(row),
                                })}
                            >
                                {money(
                                    row.amount,
                                    currency,
                                    currency ? undefined : false,
                                )}
                            </button>
                        </div>
                    ))}
                </div>
            ) : signedBars ? (
                <div style={{ height: Math.max(280, rows.length * 40 + 60) }}>
                    <Chart
                        className="w-full h-full"
                        option={{
                            tooltip: {
                                trigger: "item",
                                valueFormatter: (value) =>
                                    Number(value).toLocaleString(undefined, {
                                        maximumFractionDigits: 4,
                                    }),
                            },
                            grid: {
                                top: 20,
                                bottom: 30,
                                left: 16,
                                right: 32,
                                containLabel: true,
                            },
                            xAxis: {
                                type: "value",
                                axisLabel: {
                                    color: getCSSVariable(
                                        "--color-muted-foreground",
                                    ),
                                },
                                splitLine: {
                                    lineStyle: {
                                        color: getCSSVariable("--color-border"),
                                        type: "dashed",
                                    },
                                },
                            },
                            yAxis: {
                                type: "category",
                                inverse: true,
                                data: rows.map(label),
                                axisLabel: {
                                    width: 100,
                                    overflow: "truncate",
                                    color: getCSSVariable(
                                        "--color-muted-foreground",
                                    ),
                                },
                            },
                            series: [
                                {
                                    type: "bar",
                                    barMaxWidth: 24,
                                    data: rows.map((row) => ({
                                        id: `${row.account.id}:${row.direct}`,
                                        name: label(row),
                                        value: amountToNumber(row.amount),
                                        itemStyle: {
                                            color: getCSSVariable(
                                                row.amount < 0
                                                    ? "--color-expense"
                                                    : "--color-income",
                                            ),
                                        },
                                    })),
                                },
                            ],
                        }}
                        onClick={(event) => {
                            if (event.seriesType !== "bar") return;
                            const id = (event.data as { id?: string })?.id;
                            const row = rows.find(
                                (item) =>
                                    `${item.account.id}:${item.direct}` === id,
                            );
                            if (row) onSelect(row);
                        }}
                    />
                </div>
            ) : (
                <Chart
                    className="w-full h-[300px]"
                    option={structureOption(
                        rows.map((row) => ({
                            id: `${row.account.id}:${row.direct}`,
                            name: label(row),
                            value: amountToNumber(row.amount),
                        })),
                        {
                            title: { show: false },
                            legend: { show: false },
                            series: [{ type: "pie", center: ["50%", "50%"] }],
                        },
                    )}
                    onClick={(event) => {
                        if (event.seriesType !== "pie") return;
                        const id = (event.data as { id?: string })?.id;
                        const row = rows.find(
                            (item) =>
                                `${item.account.id}:${item.direct}` === id,
                        );
                        if (row) onSelect(row);
                    }}
                />
            )}
        </section>
    );
}

export function statisticsDate(time: number) {
    return bookDayjs(time).format("YYYY-MM-DD");
}
