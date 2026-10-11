import { type ReactNode, useState } from "react";
import { useTag } from "@/hooks/use-tag";
import type { StatisticsFilter } from "@/ledger/accounting/statistics";
import type { StatisticsViewSnapshot } from "@/ledger/accounting/statistics-view";
import type { Account } from "@/ledger/accounting/types";
import { useAccountingLabels } from "../accounting/i18n";
import { accountName } from "../accounting/shared";
import { CascadeMultipleSelect } from "../cascade";
import { StrictCascadeMultipleSelect } from "../cascade/strict";
import createConfirmProvider from "../confirm";
import AnalysisSelection from "../stat/analysis-selection";
import { Button } from "../ui/button";
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "../ui/select";
import { CommentInput, RangeInput } from "./form";

type Filter = Omit<StatisticsFilter, "start" | "end">;
type Analysis = Pick<StatisticsViewSnapshot, "view" | "focus" | "balanceMode">;
type FilterResult = Analysis & { filter: Filter };
export interface AccountingFilterEdit extends FilterResult {
    accounts: Account[];
    creators: { id: string; name: string }[];
    currencies?: string[];
}
type Option = {
    id: string;
    name: string;
    children?: Option[];
    asGroupLabel?: string;
};

function FilterForm({
    edit,
    onCancel,
    onConfirm,
    header,
    confirmDisabled = false,
    confirmLabel,
}: {
    edit?: AccountingFilterEdit;
    onCancel?: () => void;
    onConfirm?: (result: FilterResult) => void;
    header?: ReactNode;
    confirmDisabled?: boolean;
    confirmLabel?: string;
}) {
    const [form, setForm] = useState<Filter>(edit?.filter ?? {});
    const { t, labelAccount, accountTypes, transactionTypes } =
        useAccountingLabels();
    const { tags, grouped } = useTag();
    if (!edit) return null;
    const { accounts, creators } = edit;
    const update = (patch: Partial<Filter>) =>
        setForm((value) => ({ ...value, ...patch }));
    const options = (list: Account[]): Option[] => {
        const ids = new Set(list.map((item) => item.id));
        const branch = (account: Account, path: Set<string>): Option => ({
            id: account.id,
            name: labelAccount(account),
            children: list
                .filter(
                    (child) =>
                        child.parentId === account.id && !path.has(child.id),
                )
                .map((child) => branch(child, new Set([...path, child.id]))),
        });
        return Object.entries(accountTypes).flatMap(([type, name]) => {
            const roots = list.filter(
                (item) =>
                    item.type === type &&
                    (!item.parentId || !ids.has(item.parentId)),
            );
            return roots.length
                ? [
                      { id: `type:${type}`, name: "", asGroupLabel: name },
                      ...roots.map((item) => branch(item, new Set([item.id]))),
                  ]
                : [];
        });
    };
    const trigger = (name: string, value: string) => (
        <Button
            variant="outline"
            aria-label={name}
            className="max-w-[220px] text-xs md:text-sm"
        >
            <span className="truncate">{value}</span>
        </Button>
    );
    const accountLabel = (ids?: string[]) =>
        ids === undefined
            ? t("unlimited")
            : !ids.length
              ? t("stat-no-selection")
              : ids
                    .map((id) => {
                        const item = accounts.find(
                            (account) => account.id === id,
                        );
                        return item
                            ? accountName(item, accounts, labelAccount)
                            : id;
                    })
                    .join(", ");
    const multipleAccounts = (related: boolean) => {
        const name = t(
            related ? "stat-related-account" : "stat-account-filter",
        );
        const list = related
            ? accounts
            : accounts.filter(
                  (account) =>
                      !form.accountTypes ||
                      form.accountTypes.includes(account.type),
              );
        const value = related ? form.relatedAccountIds : form.accountIds;
        return (
            <FilterRow label={name} icon="icon-[mdi--wallet-outline]">
                <CascadeMultipleSelect
                    list={options(list)}
                    value={value ?? list.map((item) => item.id)}
                    align="end"
                    trigger={trigger(name, accountLabel(value))}
                    onValueChange={(ids) =>
                        update(
                            related
                                ? { relatedAccountIds: ids }
                                : { accountIds: ids, accountId: undefined },
                        )
                    }
                />
            </FilterRow>
        );
    };
    const tagOptions = grouped.map((group) => ({
        id: group.id,
        name: group.name,
        children: group.tags?.map((tag) => ({ id: tag.id, name: tag.name })),
    }));
    const tagPicker = (exclude: boolean) => {
        const name = t(exclude ? "tags-excluded-short" : "tags-include-short");
        const value = (exclude ? form.excludeTagIds : form.tagIds) ?? [];
        return (
            <div className="flex items-center gap-2 min-w-0">
                <span>{name}</span>
                <StrictCascadeMultipleSelect
                    list={tagOptions}
                    value={value}
                    align="end"
                    trigger={trigger(
                        `${t("tags")} · ${name}`,
                        value.length
                            ? tags
                                  .filter((tag) => value.includes(tag.id))
                                  .map((tag) => tag.name)
                                  .join(", ")
                            : t("unlimited"),
                    )}
                    onValueChange={(ids) => {
                        const selected = ids.filter((id) =>
                            tags.some((tag) => tag.id === id),
                        );
                        update(
                            exclude
                                ? { excludeTagIds: selected }
                                : { tagIds: selected },
                        );
                    }}
                />
            </div>
        );
    };
    return (
        <div className="flex flex-col p-2 gap-2 h-[55vh] overflow-hidden">
            {header}
            <div className="flex-1 px-2 pb-4 overflow-y-auto">
                <div className="flex flex-col gap-4 text-xs md:text-sm">
                    <AnalysisSelection
                        filter={form}
                        accounts={accounts}
                        currencies={edit.currencies}
                        onChange={setForm}
                    />
                    {multipleAccounts(false)}
                    {multipleAccounts(true)}
                    <CommentInput
                        value={form.comment}
                        onChange={(comment) =>
                            update({ comment: comment || undefined })
                        }
                    />
                    <FilterRow
                        label={t("amount")}
                        icon="icon-[mdi--scale-unbalanced]"
                    >
                        <div className="flex items-center gap-2">
                            <RangeInput
                                label={t("stat-min-amount")}
                                value={form.minAmountNumber}
                                onChange={(value) =>
                                    update({ minAmountNumber: value })
                                }
                            />
                            <span> - </span>
                            <RangeInput
                                label={t("stat-max-amount")}
                                value={form.maxAmountNumber}
                                onChange={(value) =>
                                    update({ maxAmountNumber: value })
                                }
                            />
                        </div>
                    </FilterRow>
                    <FilterRow
                        label={t("accounting-transaction-type")}
                        icon="icon-[mdi--arrow-collapse]"
                    >
                        <Select
                            value={form.transactionType ?? "all"}
                            onValueChange={(value) =>
                                update({
                                    transactionType:
                                        value === "all"
                                            ? undefined
                                            : (value as Filter["transactionType"]),
                                })
                            }
                        >
                            <SelectTrigger
                                aria-label={t("accounting-transaction-type")}
                                className="w-fit max-w-[220px]"
                            >
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">
                                    {t("unlimited")}
                                </SelectItem>
                                {Object.entries(transactionTypes).map(
                                    ([value, name]) => (
                                        <SelectItem key={value} value={value}>
                                            {name}
                                        </SelectItem>
                                    ),
                                )}
                            </SelectContent>
                        </Select>
                    </FilterRow>
                    <FilterRow
                        label={t("stat-asset-usage")}
                        icon="icon-[mdi--wallet-outline]"
                    >
                        <Select
                            value={form.assetUsage ?? "all"}
                            onValueChange={(value) =>
                                update({
                                    assetUsage:
                                        value === "all"
                                            ? undefined
                                            : (value as Filter["assetUsage"]),
                                })
                            }
                        >
                            <SelectTrigger
                                aria-label={t("stat-asset-usage")}
                                className="w-fit max-w-[220px]"
                            >
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">
                                    {t("unlimited")}
                                </SelectItem>
                                <SelectItem value="ordinary">
                                    {t("stat-asset-ordinary")}
                                </SelectItem>
                                <SelectItem value="prepaid">
                                    {t("stat-asset-prepaid")}
                                </SelectItem>
                                <SelectItem value="fixed_asset">
                                    {t("stat-asset-fixed")}
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </FilterRow>
                    <FilterRow
                        label={t("stat-depreciation-status")}
                        icon="icon-[mdi--archive-outline]"
                    >
                        <Select
                            value={form.depreciationStatus ?? "all"}
                            onValueChange={(value) =>
                                update({
                                    depreciationStatus:
                                        value === "all"
                                            ? undefined
                                            : (value as Filter["depreciationStatus"]),
                                })
                            }
                        >
                            <SelectTrigger
                                aria-label={t("stat-depreciation-status")}
                                className="w-fit max-w-[220px]"
                            >
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">
                                    {t("unlimited")}
                                </SelectItem>
                                <SelectItem value="in_use">
                                    {t("stat-depreciation-in-use")}
                                </SelectItem>
                                <SelectItem value="fully_depreciated">
                                    {t("stat-depreciation-completed")}
                                </SelectItem>
                            </SelectContent>
                        </Select>
                    </FilterRow>
                    <FilterRow
                        label={t("users")}
                        icon="icon-[mdi--account-outline]"
                    >
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                {trigger(
                                    t("users"),
                                    form.creatorIds === undefined
                                        ? t("unlimited")
                                        : creators
                                              .filter((item) =>
                                                  form.creatorIds?.includes(
                                                      item.id,
                                                  ),
                                              )
                                              .map((item) => item.name)
                                              .join(", ") ||
                                              t("stat-no-selection"),
                                )}
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuCheckboxItem
                                    checked={form.creatorIds === undefined}
                                    onCheckedChange={() =>
                                        update({ creatorIds: undefined })
                                    }
                                >
                                    {t("unlimited")}
                                </DropdownMenuCheckboxItem>
                                {creators.map((creator) => (
                                    <DropdownMenuCheckboxItem
                                        key={creator.id}
                                        checked={
                                            form.creatorIds === undefined ||
                                            form.creatorIds.includes(creator.id)
                                        }
                                        onCheckedChange={(checked) => {
                                            const ids = new Set(
                                                form.creatorIds ??
                                                    creators.map(
                                                        (item) => item.id,
                                                    ),
                                            );
                                            if (checked) ids.add(creator.id);
                                            else ids.delete(creator.id);
                                            update({ creatorIds: [...ids] });
                                        }}
                                    >
                                        {creator.name}
                                    </DropdownMenuCheckboxItem>
                                ))}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </FilterRow>
                    <FilterRow label={t("tags")} icon="icon-[mdi--tag-outline]">
                        <div className="flex flex-wrap justify-end gap-2">
                            {tagPicker(true)}
                            {tagPicker(false)}
                        </div>
                    </FilterRow>
                    <p className="text-xs text-muted-foreground">
                        {t("stat-unified-help")}
                    </p>
                </div>
            </div>
            <div className="px-4 flex justify-between gap-2">
                <Button variant="outline" onClick={() => setForm({})}>
                    {t("stat-reset-filters")}
                </Button>
                <div className="flex gap-2">
                    <Button variant="ghost" onClick={onCancel}>
                        {t("cancel")}
                    </Button>
                    <Button
                        disabled={confirmDisabled}
                        onClick={() =>
                            onConfirm?.({
                                view: "entries",
                                focus: edit.focus,
                                balanceMode: "changes",
                                filter: form,
                            })
                        }
                    >
                        {confirmLabel ?? t("confirm")}
                    </Button>
                </div>
            </div>
        </div>
    );
}
function FilterRow({
    label,
    icon,
    children,
}: {
    label: string;
    icon: string;
    children: ReactNode;
}) {
    return (
        <div className="w-full flex justify-between items-center gap-2">
            <div className="flex items-center gap-1 shrink-0">
                <i className={icon} />
                {label}:
            </div>
            <div className="flex justify-end min-w-0">{children}</div>
        </div>
    );
}
export const [AccountingFilterProvider, showAccountingFilter] =
    createConfirmProvider(FilterForm, {
        dialogTitle: "stat-filter-settings",
        fade: true,
        swipe: false,
        contentClassName: "overflow-hidden",
    });
function SavedFilterForm({
    edit,
    onCancel,
    onConfirm,
}: {
    edit?: AccountingFilterEdit & { name: string };
    onCancel?: () => void;
    onConfirm?: (value: FilterResult & { name: string }) => void;
}) {
    const { t } = useAccountingLabels();
    const [name, setName] = useState(edit?.name ?? "");
    return (
        <FilterForm
            edit={edit}
            onCancel={onCancel}
            confirmDisabled={!name.trim()}
            confirmLabel={t("save")}
            onConfirm={(result) =>
                onConfirm?.({ ...result, name: name.trim() })
            }
            header={
                <label className="border rounded px-4 py-1 mx-2 flex items-center gap-2">
                    <input
                        aria-label={t("stat-saved-filter-name")}
                        className="min-w-0 flex-1 outline-none font-semibold text-lg bg-transparent"
                        value={name}
                        onChange={(event) => setName(event.currentTarget.value)}
                    />
                    <i aria-hidden className="icon-[mdi--edit-outline]" />
                </label>
            }
        />
    );
}
export const [AccountingSavedFilterProvider, showAccountingSavedFilter] =
    createConfirmProvider(SavedFilterForm, {
        dialogTitle: "stat-save-filter",
        fade: true,
        swipe: false,
        contentClassName: "overflow-hidden",
    });
