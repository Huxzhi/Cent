import { useMemo, useState } from "react";
import { useStore } from "zustand";
import { useAccountingLabels } from "../../components/accounting/i18n";
import { FormError, money } from "../../components/accounting/shared";
import {
    type AccountingFilterEdit,
    AccountingFilterProvider,
    showAccountingFilter,
} from "../../components/bill-filter/accounting";
import { isCancelError } from "../../components/confirm/state";
import {
    AccountingStructure,
    AccountingTrend,
    statisticsDate,
} from "../../components/stat/accounting-charts";
import AccountingStatisticsDetails from "../../components/stat/accounting-details";
import type { ViewType } from "../../components/stat/date-slice";
import { DateSliced, useDateSliced } from "../../components/stat/date-slice";
import SavedStatisticsViews from "../../components/stat/saved-views";
import { Button } from "../../components/ui/button";
import { useAccountingView } from "../../hooks/use-accounting-view";
import { amountToNumber } from "../../ledger/accounting";
import {
    analysisAccountTypes,
    getAnalysisLines,
    getAnalysisTotals,
    getAnalysisTrend,
} from "../../ledger/accounting/analysis";
import type { AccountingData } from "../../ledger/accounting/backup";
import {
    getStatisticsAccountIds,
    getStatisticsAccountRows,
    getStatisticsBuckets,
    getStatisticsTotals,
    getStatisticsTrend,
    type StatisticsAccountRow,
    type StatisticsBucket,
    type StatisticsFilter,
    type StatisticsLine,
} from "../../ledger/accounting/statistics";
import type {
    SavedStatisticsView,
    StatisticsViewSnapshot,
} from "../../ledger/accounting/statistics-view";
import type { AccountType } from "../../ledger/accounting/types";
import { useLocale } from "../../locale";
import { accountingStore } from "../../store/accounting";
import { useUserStore } from "../../store/user";

type Filter = Omit<StatisticsFilter, "start" | "end">;

export default function Page() {
    const current = useStore(accountingStore, (state) => state.current);
    const { locale } = useLocale();
    return current ? (
        <StatisticsPage
            key={`${current.book.id}:${locale}:${current.data.timeZone}`}
            data={current.data}
            bookId={current.book.id}
        />
    ) : null;
}

function StatisticsPage({
    data,
    bookId,
}: {
    data: AccountingData;
    bookId: string;
}) {
    const { t } = useAccountingLabels();
    const userId = useUserStore((state) => state.id);
    const cachedUsers = useUserStore((state) => state.cachedUsers);
    const { now } = useAccountingView(data);
    const [selectedViewId, setSelectedViewId] = useState<string>();
    const [filters, setFilters] = useState<Filter>({});
    const [cashFocus, setCashFocus] = useState(1);
    const [details, setDetails] = useState<StatisticsLine[]>();
    const range = useMemo<[number, number]>(
        () => [
            data.transactions.reduce(
                (earliest, transaction) => Math.min(earliest, transaction.time),
                now,
            ),
            now,
        ],
        [data.transactions, now],
    );
    const { props: dateProps, sliceRange, viewType } = useDateSliced({ range });
    const start = sliceRange?.[0] ?? range[0];
    const end = Math.min(sliceRange?.[1] ?? now, now);
    const monthly = viewType === "yearly" || end - start > 90 * 86400000;
    const snapshot: StatisticsViewSnapshot = {
        view: "entries",
        focus: cashFocus,
        balanceMode: "changes",
        filter: filters,
        period:
            viewType === "custom"
                ? {
                      mode: "custom",
                      offset: 0,
                      ...(dateProps.custom?.[0] === undefined
                          ? {}
                          : { start: dateProps.custom[0] }),
                      ...(dateProps.custom?.[1] === undefined
                          ? {}
                          : { end: dateProps.custom[1] }),
                  }
                : {
                      mode: viewType,
                      offset: Math.max(
                          0,
                          dateProps.viewSlices[viewType].findIndex(
                              (slice) =>
                                  dateProps.value ===
                                  `${viewType}|${slice.label}`,
                          ),
                      ),
                  },
    };
    const selectSavedView = (saved: SavedStatisticsView) => {
        setSelectedViewId(saved.id);
        setFilters(structuredClone(saved.filter));
        setCashFocus(saved.focus);
        setDetails(undefined);
        if (saved.period.mode === "custom") {
            dateProps.onValueChange?.(undefined);
            dateProps.onCustomValueChange?.([
                saved.period.start,
                saved.period.end,
            ]);
        } else {
            const mode = saved.period.mode;
            const slices = dateProps.viewSlices[mode];
            const slice =
                slices[Math.min(saved.period.offset, slices.length - 1)];
            if (slice) dateProps.onValueChange?.(`${mode}|${slice.label}`);
        }
    };
    const { lines, buckets, error } = useMemo(() => {
        try {
            if (start > end) throw new Error("Invalid statistics range");
            return {
                lines: getAnalysisLines(data, { ...filters, start, end }, now),
                buckets: getStatisticsBuckets(
                    start,
                    end,
                    monthly,
                    data.timeZone,
                ),
            };
        } catch (cause) {
            return {
                lines: [],
                buckets: [],
                error: t(
                    cause instanceof Error &&
                        cause.message === "Invalid statistics range"
                        ? "stat-invalid-range"
                        : "accounting-detail-amount-overflow",
                ),
            };
        }
    }, [data, filters, start, end, now, monthly, t]);
    const currencies = [
        ...new Set(
            data.transactions.flatMap((transaction) =>
                transaction.entries.flatMap((entry) =>
                    entry.currency ? [entry.currency.target] : [],
                ),
            ),
        ),
    ];
    const creators = [
        ...new Set(
            data.transactions.map((transaction) =>
                String(transaction.creatorId ?? ""),
            ),
        ),
    ].filter(Boolean);
    const getFilterEdit = (
        state: StatisticsViewSnapshot,
    ): AccountingFilterEdit => ({
        ...state,
        accounts: data.accounts,
        currencies,
        creators: creators.map((id) => ({
            id,
            name:
                id === String(userId) ? t("me") : (cachedUsers[id]?.name ?? id),
        })),
    });
    const changeFilters = (next: Filter) => {
        setFilters(next);
        if (
            next.accountTypes?.includes("income") &&
            !next.accountTypes.includes("expense")
        )
            setCashFocus(0);
        else if (
            next.accountTypes?.includes("expense") &&
            !next.accountTypes.includes("income")
        )
            setCashFocus(1);
        setDetails(undefined);
    };
    const openFilters = async () => {
        const result = await showAccountingFilter(
            getFilterEdit(snapshot),
        ).catch((cause: unknown) => {
            if (isCancelError(cause)) return undefined;
            throw cause;
        });
        if (result) changeFilters(result.filter);
    };
    const reset = () => {
        setSelectedViewId(undefined);
        changeFilters({});
    };
    const shownTypes = analysisAccountTypes.filter(
        (type) =>
            (filters.accountTypes ?? analysisAccountTypes).includes(type) &&
            lines.some((line) => line.type === type),
    );
    const currency = filters.amountCurrency ?? "";
    const reportTypes: (AccountType | "cash")[] = [
        ...(shownTypes.some((type) => type === "income" || type === "expense")
            ? ["cash" as const]
            : []),
        ...shownTypes.filter((type) => type !== "income" && type !== "expense"),
    ];
    return (
        <div className="h-full min-h-0 overflow-y-auto">
            <div className="w-full max-w-[1000px] mx-auto flex flex-col gap-4 p-2 md:p-4">
                <SavedStatisticsViews
                    data={data}
                    bookId={bookId}
                    selectedId={selectedViewId}
                    snapshot={snapshot}
                    getFilterEdit={getFilterEdit}
                    onSelect={selectSavedView}
                    onDelete={reset}
                >
                    <Button
                        size="sm"
                        variant="ghost"
                        aria-pressed={!selectedViewId}
                        onClick={reset}
                    >
                        {t("stat-unified-analysis")}
                    </Button>
                </SavedStatisticsViews>
                <DateSliced {...dateProps} onClickSettings={openFilters}>
                    <Button
                        size="sm"
                        variant="outline"
                        aria-haspopup="dialog"
                        onClick={openFilters}
                    >
                        {t("stat-filter-settings")}
                    </Button>
                </DateSliced>
                <FormError error={error} />
                {!error && !shownTypes.length && (
                    <p className="text-center text-muted-foreground py-12">
                        {t("stat-no-data")}
                    </p>
                )}
                {!error &&
                    reportTypes.map((type) => (
                        <AnalysisPanel
                            key={`${type}:${JSON.stringify({ filter: filters, period: snapshot.period })}`}
                            type={type}
                            data={data}
                            lines={lines.filter((line) =>
                                type === "cash"
                                    ? line.type === "income" ||
                                      line.type === "expense"
                                    : line.type === type,
                            )}
                            buckets={buckets}
                            currency={currency}
                            viewType={viewType}
                            range={[start, end]}
                            onDetails={setDetails}
                            focus={cashFocus}
                            onFocusChange={setCashFocus}
                        />
                    ))}
                <AccountingFilterProvider />
                {details && (
                    <AccountingStatisticsDetails
                        lines={details}
                        accounts={data.accounts}
                        transactions={data.transactions}
                        currency={currency}
                        onClose={() => setDetails(undefined)}
                    />
                )}
            </div>
        </div>
    );
}

function AnalysisPanel({
    type,
    data,
    lines,
    buckets,
    currency,
    viewType,
    range,
    onDetails,
    focus: requestedFocus,
    onFocusChange,
}: {
    type: AccountType | "cash";
    data: AccountingData;
    lines: StatisticsLine[];
    buckets: StatisticsBucket[];
    currency: string;
    viewType: ViewType;
    range: [number, number];
    onDetails: (lines: StatisticsLine[]) => void;
    focus: number;
    onFocusChange: (focus: number) => void;
}) {
    const { t, accountTypes, labelAccount } = useAccountingLabels();
    const cash = type === "cash";
    const focus = requestedFocus;
    const title = cash ? t("stat-default-cash") : accountTypes[type];
    const [path, setPath] = useState<string[]>([]);
    const parentId = path.at(-1);
    const ids = parentId
        ? getStatisticsAccountIds(data.accounts, parentId)
        : undefined;
    const selectedLines = ids
        ? lines.filter((line) => ids.has(line.accountId))
        : lines;
    const totals = cash
        ? getStatisticsTotals(selectedLines)
        : getAnalysisTotals(selectedLines);
    const names = cash
        ? [t("income"), t("expense"), t("stat-surplus")]
        : [
              t("stat-period-increase"),
              t("stat-period-decrease"),
              t("stat-period-change"),
          ];
    const source = cash
        ? getStatisticsTrend(selectedLines, buckets).map((point) => [
              statisticsDate(point.time),
              amountToNumber(point.income),
              amountToNumber(point.expense),
              amountToNumber(point.net),
          ])
        : getAnalysisTrend(selectedLines, buckets).map((point) => [
              statisticsDate(point.time),
              amountToNumber(point.increase),
              amountToNumber(point.decrease),
              amountToNumber(point.net),
          ]);
    const values =
        "income" in totals
            ? [totals.income, totals.expense, totals.net]
            : [totals.increase, totals.decrease, totals.net];
    const rows = cash
        ? focus === 2
            ? [
                  ...getStatisticsAccountRows(
                      selectedLines,
                      data.accounts,
                      "income",
                      parentId,
                  ),
                  ...getStatisticsAccountRows(
                      selectedLines,
                      data.accounts,
                      "expense",
                      parentId,
                  ).map((row) => ({ ...row, amount: -row.amount })),
              ]
            : getStatisticsAccountRows(
                  selectedLines,
                  data.accounts,
                  focus === 0 ? "income" : "expense",
                  parentId,
              )
        : getStatisticsAccountRows(
              selectedLines,
              data.accounts,
              type,
              parentId,
          );
    const detailLines =
        cash && focus !== 2
            ? selectedLines.filter(
                  (line) => line.type === (focus === 0 ? "income" : "expense"),
              )
            : selectedLines;
    const rowDetails = (row: StatisticsAccountRow) => {
        const selected = row.direct
            ? new Set([row.account.id])
            : getStatisticsAccountIds(data.accounts, row.account.id);
        onDetails(selectedLines.filter((line) => selected.has(line.accountId)));
    };
    return (
        <section
            className="space-y-3 border rounded-lg p-3 md:p-4"
            data-analysis-type={type}
        >
            <div className="flex items-center justify-between gap-2">
                <h2 className="font-semibold">{title}</h2>
                <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onDetails(detailLines)}
                >
                    {t("stat-entry-details")}
                </Button>
            </div>
            <div className="grid grid-cols-3 gap-2">
                {values.map((amount, index) => (
                    <Button
                        key={names[index]}
                        variant="outline"
                        className={`h-auto flex flex-col border rounded p-2 text-center min-w-0 ${cash && index === focus ? "border-primary" : ""}`}
                        aria-pressed={cash ? index === focus : undefined}
                        data-analysis-metric={
                            cash
                                ? ["income", "expense", "net"][index]
                                : undefined
                        }
                        onClick={() => {
                            if (cash) {
                                onFocusChange(index);
                                setPath([]);
                            } else
                                onDetails(
                                    index === 0
                                        ? selectedLines.filter(
                                              (line) => line.amount > 0,
                                          )
                                        : index === 1
                                          ? selectedLines.filter(
                                                (line) => line.amount < 0,
                                            )
                                          : selectedLines,
                                );
                        }}
                    >
                        <div className="text-xs text-muted-foreground">
                            {names[index]}
                        </div>
                        <div className="font-medium break-all">
                            {money(amount, currency, Boolean(currency))}
                        </div>
                    </Button>
                ))}
            </div>
            {!!path.length && (
                <div className="flex flex-wrap gap-1 text-xs">
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setPath([])}
                    >
                        {title}
                    </Button>
                    {path.map((id, index) => (
                        <Button
                            key={id}
                            size="sm"
                            variant="ghost"
                            onClick={() => setPath(path.slice(0, index + 1))}
                        >
                            {labelAccount(
                                data.accounts.find(
                                    (account) => account.id === id,
                                )!,
                            )}
                        </Button>
                    ))}
                </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <AccountingTrend
                    source={source}
                    names={names}
                    selected={cash ? focus : 2}
                    viewType={viewType}
                    range={range}
                    balances={!cash}
                    title={t(cash ? "overall-trend" : "stat-entry-trend")}
                />
                <AccountingStructure
                    rows={rows}
                    currency={currency}
                    title={t(
                        cash && focus !== 2
                            ? focus === 0
                                ? "income-structure"
                                : "expense-structure"
                            : "stat-entry-structure",
                    )}
                    chart={cash && focus !== 2 ? "pie" : "bar"}
                    onSelect={(row) => {
                        if (!row.expandable) {
                            rowDetails(row);
                            return;
                        }
                        if (cash)
                            onFocusChange(
                                row.account.type === "income" ? 0 : 1,
                            );
                        setPath([...path, row.account.id]);
                    }}
                    onDetails={rowDetails}
                />
            </div>
        </section>
    );
}
