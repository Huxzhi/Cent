import { Base64 } from "js-base64";
import { transactionImageSchema } from "../../ledger/accounting/transaction-media";

/** 与原编辑器支持的格式一致，字节随新的账本快照一起保存。 */
export async function readTransactionImage(file: File, id: string) {
    return transactionImageSchema.parse({
        id,
        name: file.name,
        dataUrl: `data:${file.type};base64,${Base64.fromUint8Array(new Uint8Array(await file.arrayBuffer()))}`,
    });
}
