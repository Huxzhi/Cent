import {
    type CurrencyExchangeInput,
    createCurrencyExchange,
} from "./currency-exchange";
import { canReclassifyTransaction, createJournalTransaction } from "./journal";
import { retainTransactionMedia } from "./transaction-media";
import type { Account, Transaction } from "./types";
import { validateTransactions } from "./validation";

/** 到账账户决定业务类型，账户币种决定分录结构。 */
export function getFundingTransactionType(
    from: Account,
    to: Account,
): "topup" | "currency_exchange" | "transfer" {
    if (to.subtype === "prepaid") return "topup";
    return from.currency === to.currency ? "transfer" : "currency_exchange";
}

/** 录入模式可互相切换，仍替换同一笔手工交易。 */
export function canEditFundingTransaction(
    transaction: Transaction,
    accounts: readonly Account[],
) {
    return canReclassifyTransaction(transaction, accounts);
}

/** 同一入口录入换汇与充值；同币种等额转入只有两条资产分录。 */
export function saveFundingTransaction(
    input: Omit<CurrencyExchangeInput, "type">,
    accounts: readonly Account[],
    transactions: readonly Transaction[],
    now: number,
    trading: Parameters<typeof createCurrencyExchange>[4],
    edit = false,
) {
    const original = edit
        ? transactions.find((item) => item.id === input.id)
        : undefined;
    if (edit && (!original || !canEditFundingTransaction(original, accounts)))
        throw new Error("Funding transaction not found");
    const history = edit
        ? transactions.filter((item) => item.id !== input.id)
        : transactions;
    const from = accounts.find((item) => item.id === input.fromAccountId);
    const to = accounts.find((item) => item.id === input.toAccountId);
    if (!from || !to) throw new Error("Select funding accounts");
    const type = getFundingTransactionType(from, to);
    const candidate = {
        ...input,
        type,
        creatorId: original?.creatorId ?? input.creatorId,
        tagIds: input.tagIds ?? original?.tagIds,
    };
    let result: { accounts: Account[]; transaction: Transaction };
    if (from.currency === to.currency) {
        if (
            input.withdrawn !== input.received ||
            input.fee !== 0 ||
            from.type !== "asset" ||
            to.type !== "asset"
        )
            throw new Error(
                "Same-currency funding must have equal amounts and no fee",
            );
        result = {
            accounts: [...accounts],
            transaction: createJournalTransaction(
                {
                    ...candidate,
                    type: type === "topup" ? "topup" : "transfer",
                    currency: from.currency,
                    entries: [
                        { accountId: from.id, amount: -input.withdrawn },
                        { accountId: to.id, amount: input.received },
                    ],
                },
                accounts,
                history,
                now,
            ),
        };
        if (input.withdrawn <= 0)
            throw new Error("Funding amount must be positive");
    } else
        result = createCurrencyExchange(
            {
                ...candidate,
                type: type === "topup" ? "topup" : "currency_exchange",
            },
            accounts,
            history,
            now,
            trading,
        );
    if (original)
        result.transaction = {
            ...result.transaction,
            ...retainTransactionMedia(input, original),
            creatorId: original.creatorId,
            createdAt: original.createdAt,
            updatedAt: Math.max(now, original.updatedAt),
        };
    validateTransactions([...history, result.transaction], result.accounts);
    return result;
}
