import { assertAmount } from "./amount";
import type { Account, Entry } from "./types";

/** 外币消费的原币金额是唯一记账依据；外层估算不参与余额或平衡。 */
export function getEntryAmount(entry: Entry): number {
    return entry.currency?.amount ?? entry.amount;
}

export function getEntryCurrency(entry: Entry, account: Account): string {
    return entry.currency?.target ?? account.currency;
}

/** 指定币种的预览；没有换算依据时返回缺失。 */
export function getEntryDisplayAmount(
    entry: Entry,
    account: Account,
    currency: string,
): number | undefined {
    if (entry.currency?.base === currency) return entry.amount;
    if (getEntryCurrency(entry, account) === currency)
        return getEntryAmount(entry);
    return undefined;
}

export function validateEntryCurrency(entry: Entry): void {
    if (!entry.currency) return;
    const { base, target, amount } = entry.currency;
    if (!base.trim() || !target.trim() || base === target)
        throw new Error("Invalid entry currency pair");
    assertAmount(amount);
    if (
        amount === 0 ||
        (entry.amount !== 0 && Math.sign(entry.amount) !== Math.sign(amount))
    )
        throw new Error(
            "Entry estimate and native amount must have the same sign",
        );
}
