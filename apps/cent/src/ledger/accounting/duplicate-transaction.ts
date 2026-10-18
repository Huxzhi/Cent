import {
    flattenTransactionTree,
    getRootTransactions,
    getTransactionEditTarget,
    synchronizeTransactionChildren,
} from "./transaction";
import type { Transaction } from "./types";

/** 复制完整来源账单，保留交易时间；根和子交易均使用新 ID、创建时间。 */
export function duplicateTransaction(
    transactionId: string,
    transactions: readonly Transaction[],
    now: number,
    generateId: () => string,
): Transaction[] {
    const source = transactions.find((item) => item.id === transactionId);
    if (!source) throw new Error(`Transaction not found: ${transactionId}`);
    const rootId = getTransactionEditTarget(source, transactions).id;
    const root = getRootTransactions(transactions).find(
        (item) => item.id === rootId,
    );
    if (!root) throw new Error(`Transaction not found: ${rootId}`);
    const ids = new Set(transactions.map((item) => item.id));
    const copy = (
        item: Transaction,
        parentTransactionId?: string,
    ): Transaction => {
        const id = generateId();
        if (!id.trim() || ids.has(id))
            throw new Error(`Invalid duplicate transaction ID: ${id}`);
        ids.add(id);
        const { children, ...own } = structuredClone(item);
        return {
            ...own,
            id,
            parentTransactionId,
            createdAt: now,
            updatedAt: now,
            ...(children?.length
                ? { children: children.map((child) => copy(child, id)) }
                : {}),
        };
    };
    return synchronizeTransactionChildren(flattenTransactionTree([copy(root)]));
}
