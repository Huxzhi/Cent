import type { Change, StoredRecord } from "@glink25/sync-sdk";
import { isEqual } from "lodash-es";
import {
    type AccountingItem,
    toAccountingItem,
} from "../database/accounting-record";
import { flattenTransactionTree, type Transaction } from "../ledger/accounting";

/** The outer SDK ID identifies this record; embedded children retain their IDs. */
export const ledgerValue = ({ id: _id, ...value }: AccountingItem) => value;

/** Independent rows win, including tombstones; embedded copies cover missing rows. */
export function projectLedgerRecords(
    records: readonly StoredRecord[],
): AccountingItem[] {
    const rows = records.filter((record) => record.collection === "ledger");
    const independent = new Set(rows.map((record) => record.id));
    const items = new Map<string, AccountingItem>();
    for (const row of rows) {
        if (row.value === null) continue;
        const item = {
            ...(row.value as Omit<AccountingItem, "id">),
            id: row.id,
        };
        // Each tree must be valid on its own, even though copies overlap across rows.
        const embedded = flattenTransactionTree<AccountingItem>([
            { ...item, parentTransactionId: undefined },
        ]);
        for (const child of embedded) {
            if (independent.has(child.id)) continue;
            const previous = items.get(child.id);
            if (!previous) {
                items.set(child.id, child);
            } else if (!isEqual(child, previous)) {
                throw new Error(`子交易副本不一致：${child.id}`);
            }
        }
    }
    for (const row of rows) {
        if (row.value === null) continue;
        const { children: _children, ...value } = row.value as AccountingItem;
        items.set(row.id, { ...value, id: row.id });
    }
    return [...items.values()];
}

/** Store every transaction and every ancestor snapshot in the same SDK batch. */
export function ledgerRecordChanges(
    records: readonly StoredRecord[],
    transactions: readonly Transaction[],
): Change[] {
    const previous = new Map(
        records
            .filter(
                (record) =>
                    record.collection === "ledger" && record.value !== null,
            )
            .map((record) => [record.id, record.value]),
    );
    const changes: Change[] = [];
    for (const transaction of transactions) {
        const value = JSON.parse(
            JSON.stringify(ledgerValue(toAccountingItem(transaction))),
        );
        if (!isEqual(previous.get(transaction.id), value)) {
            changes.push({
                type: "put",
                collection: "ledger",
                recordId: transaction.id,
                value,
            });
        }
        previous.delete(transaction.id);
    }
    for (const recordId of previous.keys()) {
        changes.push({ type: "delete", collection: "ledger", recordId });
    }
    return changes;
}
