import { createStore } from "zustand/vanilla";
import {
    type AccountingBook,
    type AccountingRepository,
    accountingRepository,
    type LoadedAccountingBook,
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
import { createDefaultAccountingData } from "./default-accounting-data";

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
    ready: boolean;
    busy: boolean;
    error?: string;
    initialize(preferredBookId?: string): Promise<void>;
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

/** 可注入 repository 测试；串行执行操作，写入成功后才更新可见状态。 */
export function createAccountingStore(repository: AccountingRepository) {
    let queue: Promise<void> = Promise.resolve();
    let initialization: Promise<void> | undefined;
    return createStore<AccountingStore>()((set, get) => {
        const run = (operation: () => Promise<void>): Promise<void> => {
            const next = queue.then(async () => {
                set({ busy: true, error: undefined });
                try {
                    await operation();
                } catch (error) {
                    set({
                        error:
                            error instanceof Error
                                ? error.message
                                : "账本操作失败，请重试。",
                    });
                    throw error;
                } finally {
                    set({ busy: false });
                }
            });
            queue = next.catch(() => {});
            return next;
        };
        const apply = (current: LoadedAccountingBook) =>
            set({
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
        return {
            books: [],
            ready: false,
            busy: false,
            initialize(preferredBookId) {
                if (get().ready) return Promise.resolve();
                if (initialization) return initialization;
                initialization = run(async () => {
                    const books = await repository.listBooks();
                    set({ books });
                    if (books.length === 0) {
                        try {
                            const now = Date.now();
                            apply(
                                await repository.createBook(
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
                            apply(await repository.loadBook("main"));
                        }
                    } else
                        apply(
                            await repository.loadBook(
                                books.find(
                                    (book) => book.id === preferredBookId,
                                )?.id ?? books[0].id,
                            ),
                        );
                    set({ ready: true });
                }).finally(() => {
                    initialization = undefined;
                });
                return initialization;
            },
            selectBook: (id) =>
                run(async () => {
                    apply(await repository.loadBook(id));
                }),
            addBook: (id, name, now, data) =>
                run(async () => {
                    apply(
                        await repository.createBook(
                            id,
                            name,
                            now,
                            withAccountCurrencies(
                                data ?? createDefaultAccountingData(now),
                            ),
                        ),
                    );
                }),
            reload: () =>
                run(async () => {
                    const id = get().current?.book.id;
                    set({ books: await repository.listBooks() });
                    if (id) apply(await repository.loadBook(id));
                }),
            synchronize: (operation) =>
                run(async () => {
                    const current = get().current;
                    if (!current) throw new Error("请先选择账本。");
                    const result = await operation(current);
                    set({ books: await repository.listBooks() });
                    apply(result);
                }),
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
                        await repository.saveBook(
                            current.book.id,
                            current.book.revision,
                            recalculated,
                            now,
                        ),
                    );
                });
            },
        };
    });
}

export const accountingStore = createAccountingStore(accountingRepository);
