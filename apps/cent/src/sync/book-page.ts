import {
    type createSyncSDK,
    type QueryCursor,
    type StoredRecord,
    SyncError,
    sameStateVersion,
} from "@glink25/sync-sdk";
import type { AccountingBook } from "../database/accounting";
import {
    type AccountingItem,
    type AccountingMeta,
    fromFlatAccountingRecords,
} from "../database/accounting-record";
import {
    type AccountingData,
    synchronizeTransactionChildren,
    validateTransaction,
} from "../ledger/accounting";
import { projectLedgerRecords } from "./records";

export const BOOK_PAGE_SIZE = 50;
/** Read-only page, never a complete snapshot suitable for saving or statistics. */
export interface AccountingBookPage {
    book: AccountingBook;
    data: AccountingData;
    cursor?: QueryCursor;
}

export async function readLedgerPage(
    sdk: ReturnType<typeof createSyncSDK>,
    book: AccountingBook,
    meta: AccountingMeta,
    cursor?: QueryCursor,
): Promise<AccountingBookPage> {
    const roots: StoredRecord[] = [];
    let next = cursor;
    // Child rows have their own index entries but are displayed with their root.
    do {
        const page = await sdk.store.query<AccountingItem>({
            collection: "ledger",
            orderBy: "time",
            direction: "asc",
            limit: BOOK_PAGE_SIZE,
            cursor: next,
        });
        for (const record of page.records) {
            if (record._sync.conflicted)
                throw new SyncError(
                    "RECORD_CONFLICT",
                    "请先解决账本的并发修改。",
                );
            if (record.value && !record.value.parentTransactionId)
                roots.push(record);
        }
        next = page.cursor;
    } while (!roots.length && next);
    const ids = new Set<string>();
    const collect = (item: AccountingItem) => {
        for (const child of item.children ?? []) {
            ids.add(child.id);
            collect(child);
        }
    };
    for (const root of roots)
        collect({ ...(root.value as AccountingItem), id: root.id });
    const children: StoredRecord[] = [];
    const fetched = new Set<string>();
    let pending = [...ids];
    while (pending.length) {
        const rows = await sdk.store.getMany<AccountingItem>("ledger", pending);
        for (const id of pending) fetched.add(id);
        for (const row of rows) {
            if (!row) continue;
            children.push(row);
            if (row.value) collect({ ...row.value, id: row.id });
        }
        pending = [...ids].filter((id) => !fetched.has(id));
    }
    if (children.some((row) => row._sync.conflicted))
        throw new SyncError("RECORD_CONFLICT", "请先解决账本的并发修改。");
    const data = fromFlatAccountingRecords(
        meta,
        projectLedgerRecords([...roots, ...children]),
    );
    const transactions = synchronizeTransactionChildren(data.transactions);
    for (const transaction of transactions)
        validateTransaction(transaction, data.accounts);
    if (!sameStateVersion(book.version, await sdk.config.getState()))
        throw new SyncError("CURSOR_EXPIRED", "账本已更新，请重新加载列表。");
    return { book, data: { ...data, transactions }, cursor: next };
}
