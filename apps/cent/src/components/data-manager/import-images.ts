import { base64ToFile } from "../../utils/file";
import { readTransactionImage } from "../accounting/transaction-image";

/** Inline local backup images before they enter the accounting domain. */
export async function prepareBillImages(bills: readonly unknown[]) {
    return Promise.all(
        bills.map(async (value) => {
            if (!value || typeof value !== "object")
                throw new Error("无效的导入账单。");
            const bill = value as { images?: unknown[] };
            if (!bill.images) return value;
            if (!Array.isArray(bill.images))
                throw new Error("无效的账单图片列表。");
            const images = await Promise.all(
                bill.images.map(async (image, index) => {
                    const id = `import-image-${index + 1}`;
                    if (image instanceof File)
                        return readTransactionImage(image, id);
                    if (typeof image === "string") {
                        if (!image.startsWith("data:image/"))
                            throw new Error(
                                "图片仍是远端链接，请导入包含图片文件的 ZIP 备份。",
                            );
                        return readTransactionImage(
                            await base64ToFile(image),
                            id,
                        );
                    }
                    return image;
                }),
            );
            return { ...value, images };
        }),
    );
}
