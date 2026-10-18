import { SyncError, sameStateVersion } from "@glink25/sync-sdk";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AccountingBook } from "../database/accounting";
import { accountingBooks } from "../sync/accounting";
import type { AccountingBookPage } from "../sync/book-page";

export function useBookPages(
    book: AccountingBook | undefined,
    seed?: AccountingBookPage,
) {
    const [page, setPage] = useState(seed);
    const [loading, setLoading] = useState(!seed);
    const [error, setError] = useState<string>();
    const [attempt, setAttempt] = useState(0);
    const generation = useRef(0);
    const pending = useRef(false);
    const id = book?.id,
        writerSeq = book?.version.writerSeq,
        repoSeq = book?.version.repoSeq;
    // Only a different book/version starts a new cursor chain; the full snapshot may arrive later.
    // biome-ignore lint/correctness/useExhaustiveDependencies: Version fields are the complete query identity.
    useEffect(() => {
        const request = ++generation.current;
        pending.current = false;
        setError(undefined);
        if (!book) {
            setPage(undefined);
            setLoading(false);
            return () => {
                generation.current++;
            };
        }
        if (
            seed?.book.id === book.id &&
            attempt === 0 &&
            sameStateVersion(seed.book.version, book.version)
        ) {
            setPage(seed);
            setLoading(false);
            return () => {
                generation.current++;
            };
        }
        setPage(undefined);
        setLoading(true);
        pending.current = true;
        void accountingBooks
            .readBookPage(book.id)
            .then((result) => {
                if (request === generation.current) setPage(result);
            })
            .catch((failure) => {
                if (request === generation.current)
                    setError(
                        failure instanceof Error
                            ? failure.message
                            : "加载账单失败",
                    );
            })
            .finally(() => {
                if (request === generation.current) {
                    pending.current = false;
                    setLoading(false);
                }
            });
        return () => {
            generation.current++;
        };
    }, [id, writerSeq, repoSeq, attempt]);
    const loadMore = useCallback(async () => {
        if (
            !id ||
            pending.current ||
            !page?.cursor ||
            page.book.id !== id ||
            page.book.version.writerSeq !== writerSeq ||
            page.book.version.repoSeq !== repoSeq
        )
            return;
        const request = generation.current;
        pending.current = true;
        setLoading(true);
        setError(undefined);
        try {
            let result: AccountingBookPage;
            try {
                result = await accountingBooks.readBookPage(id, page.cursor);
            } catch (failure) {
                if (
                    !(failure instanceof SyncError) ||
                    failure.code !== "CURSOR_EXPIRED"
                )
                    throw failure;
                result = await accountingBooks.readBookPage(id);
                if (request === generation.current) setPage(result);
                return;
            }
            if (request !== generation.current) return;
            const transactions = new Map(
                page.data.transactions.map((tx) => [tx.id, tx]),
            );
            for (const transaction of result.data.transactions)
                transactions.set(transaction.id, transaction);
            setPage({
                ...result,
                data: {
                    ...result.data,
                    transactions: [...transactions.values()],
                },
            });
        } catch (failure) {
            if (request === generation.current)
                setError(
                    failure instanceof Error ? failure.message : "加载账单失败",
                );
        } finally {
            if (request === generation.current) {
                pending.current = false;
                setLoading(false);
            }
        }
    }, [id, page, writerSeq, repoSeq]);
    const visiblePage =
        page &&
        page.book.id === id &&
        page.book.version.writerSeq === writerSeq &&
        page.book.version.repoSeq === repoSeq
            ? page
            : seed &&
                seed.book.id === id &&
                seed.book.version.writerSeq === writerSeq &&
                seed.book.version.repoSeq === repoSeq
              ? seed
              : undefined;
    return {
        page: visiblePage,
        loading: loading || (!visiblePage && !error && !!id),
        error,
        loadMore,
        retry: () => setAttempt((value) => value + 1),
    };
}
