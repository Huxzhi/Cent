import {
    type Account,
    type AccountType,
    amountToDecimal,
    decimalToAmount,
    type Entry,
    sumAmounts,
} from "../../ledger/accounting";
import { calculateAmount } from "./amount-calculator";

export interface JournalDraftEntry {
    id: string;
    accountId: string;
    side: "debit" | "credit";
    amount: string;
}

export function getTransferAccounts(
    rows: readonly JournalDraftEntry[],
    accounts: readonly Account[],
) {
    const availableAssets = accounts.filter(
        (account) =>
            !account.archived &&
            account.type === "asset" &&
            (account.subtype !== "prepaid" || !!account.costCurrency),
    );
    const assets = availableAssets.filter(
        (account) => !account.paymentDisabled,
    );
    const from = assets.find(
        (account) =>
            account.id === rows.find((row) => row.side === "credit")?.accountId,
    );
    const destinations = from
        ? availableAssets.filter(
              (account) =>
                  account.id !== from.id && account.currency === from.currency,
          )
        : [];
    const to = destinations.find(
        (account) =>
            account.id === rows.find((row) => row.side === "debit")?.accountId,
    );
    return { assets, from, destinations, to };
}

/** 更换转出账户后，保留同币种的有效转入账户，其余选择清空。 */
export function selectTransferAccount(
    rows: readonly JournalDraftEntry[],
    accounts: readonly Account[],
    side: JournalDraftEntry["side"],
    accountId: string,
): JournalDraftEntry[] {
    const next = rows.map((row) =>
        row.side === side ? { ...row, accountId } : { ...row },
    );
    const { from, to } = getTransferAccounts(next, accounts);
    return next.map((row) => ({
        ...row,
        accountId: (row.side === "credit" ? from : to)?.id ?? "",
    }));
}
export type JournalTemplate =
    | "currency_exchange"
    | "custom"
    | "liability_payment"
    | "transfer"
    | "asset_purchase"
    | "liability_borrowing"
    | "depreciation";

export type PairedJournalTemplate = Exclude<
    JournalTemplate,
    "custom" | "currency_exchange"
>;
const accountRoles: Record<
    PairedJournalTemplate,
    { from: AccountType[]; to: AccountType[] }
> = {
    transfer: { from: ["asset"], to: ["asset"] },
    liability_payment: { from: ["asset"], to: ["liability"] },
    asset_purchase: { from: ["asset", "liability"], to: ["asset"] },
    liability_borrowing: { from: ["liability"], to: ["asset"] },
    depreciation: { from: ["asset"], to: ["expense"] },
};
export function isPairedTemplate(
    template: JournalTemplate,
): template is PairedJournalTemplate {
    return template !== "custom" && template !== "currency_exchange";
}

/** 业务表单只显示有效角色，同币种的另一方才可配对。 */
export function getPairedTemplateAccounts(
    template: PairedJournalTemplate,
    rows: readonly JournalDraftEntry[],
    accounts: readonly Account[],
) {
    const active = accounts.filter(
        (account) =>
            !account.archived &&
            account.subtype !== "currency_trading" &&
            (account.subtype !== "prepaid" || !!account.costCurrency),
    );
    const sources = active.filter(
        (account) =>
            accountRoles[template].from.includes(account.type) &&
            (template === "depreciation" || !account.paymentDisabled),
    );
    const from = sources.find(
        (account) =>
            account.id === rows.find((row) => row.side === "credit")?.accountId,
    );
    const destinations = from
        ? active.filter(
              (account) =>
                  account.id !== from.id &&
                  account.currency === from.currency &&
                  accountRoles[template].to.includes(account.type),
          )
        : [];
    const to = destinations.find(
        (account) =>
            account.id === rows.find((row) => row.side === "debit")?.accountId,
    );
    return { sources, from, destinations, to };
}
export function selectPairedTemplateAccount(
    template: PairedJournalTemplate,
    rows: readonly JournalDraftEntry[],
    accounts: readonly Account[],
    side: JournalDraftEntry["side"],
    accountId: string,
) {
    const next = rows.map((row) =>
        row.side === side ? { ...row, accountId } : { ...row },
    );
    const { from, to } = getPairedTemplateAccounts(template, next, accounts);
    return next.map((row) => ({
        ...row,
        accountId: (row.side === "credit" ? from : to)?.id ?? "",
    }));
}
/** 复杂或非标准分录保留在自由编辑器，不因类型名称而丢失条目。 */
export function matchesPairedTemplate(
    template: PairedJournalTemplate,
    rows: readonly JournalDraftEntry[],
    accounts: readonly Account[],
) {
    if (
        rows.length !== 2 ||
        rows.filter((row) => row.side === "credit").length !== 1 ||
        rows.filter((row) => row.side === "debit").length !== 1
    )
        return false;
    const { from, to } = getPairedTemplateAccounts(template, rows, accounts);
    if (!from || !to) return false;
    try {
        return getDraftTotals(rows).difference === 0;
    } catch {
        return false;
    }
}

export function entriesToDraft(
    entries: readonly Entry[],
    makeId: () => string = () => crypto.randomUUID(),
): JournalDraftEntry[] {
    return entries.map((entry) => ({
        id: makeId(),
        accountId: entry.accountId,
        side: entry.amount > 0 ? "debit" : "credit",
        amount: amountToDecimal(Math.abs(entry.amount)),
    }));
}
export function draftToEntries(rows: readonly JournalDraftEntry[]): Entry[] {
    return rows.map((row) => {
        const amount = decimalToAmount(calculateAmount(row.amount));
        if (amount <= 0) throw new Error("Entry amount must be positive");
        return {
            accountId: row.accountId,
            amount: row.side === "debit" ? amount : -amount,
        };
    });
}
export function getDraftTotals(rows: readonly JournalDraftEntry[]) {
    const entries = draftToEntries(rows);
    const debit = sumAmounts(
        entries
            .filter((entry) => entry.amount > 0)
            .map((entry) => entry.amount),
    );
    const credit = sumAmounts(
        entries
            .filter((entry) => entry.amount < 0)
            .map((entry) => -entry.amount),
    );
    return { debit, credit, difference: sumAmounts([debit, -credit]) };
}

/** 普通业务预选同币种的角色账户，复杂交易由自由分录继续编辑。 */
export function createTemplateDraft(
    template: JournalTemplate,
    accounts: readonly Account[],
    amount: string,
    makeId: () => string,
): JournalDraftEntry[] {
    if (template === "transfer") {
        const { assets } = getTransferAccounts([], accounts);
        const from =
            assets.find((account) => account.presetKey === "starter:asset") ??
            assets[0];
        const { destinations } = getTransferAccounts(
            from
                ? [{ id: "source", accountId: from.id, side: "credit", amount }]
                : [],
            accounts,
        );
        const to = destinations[0];
        return [
            { id: makeId(), accountId: to?.id ?? "", side: "debit", amount },
            { id: makeId(), accountId: from?.id ?? "", side: "credit", amount },
        ];
    }
    const active = accounts.filter(
        (account) => !account.archived && account.subtype !== "prepaid",
    );
    const cash =
        active.find(
            (account) =>
                account.presetKey === "starter:asset" &&
                !account.paymentDisabled,
        ) ??
        active.find(
            (account) =>
                account.type === "asset" &&
                !account.paymentDisabled &&
                !["fixed_asset", "subscription"].includes(
                    account.subtype ?? "",
                ),
        );
    const liability = active.find((account) => account.type === "liability");
    const fixed = active.find(
        (account) =>
            account.type === "asset" &&
            ["fixed_asset", "subscription"].includes(account.subtype ?? ""),
    );
    const expense =
        active.find(
            (account) =>
                account.type === "expense" &&
                (account.name === "折旧费用" ||
                    account.subtype === "depreciation"),
        ) ??
        active.find((account) => account.presetKey === "starter:expense") ??
        active.find((account) => account.type === "expense");
    const debit =
        template === "liability_payment"
            ? liability
            : template === "asset_purchase"
              ? fixed
              : template === "depreciation"
                ? expense
                : template === "liability_borrowing"
                  ? cash
                  : undefined;
    const credit =
        template === "liability_borrowing"
            ? liability
            : template === "depreciation"
              ? fixed
              : template === "custom"
                ? undefined
                : cash;
    const destination =
        credit && debit?.currency !== credit.currency ? undefined : debit;
    return [
        {
            id: makeId(),
            accountId: destination?.id ?? "",
            side: "debit",
            amount,
        },
        { id: makeId(), accountId: credit?.id ?? "", side: "credit", amount },
    ];
}
