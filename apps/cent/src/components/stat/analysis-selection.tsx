import { analysisAccountTypes } from "../../ledger/accounting/analysis";
import type { StatisticsFilter } from "../../ledger/accounting/statistics";
import type { Account } from "../../ledger/accounting/types";
import { useAccountingLabels } from "../accounting/i18n";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "../ui/select";

export default function AnalysisSelection({
    filter,
    accounts,
    currencies = [],
    onChange,
}: {
    filter: Omit<StatisticsFilter, "start" | "end">;
    accounts: readonly Account[];
    currencies?: readonly string[];
    onChange: (filter: Omit<StatisticsFilter, "start" | "end">) => void;
}) {
    const { t, accountTypes } = useAccountingLabels();
    const selected = filter.accountTypes ?? analysisAccountTypes;
    const availableCurrencies = [
        ...new Set([
            ...accounts.map((account) => account.currency),
            ...currencies,
        ]),
    ].sort();
    return (
        <div className="space-y-3" data-analysis-selection>
            <fieldset className="space-y-2">
                <legend className="text-sm font-medium">
                    {t("stat-account-types")}
                </legend>
                <div className="flex flex-wrap gap-2">
                    {analysisAccountTypes.map((type) => (
                        <label
                            key={type}
                            className="flex items-center gap-2 border rounded px-3 py-2 text-sm cursor-pointer"
                        >
                            <input
                                type="checkbox"
                                checked={selected.includes(type)}
                                onChange={(event) =>
                                    onChange({
                                        ...filter,
                                        accountTypes:
                                            analysisAccountTypes.filter(
                                                (value) =>
                                                    value === type
                                                        ? event.currentTarget
                                                              .checked
                                                        : selected.includes(
                                                              value,
                                                          ),
                                            ),
                                    })
                                }
                            />
                            {accountTypes[type]}
                        </label>
                    ))}
                </div>
            </fieldset>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span>{t("stat-amount-basis")}</span>
                <Select
                    value={filter.amountCurrency ?? "all"}
                    onValueChange={(value) =>
                        onChange({
                            ...filter,
                            amountCurrency: value === "all" ? undefined : value,
                        })
                    }
                >
                    <SelectTrigger
                        aria-label={t("stat-amount-basis")}
                        className="w-fit max-w-[240px]"
                    >
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">
                            {t("stat-saved-amount")}
                        </SelectItem>
                        {availableCurrencies.map((currency) => (
                            <SelectItem key={currency} value={currency}>
                                {currency}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            <p className="text-xs text-muted-foreground">
                {t(
                    filter.amountCurrency
                        ? "stat-native-amount-help"
                        : "stat-saved-amount-help",
                )}
            </p>
        </div>
    );
}
