import { z } from "zod";

export interface TransactionLocation {
    latitude: number;
    longitude: number;
    accuracy: number;
}
export interface TransactionImage {
    id: string;
    name: string;
    /** 图片字节随账本备份保存，不依赖旧 Bill 的附件服务。 */
    dataUrl: string;
}
export interface TransactionMedia {
    /** null 表示编辑时明确取消位置；undefined 表示没有提供修改。 */
    location?: TransactionLocation | null;
    images?: TransactionImage[];
}
export interface AccountingMapConfig {
    amapKey?: string;
    amapSecurityCode?: string;
}

export const transactionLocationSchema = z
    .object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        accuracy: z.number().nonnegative(),
    })
    .strict() satisfies z.ZodType<TransactionLocation>;
export const transactionImageSchema = z
    .object({
        id: z.string().refine((id) => !!id.trim()),
        name: z.string().min(1),
        dataUrl: z
            .string()
            .regex(
                /^data:image\/(?:png|jpeg|gif|webp);base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
            )
            .refine((url) => !!url.split(",")[1]),
    })
    .strict() satisfies z.ZodType<TransactionImage>;
export const transactionImagesSchema = z
    .array(transactionImageSchema)
    .max(3)
    .refine(
        (images) =>
            new Set(images.map((image) => image.id)).size === images.length,
        "Duplicate image ID",
    );
export const accountingMapConfigSchema = z
    .object({
        amapKey: z.string().optional(),
        amapSecurityCode: z.string().optional(),
    })
    .strict() satisfies z.ZodType<AccountingMapConfig>;

export function copyTransactionMedia(
    input: TransactionMedia,
): TransactionMedia {
    return {
        ...(input.location === undefined
            ? {}
            : {
                  location:
                      input.location === null
                          ? null
                          : transactionLocationSchema.parse(input.location),
              }),
        ...(input.images === undefined
            ? {}
            : { images: transactionImagesSchema.parse(input.images) }),
    };
}

/** 未涉及媒体的其他编辑器保留媒体；显式 null/[] 可以清除。 */
export function retainTransactionMedia(
    input: TransactionMedia,
    original: TransactionMedia,
): TransactionMedia {
    return copyTransactionMedia({
        location:
            input.location === undefined ? original.location : input.location,
        images: input.images === undefined ? original.images : input.images,
    });
}
