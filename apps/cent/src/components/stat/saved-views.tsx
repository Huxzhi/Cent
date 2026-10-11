import { isEqual } from "lodash-es";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { v4 } from "uuid";
import type { AccountingData } from "../../ledger/accounting/backup";
import type {
    SavedStatisticsView,
    StatisticsViewSnapshot,
} from "../../ledger/accounting/statistics-view";
import { accountingStore } from "../../store/accounting";
import { useAccountingLabels } from "../accounting/i18n";
import { FormError, Modal, useFormAction } from "../accounting/shared";
import {
    type AccountingFilterEdit,
    AccountingSavedFilterProvider,
    showAccountingSavedFilter,
} from "../bill-filter/accounting";
import { isCancelError } from "../confirm/state";
import { SortableListProvider, showSortableList } from "../sortable";
import { Button } from "../ui/button";

export default function SavedStatisticsViews({
    data,
    bookId,
    selectedId,
    snapshot,
    getFilterEdit,
    onSelect,
    onDelete,
    children,
}: {
    data: AccountingData;
    bookId: string;
    selectedId?: string;
    snapshot: StatisticsViewSnapshot;
    getFilterEdit: (snapshot: StatisticsViewSnapshot) => AccountingFilterEdit;
    onSelect: (view: SavedStatisticsView) => void;
    onDelete: () => void;
    children: ReactNode;
}) {
    const { t } = useAccountingLabels();
    const [managing, setManaging] = useState(false);
    const selectedTab = useRef<HTMLButtonElement>(null);
    const tabs = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (selectedId)
            selectedTab.current?.scrollIntoView({
                block: "nearest",
                inline: "nearest",
            });
        else tabs.current?.scrollTo({ left: 0 });
    }, [selectedId]);
    const { error, submitting, run } = useFormAction();
    const saved = data.statisticsViews ?? [];
    const selected = saved.find((item) => item.id === selectedId);
    const modified =
        selected &&
        !isEqual(snapshot, {
            view: selected.view,
            focus: selected.focus,
            balanceMode: selected.balanceMode,
            filter: selected.filter,
            period: selected.period,
        });
    const update = async (
        transform: (views: SavedStatisticsView[]) => SavedStatisticsView[],
    ) => {
        await accountingStore.getState().updateData((data) => {
            if (accountingStore.getState().current?.book.id !== bookId)
                throw new Error(t("stat-filter-book-changed"));
            return {
                ...data,
                statisticsViews: transform(data.statisticsViews ?? []),
            };
        }, Date.now());
    };
    const edit = (existing?: SavedStatisticsView) => {
        setManaging(false);
        void run(async () => {
            const state = existing ?? snapshot;
            const result = await showAccountingSavedFilter({
                ...getFilterEdit(state),
                name: existing?.name ?? t("new-filter-name"),
            }).catch((error: unknown) => {
                if (isCancelError(error)) return undefined;
                throw error;
            });
            if (!result) return;
            const next: SavedStatisticsView = {
                ...state,
                ...result,
                id: existing?.id ?? v4(),
            };
            await update((views) =>
                existing
                    ? views.map((item) =>
                          item.id === existing.id ? next : item,
                      )
                    : [...views, next],
            );
            onSelect(next);
        });
    };
    return (
        <>
            <div className="w-full flex min-w-0" data-statistics-views>
                <div
                    ref={tabs}
                    className="flex-1 min-w-0 flex gap-1 overflow-x-auto scrollbar-hidden"
                >
                    {children}
                    {saved.map((item) => (
                        <Button
                            key={item.id}
                            ref={
                                selectedId === item.id ? selectedTab : undefined
                            }
                            variant="ghost"
                            size="sm"
                            className={
                                selectedId === item.id
                                    ? "border-b-2 rounded-none border-primary shrink-0"
                                    : "text-muted-foreground shrink-0"
                            }
                            aria-pressed={selectedId === item.id}
                            onClick={() => onSelect(item)}
                        >
                            {item.name}
                            {selectedId === item.id && modified ? " *" : ""}
                        </Button>
                    ))}
                </div>
                <div className="flex items-center shrink-0">
                    {modified && selected && (
                        <Button
                            variant="ghost"
                            size="sm"
                            disabled={submitting}
                            aria-label={t("stat-update-filter")}
                            title={t("stat-update-filter")}
                            onClick={() =>
                                void run(async () => {
                                    const next = { ...selected, ...snapshot };
                                    await update((views) =>
                                        views.map((item) =>
                                            item.id === next.id ? next : item,
                                        ),
                                    );
                                })
                            }
                        >
                            <i
                                aria-hidden
                                className="icon-[mdi--content-save-outline] size-4"
                            />
                        </Button>
                    )}
                    <Button
                        variant="ghost"
                        size="sm"
                        disabled={submitting}
                        aria-label={t("stat-add-filter")}
                        title={t("stat-add-filter")}
                        onClick={() => edit()}
                    >
                        <i aria-hidden className="icon-[mdi--plus] size-4" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        disabled={submitting}
                        aria-label={t("stat-manage-filters")}
                        title={t("stat-manage-filters")}
                        onClick={() => setManaging(true)}
                    >
                        <i aria-hidden className="icon-[mdi--menu] size-4" />
                    </Button>
                </div>
            </div>
            <FormError error={error} />
            {managing && (
                <Modal
                    title={t("stat-manage-filters")}
                    busy={submitting}
                    onClose={() => setManaging(false)}
                >
                    <p className="text-xs text-muted-foreground mb-4">
                        {t("stat-saved-filter-help")}
                    </p>
                    {!saved.length && (
                        <p className="text-sm mb-4">
                            {t("stat-no-saved-filters")}
                        </p>
                    )}
                    <div className="space-y-2">
                        {saved.map((item) => (
                            <div
                                key={item.id}
                                className="border rounded-md px-3 py-2 flex items-center gap-2"
                            >
                                <button
                                    type="button"
                                    className="flex-1 min-w-0 text-left cursor-pointer"
                                    disabled={submitting}
                                    onClick={() => {
                                        onSelect(item);
                                        setManaging(false);
                                    }}
                                >
                                    <span className="block truncate font-medium text-sm">
                                        {item.name}
                                    </span>
                                    <span className="block text-xs text-muted-foreground">
                                        {t(`stat-default-${item.view}`)}
                                    </span>
                                </button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={submitting}
                                    aria-label={t("stat-edit-filter", {
                                        name: item.name,
                                    })}
                                    onClick={() => edit(item)}
                                >
                                    <i
                                        aria-hidden
                                        className="icon-[mdi--pencil-outline] size-4"
                                    />
                                </Button>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={submitting}
                                    aria-label={t("stat-delete-filter", {
                                        name: item.name,
                                    })}
                                    onClick={() =>
                                        void run(async () => {
                                            await update((views) =>
                                                views.filter(
                                                    (view) =>
                                                        view.id !== item.id,
                                                ),
                                            );
                                            if (selectedId === item.id)
                                                onDelete();
                                        })
                                    }
                                >
                                    <i
                                        aria-hidden
                                        className="icon-[mdi--delete-outline] size-4"
                                    />
                                </Button>
                            </div>
                        ))}
                    </div>
                    <FormError error={error} />
                    <div className="flex justify-end gap-2 mt-4">
                        <Button
                            variant="outline"
                            disabled={submitting || saved.length < 2}
                            onClick={() => {
                                setManaging(false);
                                void run(async () => {
                                    const order = await showSortableList(
                                        saved,
                                    ).catch((error: unknown) => {
                                        if (isCancelError(error))
                                            return undefined;
                                        throw error;
                                    });
                                    if (order)
                                        await update((views) =>
                                            order.flatMap((entry) =>
                                                views.filter(
                                                    (item) =>
                                                        item.id === entry.id,
                                                ),
                                            ),
                                        );
                                });
                            }}
                        >
                            {t("sort")}
                        </Button>
                        <Button disabled={submitting} onClick={() => edit()}>
                            {t("stat-add-filter")}
                        </Button>
                    </div>
                </Modal>
            )}
            <AccountingSavedFilterProvider />
            <SortableListProvider />
        </>
    );
}
