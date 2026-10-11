/** biome-ignore-all lint/security/noDangerouslySetInnerHtml: trusted localized help contains div markup */
import { type ReactNode, useMemo } from "react";
import { toast } from "sonner";
import { useCurrency } from "@/hooks/use-currency";
import PopupLayout from "@/layouts/popup-layout";
import { useIntl } from "@/locale";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger } from "../ui/select";
import { EditCurrencyProvider, showEditCurrency } from "./edit-form";

export default function CurrencyListForm({
    onCancel,
}: {
    onCancel?: () => void;
}) {
    const t = useIntl();
    const {
        multiCurrency,
        baseCurrency,
        setBaseCurrency,
        convert,
        customCurrencies,
        updateCustomCurrency,
        deleteCustomCurrency,
        allCurrencies,
        quickCurrencies,
        updateQuickCurrencies,
    } = useCurrency();
    const rates = useMemo(
        () =>
            new Map(
                allCurrencies.map((currency) => [
                    currency.id,
                    convert(1, baseCurrency.id, currency.id).predict,
                ]),
            ),
        [allCurrencies, baseCurrency.id, convert],
    );
    const others = allCurrencies.filter((currency) =>
        quickCurrencies.every((quick) => quick.id !== currency.id),
    );
    const toUpdateCurrency = async (id?: string) => {
        const currency = customCurrencies.find(
            (currency) => currency.id === id,
        );
        try {
            const changed = await showEditCurrency(currency);
            if (!changed) return;
            if (typeof changed === "string") {
                if (currency) await deleteCustomCurrency(currency.id);
            } else await updateCustomCurrency(changed);
        } catch (error) {
            if (error instanceof Error) toast.error(error.message);
        }
    };
    const groups = [
        {
            label: "quick-currencies",
            currencies: quickCurrencies,
            pinned: true,
        },
        { label: "other-currencies", currencies: others, pinned: false },
    ];
    return (
        <PopupLayout
            onBack={onCancel}
            title={t("currency-manager")}
            className="flex flex-col h-full overflow-hidden"
            right={
                <Button
                    onClick={() => void toUpdateCurrency()}
                    aria-label={t("add-new-currency")}
                >
                    <i className="icon-[mdi--add]" />
                </Button>
            }
        >
            <div className="flex items-center justify-between gap-4 px-4 py-3 border-b">
                <div>
                    <div>{t("multi-currency")}</div>
                    <p className="text-xs opacity-60 mt-1">
                        {t("multi-currency-help")}
                    </p>
                </div>
                <output className="text-sm shrink-0">
                    {t(
                        multiCurrency
                            ? "multi-currency-auto-enabled"
                            : "multi-currency-single",
                    )}
                </output>
            </div>
            <div className="flex justify-between px-4 border-b py-4">
                <Popover>
                    <PopoverTrigger>
                        <div className="flex items-center gap-1">
                            {t("base-currency")}
                            <i className="icon-[mdi--question-mark-circle-outline]" />
                        </div>
                    </PopoverTrigger>
                    <PopoverContent>
                        <div
                            className="text-sm [&>div]:text-xs [&>div]:opacity-60 [&>div]:py-2"
                            dangerouslySetInnerHTML={{
                                __html: t("currency_change_warning"),
                            }}
                        />
                    </PopoverContent>
                </Popover>
                <Select
                    value={baseCurrency.id}
                    onValueChange={(value) =>
                        void setBaseCurrency(value).catch((error) =>
                            toast.error(error.message),
                        )
                    }
                >
                    <SelectTrigger className="w-fit">
                        <div>{baseCurrency.label}</div>
                    </SelectTrigger>
                    <SelectContent>
                        {allCurrencies.map((currency) => (
                            <SelectItem key={currency.id} value={currency.id}>
                                {currency.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            <div className="w-full px-6 flex justify-between py-1 text-xs opacity-60">
                <div>{t("currency")}</div>
                <Popover>
                    <PopoverTrigger>
                        <div className="flex items-center gap-1">
                            {t("exchange-rate")}
                            <i className="icon-[mdi--question-mark-circle-outline]" />
                        </div>
                    </PopoverTrigger>
                    <PopoverContent className="p-2 text-xs">
                        {t("accounting-derived-rates-help")}
                    </PopoverContent>
                </Popover>
            </div>
            <p className="px-4 py-2 text-xs text-muted-foreground">
                {t("accounting-derived-rates-help")}
            </p>
            <div className="flex-1 overflow-y-auto pb-4">
                {groups.map((group) => (
                    <div
                        key={group.label}
                        className="border rounded-md px-2 mx-2 mb-4"
                    >
                        <div className="text-xs opacity-60 py-2">
                            {t(group.label)}
                        </div>
                        {group.currencies.length === 0 && (
                            <div className="text-center text-xs opacity-60 py-4">
                                {t("quick-entry-empty")}
                            </div>
                        )}
                        {group.currencies.map((currency) => {
                            const custom = customCurrencies.some(
                                (custom) => custom.id === currency.id,
                            );
                            const quote = rates.get(currency.id);
                            return (
                                <CurrencyItem
                                    key={currency.id}
                                    name={currency.label}
                                    symbol={currency.symbol}
                                    icon={
                                        "icon" in currency
                                            ? currency.icon
                                            : undefined
                                    }
                                    rate={
                                        quote !== undefined &&
                                        Number.isFinite(quote)
                                            ? quote
                                            : undefined
                                    }
                                    missingLabel={t(
                                        "accounting-no-exchange-rate",
                                    )}
                                    onClick={
                                        custom
                                            ? () =>
                                                  void toUpdateCurrency(
                                                      currency.id,
                                                  )
                                            : undefined
                                    }
                                >
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        aria-label={t(
                                            group.pinned
                                                ? "currency-unpin"
                                                : "currency-pin",
                                            { name: currency.label },
                                        )}
                                        onClick={() =>
                                            void updateQuickCurrencies(
                                                group.pinned
                                                    ? quickCurrencies
                                                          .filter(
                                                              (quick) =>
                                                                  quick.id !==
                                                                  currency.id,
                                                          )
                                                          .map(
                                                              (quick) =>
                                                                  quick.id,
                                                          )
                                                    : [
                                                          currency.id,
                                                          ...quickCurrencies.map(
                                                              (quick) =>
                                                                  quick.id,
                                                          ),
                                                      ],
                                            ).catch((error) =>
                                                toast.error(error.message),
                                            )
                                        }
                                    >
                                        <i
                                            className={
                                                group.pinned
                                                    ? "icon-[mdi--close]"
                                                    : "icon-[mdi--arrow-collapse-up]"
                                            }
                                        />
                                    </Button>
                                </CurrencyItem>
                            );
                        })}
                    </div>
                ))}
            </div>
            <EditCurrencyProvider />
        </PopupLayout>
    );
}

function CurrencyItem({
    name,
    icon,
    symbol,
    rate,
    missingLabel,
    children,
    onClick,
}: {
    name: string;
    symbol: string;
    icon?: ReactNode;
    rate?: number;
    missingLabel: string;
    children?: ReactNode;
    onClick?: () => void;
}) {
    const content = (
        <>
            <span className="flex items-center gap-2">
                {icon && <span className="text-xl">{icon}</span>}
                <span className="text-left">
                    <span className="block">{name}</span>
                    <span className="block text-xs opacity-60">({symbol})</span>
                </span>
            </span>
            <span className="text-sm">
                {rate === undefined ? missingLabel : rate.toFixed(6)}
            </span>
        </>
    );
    return (
        <div className="py-2 border-b w-full flex justify-between items-center gap-2">
            {onClick ? (
                <button
                    type="button"
                    onClick={onClick}
                    className="flex-1 min-w-0 flex justify-between items-center gap-2 cursor-pointer"
                >
                    {content}
                </button>
            ) : (
                <div className="flex-1 min-w-0 flex justify-between items-center gap-2">
                    {content}
                </div>
            )}
            {children}
        </div>
    );
}
