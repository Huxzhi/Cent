import { sameStateVersion } from "@glink25/sync-sdk";
import { createStore } from "zustand/vanilla";
import type {
    AccountingBook,
    LoadedAccountingBook,
} from "../database/accounting";
import {
    type AccountingData,
    recalculateCurrencyTransactions,
} from "../ledger/accounting";
import {
    defaultCurrencySettings,
    enableAccountCurrencies,
} from "../ledger/accounting/currency-settings";
import { organizeCurrencyTradingAccounts } from "../ledger/accounting/currency-trading";
import {
    type AccountingBooks,
    AccountingProjectionError,
    AccountingSyncConflictError,
    accountingBooks,
} from "../sync/accounting";
import type { AccountingBookPage } from "../sync/book-page";
import { createDefaultAccountingData } from "./default-accounting-data";

export const ACTIVE_BOOK_KEY = "cent-accounting-active-book";

const withAccountCurrencies = (data: AccountingData): AccountingData => {
    const previous = data.currencySettings ?? defaultCurrencySettings;
    const settings = enableAccountCurrencies(previous, data.accounts);
    return settings === previous
        ? data
        : { ...data, currencySettings: settings };
};

const withTradingHierarchy = (
    data: AccountingData,
    now: number,
): AccountingData => ({
    ...data,
    accounts: organizeCurrencyTradingAccounts(
        data.accounts,
        data.currencySettings?.baseCurrency ?? "CNY",
        now,
    ),
});

export interface AccountingStore {
    books: AccountingBook[];
    current?: LoadedAccountingBook;
    preview?: AccountingBookPage;
    ready: boolean;
    busy: boolean;
    syncing: boolean;
    error?: string;
    syncError?: string;
    conflict?: AccountingSyncConflictError;
    initialize(
        preferredBookId?: string,
        options?: {
            createDefault?: boolean;
            selectFirst?: boolean;
        },
    ): Promise<void>;
    selectBook(id: string): Promise<void>;
    addBook(
        id: string,
        name: string,
        now: number,
        data?: AccountingData,
    ): Promise<void>;
    reload(): Promise<void>;
    updateData(
        transform: (
            data: AccountingData,
        ) => AccountingData | Promise<AccountingData>,
        now: number,
    ): Promise<void>;
    synchronize(
        operation: (
            book: LoadedAccountingBook,
        ) => Promise<LoadedAccountingBook>,
    ): Promise<void>;
}

/** 本地事务串行提交并立即显示；网络同步独立运行，完成后读取最新本地快照。 */
export function createAccountingStore(
    booksService: Pick<
        AccountingBooks,
        "listBooks" | "openBook" | "createBook" | "saveBook"
    > &
        Partial<Pick<AccountingBooks, "readBookPage">>,
) {
    let queue: Promise<void> = Promise.resolve();
    let syncQueue: Promise<void> = Promise.resolve();
    let syncCount = 0;
    let selection = 0;
    let initialization: Promise<void> | undefined;
    return createStore<AccountingStore>()((set, get) => {
        const run = (
            operation: () => Promise<void>,
            background = false,
        ): Promise<void> => {
            const next = queue.then(async () => {
                if (!background) set({ busy: true, error: undefined });
                try {
                    await operation();
                } catch (error) {
                    if (error instanceof AccountingProjectionError)
                        set({
                            current: undefined,
                            preview: undefined,
                            ready: false,
                            conflict: undefined,
                        });
                    if (error instanceof AccountingSyncConflictError)
                        set({
                            current: undefined,
                            preview: undefined,
                            ready: true,
                            conflict: error,
                        });
                    if (
                        !background ||
                        error instanceof AccountingProjectionError ||
                        error instanceof AccountingSyncConflictError
                    )
                        set({
                            error:
                                error instanceof Error
                                    ? error.message
                                    : "账本操作失败，请重试。",
                        });
                    throw error;
                } finally {
                    if (!background) set({ busy: false });
                }
            });
            queue = next.catch(() => {});
            return next;
        };
        const apply = (current: LoadedAccountingBook) =>
            set({
                conflict: undefined,
                preview:
                    get().preview?.book.id === current.book.id &&
                    sameStateVersion(
                        get().preview!.book.version,
                        current.book.version,
                    )
                        ? get().preview
                        : undefined,
                ...(get().current?.book.id !== current.book.id
                    ? { syncError: undefined }
                    : {}),
                current: {
                    ...current,
                    data: withTradingHierarchy(
                        current.data,
                        current.book.updatedAt,
                    ),
                },
                books: get().books.some((book) => book.id === current.book.id)
                    ? get().books.map((book) =>
                          book.id === current.book.id ? current.book : book,
                      )
                    : [...get().books, current.book],
            });
        const open = async (id: string) => {
            if (booksService.readBookPage && get().current?.book.id !== id) {
                try {
                    const preview = await booksService.readBookPage(id);
                    set({ preview, current: undefined });
                    // Give the first indexed page a paint before preparing the full ledger.
                    await new Promise<void>((resolve) => {
                        const timer = setTimeout(resolve, 50);
                        if (typeof requestAnimationFrame === "function")
                            requestAnimationFrame(() => {
                                clearTimeout(timer);
                                setTimeout(resolve, 0);
                            });
                    });
                } catch {
                    // Full opening reports conflicts/projection failures with their existing UI.
                }
            }
            apply(await booksService.openBook(id));
        };
        const refreshAfterSync = (id: string, requestedSelection: number) =>
            run(async () => {
                if (selection !== requestedSelection) return;
                try {
                    const books = await booksService.listBooks();
                    const current = await booksService.openBook(id);
                    if (selection !== requestedSelection) return;
                    if (get().current?.book.id !== id) selection++;
                    set({ books });
                    apply(current);
                } catch (error) {
                    // A late response for a book the user left cannot clear the new book.
                    if (selection === requestedSelection) throw error;
                }
            }, true);
        return {
            books: [],
            ready: false,
            busy: false,
            syncing: false,
            initialize(preferredBookId, options = {}) {
                if (get().ready) return Promise.resolve();
                if (initialization) return initialization;
                initialization = run(async () => {
                    const books = await booksService.listBooks();
                    set({ books });
                    const selected =
                        books.find((book) => book.id === preferredBookId) ??
                        (options.selectFirst === false ? undefined : books[0]);
                    if (books.length === 0 && options.createDefault !== false) {
                        try {
                            const now = Date.now();
                            apply(
                                await booksService.createBook(
                                    "main",
                                    "我的账本",
                                    now,
                                    createDefaultAccountingData(now),
                                ),
                            );
                        } catch (error) {
                            if (
                                !(error instanceof Error) ||
                                error.name !== "ConstraintError"
                            )
                                throw error;
                            apply(await booksService.openBook("main"));
                        }
                    } else if (selected) await open(selected.id);
                    set({ ready: true });
                }).finally(() => {
                    initialization = undefined;
                });
                return initialization;
            },
            selectBook: (id) => {
                selection++;
                return run(async () => {
                    await open(id);
                });
            },
            addBook: (id, name, now, data) => {
                selection++;
                return run(async () => {
                    apply(
                        await booksService.createBook(
                            id,
                            name,
                            now,
                            withAccountCurrencies(
                                data ?? createDefaultAccountingData(now),
                            ),
                        ),
                    );
                });
            },
            reload: () =>
                run(async () => {
                    const id = get().current?.book.id;
                    set({ books: await booksService.listBooks() });
                    if (id) apply(await booksService.openBook(id));
                }),
            synchronize: (operation) => {
                const requestedBookId = get().current?.book.id;
                const requestedSelection = selection;
                syncCount++;
                set({ syncing: true, syncError: undefined });
                const next = syncQueue
                    .then(async () => {
                        // Finish already queued local commits, then release the local queue
                        // throughout network I/O so editing and switching books remain usable.
                        await queue;
                        const current = get().current;
                        if (!current) throw new Error("请先选择账本。");
                        if (
                            selection !== requestedSelection ||
                            current.book.id !== requestedBookId
                        )
                            return;
                        let result = current;
                        let failure: unknown;
                        try {
                            result = await operation(structuredClone(current));
                        } catch (error) {
                            failure = error;
                        }
                        // Read once, including imports committed before a later upload
                        // failure. The result snapshot can predate edits during upload.
                        try {
                            await refreshAfterSync(
                                result.book.id,
                                requestedSelection,
                            );
                        } catch (error) {
                            failure ??= error;
                        }
                        if (failure !== undefined) {
                            if (selection === requestedSelection)
                                set({
                                    syncError:
                                        failure instanceof Error
                                            ? failure.message
                                            : "账本同步失败，请稍后重试。",
                                });
                            throw failure;
                        }
                    })
                    .finally(() => {
                        syncCount--;
                        set({ syncing: syncCount > 0 });
                    });
                syncQueue = next.catch(() => {});
                return next;
            },
            updateData: (transform, now) => {
                const requestedBookId = get().current?.book.id;
                return run(async () => {
                    const current = get().current;
                    if (!current) throw new Error("请先选择账本。");
                    if (current.book.id !== requestedBookId)
                        throw new Error("账本已切换，请重新打开编辑窗口。");
                    // 给 reducer 独立副本，失败或修改 reducer 输入不会污染当前可见状态。
                    const copy = structuredClone(current.data);
                    const data = withAccountCurrencies(
                        withTradingHierarchy(await transform(copy), now),
                    );
                    const recalculated = {
                        ...data,
                        transactions: recalculateCurrencyTransactions(
                            data.transactions,
                            data.accounts,
                            now,
                            data.currencySettings?.baseCurrency,
                        ),
                    };
                    apply(
                        await booksService.saveBook(
                            current.book.id,
                            current.book.version,
                            recalculated,
                            now,
                        ),
                    );
                });
            },
        };
    });
}

export const accountingStore = createAccountingStore(accountingBooks);
