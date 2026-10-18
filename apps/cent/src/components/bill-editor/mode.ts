import {
    type Account,
    amountToDecimal,
    type Entry,
    getCurrencyExpenseCategory,
    getEntryAmount,
} from "../../ledger/accounting";

/** 从当前分录预填简易模式，付款/收款角色按所选模式解释，不按旧 type 锁定。 */
export function getQuickModeDraft(
    mode: "expense" | "income",
    entries: readonly Entry[],
    accounts: readonly Account[],
) {
    const payment = entries.find((entry) => {
        const account = accounts.find((item) => item.id === entry.accountId);
        return (
            account &&
            (mode === "expense"
                ? getEntryAmount(entry) < 0 &&
                  ["asset", "liability"].includes(account.type)
                : getEntryAmount(entry) > 0 && account.type === "asset")
        );
    });
    const category = entries.find(
        (entry) =>
            accounts.find((account) => account.id === entry.accountId)?.type ===
                mode &&
            (mode === "expense"
                ? getEntryAmount(entry) > 0
                : getEntryAmount(entry) < 0),
    );
    const amountEntry =
        payment ?? entries.find((entry) => getEntryAmount(entry) > 0);
    const amount = amountEntry ? Math.abs(getEntryAmount(amountEntry)) : 0;
    const categoryAccount = accounts.find(
        (account) => account.id === category?.accountId,
    );
    return {
        leftId: payment?.accountId ?? "",
        rightId:
            categoryAccount && mode === "expense"
                ? getCurrencyExpenseCategory(categoryAccount, accounts).id
                : (category?.accountId ?? ""),
        amount: amount ? amountToDecimal(amount) : "",
        currency: accounts.find((account) => account.id === payment?.accountId)
            ?.currency,
    };
}
