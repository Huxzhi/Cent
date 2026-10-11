import type { MouseEventHandler } from "react";
import { useLocale } from "@/locale";
import { cn } from "@/utils";
import { type Account, getAccountIcon } from "../../ledger/accounting";
import AccountIcon from "./account-icon";
import { accountPickerLevels } from "./account-picker-tree";
import { useAccountingLabels } from "./i18n";

export default function AccountPicker({
    label,
    accounts,
    value,
    onChange,
    disabled,
    hierarchical = false,
    compact = false,
    onManage,
}: {
    label: string;
    accounts: Account[];
    value: string;
    onChange: (id: string) => void;
    disabled: boolean;
    hierarchical?: boolean;
    compact?: boolean;
    onManage?: () => void;
}) {
    const { t, labelAccount } = useAccountingLabels();
    const { locale } = useLocale();
    const levels = hierarchical
        ? accountPickerLevels(accounts, value)
        : [accounts];
    return (
        <fieldset
            className={
                hierarchical && !compact
                    ? "flex-1 min-w-0 min-h-fit flex flex-col gap-2"
                    : "min-w-0 shrink-0 flex flex-col gap-2"
            }
            aria-label={label}
            disabled={disabled}
        >
            <legend className="mb-1 text-xs font-medium text-muted-foreground">
                {label}
            </legend>
            {levels.map((level, index) => (
                <div
                    key={level.map((account) => account.id).join("|")}
                    className={
                        index
                            ? "grid grid-cols-4 gap-1 rounded-md border p-1 shrink-0"
                            : compact
                              ? "grid grid-cols-4 gap-1"
                              : "grid grid-cols-4 gap-1 content-start flex-1"
                    }
                    style={
                        index === 0
                            ? {
                                  minHeight:
                                      Math.ceil(
                                          (level.length + (onManage ? 1 : 0)) /
                                              4,
                                      ) *
                                          36 -
                                      4,
                              }
                            : undefined
                    }
                >
                    {level.map((account) => (
                        <AccountItem
                            key={account.id}
                            className={
                                locale === "en"
                                    ? "px-1 text-xs sm:text-sm [&>div]:mx-1"
                                    : undefined
                            }
                            selected={account.id === value}
                            account={{
                                name: labelAccount(account),
                                icon: getAccountIcon(account),
                            }}
                            onClick={() => onChange(account.id)}
                        />
                    ))}
                    {index === 0 && onManage && (
                        <button
                            type="button"
                            className="rounded-lg border h-8 px-2 flex gap-2 justify-center items-center cursor-pointer"
                            onClick={onManage}
                        >
                            <i aria-hidden className="icon-[mdi--settings]" />
                            {t("accounting-edit")}
                        </button>
                    )}
                </div>
            ))}
            {!accounts.length && (
                <p className="text-sm text-muted-foreground">
                    {t("accounting-create-account-first")}
                </p>
            )}
        </fieldset>
    );
}

function AccountItem({
    account,
    selected,
    onMouseDown,
    onClick,
    className,
}: {
    account: Pick<Account, "name"> & { icon: string };
    selected?: boolean;
    onMouseDown?: MouseEventHandler<HTMLButtonElement>;
    onClick?: MouseEventHandler<HTMLButtonElement>;
    className?: string;
}) {
    return (
        <button
            type="button"
            className={cn(
                `rounded-lg border flex-1 min-w-0 py-1 px-2 h-8 flex items-center justify-center whitespace-nowrap cursor-pointer`,
                selected
                    ? "bg-slate-700 text-white "
                    : "bg-stone-200  text-light-900 dark:bg-stone-500",
                className,
            )}
            onMouseDown={onMouseDown}
            onClick={onClick}
            aria-pressed={selected}
            title={account.name}
        >
            <AccountIcon
                icon={account.icon}
                className="w-4 h-4 flex-shrink-0"
            />
            <div className="mx-2 truncate">{account.name}</div>
        </button>
    );
}
