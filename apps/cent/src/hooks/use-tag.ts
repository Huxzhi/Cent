import { useCallback, useMemo } from "react";
import { useStore } from "zustand";
import type { BillTag } from "@/components/bill-tag/type";
import {
    getTagMetadata,
    topUpAccountingTagGroup,
    updateAccountingTag,
    updateAccountingTagGroup,
} from "@/ledger/accounting";
import type { BillTagGroup } from "@/ledger/type";
import { useIntl } from "@/locale";
import { measure } from "@/measurement";
import { accountingStore } from "@/store/accounting";
import { useUserStore } from "@/store/user";

export function useTag() {
    const data = useStore(
        accountingStore,
        (state) => state.current?.data ?? state.preview?.data,
    );
    const userId = useUserStore((state) => String(state.id));
    const t = useIntl();
    const metadata = useMemo(
        () => (data ? getTagMetadata(data) : { tags: [], groupsByUser: {} }),
        [data],
    );
    const tags = metadata.tags;
    const tagGroups = metadata.groupsByUser[userId] ?? [];

    const updateTag = useCallback(
        async (
            id: string,
            newTag: (Omit<BillTag, "id"> & { id?: string }) | undefined,
        ) => {
            const exists = getTagMetadata(
                accountingStore.getState().current?.data ?? {},
            ).tags.some((tag) => tag.id === id);
            const value = newTag && {
                name: newTag.name,
                preferCurrency: newTag.preferCurrency,
            };
            await accountingStore
                .getState()
                .updateData(
                    (current) => updateAccountingTag(current, id, value),
                    Date.now(),
                );
            measure("feature_config_changed", {
                feature: "tag",
                action: !newTag ? "delete" : exists ? "update" : "create",
            });
        },
        [],
    );

    const grouped = useMemo<BillTagGroupDetail[]>(() => {
        const groups = tagGroups.map((group) => ({
            ...group,
            tags: (group.tagIds ?? [])
                .map((id) => tags.find((tag) => tag.id === id))
                .filter((tag) => tag !== undefined),
        }));
        const ungrouped = tags.filter((tag) =>
            tagGroups.every((group) => !group.tagIds?.includes(tag.id)),
        );
        return [
            ...groups,
            {
                id: "un-group",
                name: t("un-grouped"),
                color: "gray",
                tags: ungrouped,
                tagIds: ungrouped.map((tag) => tag.id),
            },
        ];
    }, [tagGroups, tags, t]);

    const updateGroup = useCallback(
        async (
            id: string,
            newGroup: (Omit<BillTagGroup, "id"> & { id?: string }) | undefined,
        ) => {
            const exists = getTagMetadata(
                accountingStore.getState().current?.data ?? {},
            ).groupsByUser[userId]?.some((group) => group.id === id);
            const value = newGroup && {
                name: newGroup.name,
                color: newGroup.color,
                singleSelect: newGroup.singleSelect,
                required: newGroup.required,
                tagIds: newGroup.tagIds,
            };
            await accountingStore
                .getState()
                .updateData(
                    (current) =>
                        updateAccountingTagGroup(current, userId, id, value),
                    Date.now(),
                );
            measure("feature_config_changed", {
                feature: "tag_group",
                action: !newGroup ? "delete" : exists ? "update" : "create",
            });
        },
        [userId],
    );

    const topUpGroup = useCallback(
        (id: string) =>
            accountingStore
                .getState()
                .updateData(
                    (current) => topUpAccountingTagGroup(current, userId, id),
                    Date.now(),
                ),
        [userId],
    );

    return { tags, updateTag, grouped, updateGroup, topUpGroup };
}
export type BillTagGroupDetail = BillTagGroup & { tags: BillTag[] };
