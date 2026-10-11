import { z } from "zod";
import type { AccountingData } from "./backup";

export interface AccountingTag {
    id: string;
    name: string;
    preferCurrency?: string;
}

export interface AccountingTagGroup {
    id: string;
    name: string;
    color: string;
    singleSelect?: boolean;
    required?: boolean;
    tagIds?: string[];
}

export interface AccountingTagMetadata {
    tags: AccountingTag[];
    groupsByUser: Record<string, AccountingTagGroup[]>;
}

const id = z
    .string()
    .refine((value) => !!value.trim(), "Expected a nonempty ID");
export const accountingTagSchema = z
    .object({
        id,
        name: z.string(),
        preferCurrency: id.optional(),
    })
    .strict() satisfies z.ZodType<AccountingTag>;
export const accountingTagGroupSchema = z
    .object({
        id,
        name: z.string(),
        color: z.string(),
        singleSelect: z.boolean().optional(),
        required: z.boolean().optional(),
        tagIds: z.array(id).optional(),
    })
    .strict() satisfies z.ZodType<AccountingTagGroup>;
export const accountingTagMetadataSchema = z
    .object({
        tags: z.array(accountingTagSchema),
        groupsByUser: z.record(id, z.array(accountingTagGroupSchema)),
    })
    .strict()
    .superRefine((metadata, context) => {
        const unique = (items: { id: string }[]) =>
            new Set(items.map((item) => item.id)).size === items.length;
        if (
            !unique(metadata.tags) ||
            Object.values(metadata.groupsByUser).some(
                (groups) => !unique(groups),
            )
        )
            context.addIssue({
                code: "custom",
                message: "Duplicate tag or tag group ID",
            });
    }) satisfies z.ZodType<AccountingTagMetadata>;

export function getTagMetadata(
    data: Pick<AccountingData, "tagMetadata">,
): AccountingTagMetadata {
    return structuredClone(data.tagMetadata ?? { tags: [], groupsByUser: {} });
}

export function updateAccountingTag(
    data: AccountingData,
    id: string,
    tag?: Omit<AccountingTag, "id">,
): AccountingData {
    const metadata = getTagMetadata(data);
    if (tag) {
        const next = accountingTagSchema.parse({ ...tag, id });
        if (!next.name.trim()) throw new Error("Tag name must not be empty");
        const index = metadata.tags.findIndex((item) => item.id === id);
        if (index < 0) metadata.tags.push(next);
        else metadata.tags[index] = next;
    } else {
        metadata.tags = metadata.tags.filter((item) => item.id !== id);
        for (const groups of Object.values(metadata.groupsByUser))
            for (const group of groups)
                group.tagIds = group.tagIds?.filter((tagId) => tagId !== id);
    }
    return { ...data, tagMetadata: metadata };
}

export function updateAccountingTagGroup(
    data: AccountingData,
    userId: string,
    id: string,
    group?: Omit<AccountingTagGroup, "id">,
): AccountingData {
    const metadata = getTagMetadata(data);
    const groups = metadata.groupsByUser[userId] ?? [];
    if (group) {
        const next = accountingTagGroupSchema.parse({ ...group, id });
        if (!next.name.trim())
            throw new Error("Tag group name must not be empty");
        const index = groups.findIndex((item) => item.id === id);
        if (index < 0) groups.push(next);
        else groups[index] = next;
        metadata.groupsByUser[userId] = groups;
    } else
        metadata.groupsByUser[userId] = groups.filter((item) => item.id !== id);
    return { ...data, tagMetadata: metadata };
}

export function topUpAccountingTagGroup(
    data: AccountingData,
    userId: string,
    id: string,
): AccountingData {
    const metadata = getTagMetadata(data);
    const groups = metadata.groupsByUser[userId] ?? [];
    const target = groups.find((group) => group.id === id);
    if (target)
        metadata.groupsByUser[userId] = [
            target,
            ...groups.filter((group) => group.id !== id),
        ];
    return { ...data, tagMetadata: metadata };
}
