import { AnimatePresence, motion, type Transition } from "motion/react";
import { useState } from "react";
import { v4 } from "uuid";
import { useTag } from "@/hooks/use-tag";
import PopupLayout from "@/layouts/popup-layout";
import type { BillTagGroup } from "@/ledger/type";
import { useIntl } from "@/locale";
import { cn } from "@/utils";
import { FormError, useFormAction } from "../accounting/shared";
import Tag from "../tag";
import { Button } from "../ui/button";
import type { EditTag } from "./tag";
import { EditTagProvider, showEditTag } from "./tag-form";
import { EditTagGroupProvider, showEditTagGroup } from "./tag-group-form";

const ListTransition: Transition = {
    layout: {
        duration: 0.2,
        ease: "easeInOut",
    },
};

export default function TagList({
    onCancel,
}: {
    edit?: any;
    onCancel?: () => void;
    onConfirm?: (v: any) => void;
}) {
    const t = useIntl();
    const { updateTag, grouped, updateGroup, topUpGroup } = useTag();
    const { error, submitting, run } = useFormAction();

    const toUpdateTagGroup = async (group?: BillTagGroup) => {
        const newGroup = await showEditTagGroup(group).catch(() => undefined);
        if (newGroup === undefined) return;
        if (newGroup === "delete") {
            if (group?.id) {
                await run(() => updateGroup(group.id, undefined));
            }
            return;
        }
        await run(() => updateGroup(group?.id ?? v4(), newGroup));
    };

    const toUpdateTag = async (tag?: EditTag) => {
        const newTag = await showEditTag(tag).catch(() => undefined);
        if (newTag === undefined) return;
        if (newTag === "delete") {
            if (tag?.id) {
                await run(() => updateTag(tag.id as string, undefined));
            }
            return;
        }
        await run(() => updateTag(tag?.id ?? v4(), newTag));
    };

    const [animate, setAnimate] = useState(false);
    return (
        <PopupLayout
            onBack={onCancel}
            className="overflow-hidden h-full"
            title={t("edit-tags")}
            right={
                <div className="flex items-center gap-2">
                    <Button
                        disabled={submitting}
                        aria-label={t("add-new-tag")}
                        onClick={() => toUpdateTag()}
                        variant="secondary"
                    >
                        <i className="icon-[mdi--tag-plus-outline]"></i>
                    </Button>

                    <Button
                        disabled={submitting}
                        onClick={() => toUpdateTagGroup()}
                    >
                        {t("add-new-tag-group")}
                    </Button>
                </div>
            }
        >
            <FormError error={error} />
            <div className="flex items-center justify-between px-2">
                <div className="px-2 text-xs text-foreground/80">
                    {t("click-tag-to-edit")}
                </div>
            </div>
            <div className="flex-1 overflow-y-auto flex flex-col p-2 gap-2">
                <AnimatePresence initial={false}>
                    {grouped.map((group, index) => {
                        return (
                            <motion.div
                                key={group.id}
                                className="border rounded-md w-full text-sm bg-background"
                                layout="position"
                                initial={false}
                                transition={
                                    animate ? ListTransition : { duration: 0 }
                                }
                            >
                                <div
                                    className={cn(
                                        "flex justify-between items-center with-tag-color px-2 py-1 rounded-t-md bg-[var(--current-tag-color)]",
                                        `tag-${group.color}`,
                                    )}
                                >
                                    <div className="text-white">
                                        {group.id === "un-group"
                                            ? t("un-grouped")
                                            : group.name}
                                    </div>
                                    <div className="flex items-center gap-1 text-white">
                                        {group.id !== "un-group" && (
                                            <>
                                                {index !== 0 && (
                                                    <Button
                                                        size={"sm"}
                                                        variant="ghost"
                                                        onClick={async () => {
                                                            setAnimate(true);
                                                            await Promise.resolve();
                                                            await run(() =>
                                                                topUpGroup(
                                                                    group.id,
                                                                ),
                                                            );
                                                        }}
                                                    >
                                                        <i className="icon-[mdi--arrow-collapse-up]"></i>
                                                    </Button>
                                                )}
                                                <Button
                                                    variant="ghost"
                                                    size={"sm"}
                                                    onClick={() =>
                                                        toUpdateTagGroup(group)
                                                    }
                                                >
                                                    <i className="icon-[mdi--settings]"></i>
                                                </Button>
                                            </>
                                        )}
                                    </div>
                                </div>
                                <div className="flex flex-wrap items-center p-2 gap-2">
                                    {group.tags.map((tag) => (
                                        <Tag
                                            key={tag.id}
                                            className="gap-1 cursor-grab active:cursor-grabbing"
                                            onClick={() => toUpdateTag(tag)}
                                        >
                                            <span>#{tag.name}</span>
                                        </Tag>
                                    ))}
                                    {group.tags.length === 0 && (
                                        <div>{t("none")}</div>
                                    )}
                                </div>
                            </motion.div>
                        );
                    })}
                </AnimatePresence>
            </div>
            <EditTagProvider />
            <EditTagGroupProvider />
        </PopupLayout>
    );
}
