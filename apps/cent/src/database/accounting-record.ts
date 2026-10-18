import type { AccountingData, Transaction } from "../ledger/accounting";
import { deriveCurrencyExchange } from "../ledger/accounting/currency-exchange";
import { flattenTransactionTree } from "../ledger/accounting/transaction";

/** 每笔交易保存分录和元数据；外币消费在 entries.currency 保存实际金额，entries.amount 仅为估算。 */
export interface AccountingItem {
    id: string;
    type: Transaction["type"];
    comment?: string;
    creatorId?: Transaction["creatorId"];
    time: number;
    endTime?: number;
    entries: Transaction["entries"];
    tagIds?: string[];
    location?: Transaction["location"];
    images?: string[];
    extra?: { imageMetadata: { id: string; name: string }[] };
    parentTransactionId?: string;
    children?: AccountingItem[];
    __create_at: number;
    __update_at: number;
}
export interface AccountingMeta {
    timeZone?: AccountingData["timeZone"];
    accounts: AccountingData["accounts"];
    currencySettings?: AccountingData["currencySettings"];
    tags?: NonNullable<AccountingData["tagMetadata"]>["tags"];
    personal?: Record<
        string,
        {
            tagGroups: NonNullable<
                AccountingData["tagMetadata"]
            >["groupsByUser"][string];
        }
    >;
    map?: AccountingData["mapConfig"];
    statisticsViews?: AccountingData["statisticsViews"];
}
export function toAccountingItem(transaction: Transaction): AccountingItem {
    const {
        description,
        createdAt,
        updatedAt,
        currency: _currency,
        exchange: _exchange,
        images,
        children,
        ...rest
    } = transaction;
    return {
        ...rest,
        ...(children?.length
            ? { children: children.map(toAccountingItem) }
            : {}),
        ...(description === undefined ? {} : { comment: description }),
        ...(images === undefined
            ? {}
            : {
                  images: images.map((image) => image.dataUrl),
                  extra: {
                      imageMetadata: images.map(({ id, name }) => ({
                          id,
                          name,
                      })),
                  },
              }),
        __create_at: createdAt,
        __update_at: updatedAt,
    };
}
export function fromAccountingItem(
    item: AccountingItem,
    accounts: AccountingData["accounts"],
): Transaction {
    const {
        type,
        comment,
        __create_at,
        __update_at,
        images,
        extra,
        children,
        ...rest
    } = item;
    if ("currency" in rest) throw new Error("交易币种必须由账户确定。");
    if ("exchange" in rest) throw new Error("换汇角色必须由分录确定。");
    if ("kind" in rest || "purpose" in rest)
        throw new Error("交易类型只使用 type 字段。");
    const exchange = deriveCurrencyExchange(
        { type, entries: item.entries },
        accounts,
    );
    const nativeCurrency = accounts.find(
        (account) =>
            account.id ===
            ((item.type === "expense"
                ? exchange?.toAccountId
                : exchange?.fromAccountId) ?? item.entries[0]?.accountId),
    )?.currency;
    if (!nativeCurrency) throw new Error("交易账户币种缺失。");
    return {
        ...rest,
        ...(children?.length
            ? {
                  children: children.map((child) =>
                      fromAccountingItem(child, accounts),
                  ),
              }
            : {}),
        type,
        ...(comment === undefined ? {} : { description: comment }),
        currency: nativeCurrency,
        ...(exchange ? { exchange } : {}),
        ...(images === undefined
            ? {}
            : {
                  images: images.map((dataUrl, index) => {
                      const metadata = extra?.imageMetadata[index];
                      if (!metadata) throw new Error("交易图片信息缺失。");
                      return { ...metadata, dataUrl };
                  }),
              }),
        createdAt: __create_at,
        updatedAt: __update_at,
    };
}
export function toAccountingMeta(data: AccountingData): AccountingMeta {
    return {
        ...(data.timeZone === undefined ? {} : { timeZone: data.timeZone }),
        ...(data.statisticsViews === undefined
            ? {}
            : { statisticsViews: data.statisticsViews }),
        accounts: data.accounts,
        ...(data.currencySettings === undefined
            ? {}
            : { currencySettings: data.currencySettings }),
        ...(data.tagMetadata === undefined
            ? {}
            : {
                  tags: data.tagMetadata.tags,
                  personal: Object.fromEntries(
                      Object.entries(data.tagMetadata.groupsByUser).map(
                          ([id, tagGroups]) => [id, { tagGroups }],
                      ),
                  ),
              }),
        ...(data.mapConfig === undefined ? {} : { map: data.mapConfig }),
    };
}
export function fromAccountingRecords(
    meta: AccountingMeta,
    items: AccountingItem[],
): AccountingData {
    const data = fromFlatAccountingRecords(meta, items);
    return {
        ...data,
        transactions: flattenTransactionTree(data.transactions),
    };
}
/** Independent records retain parent references; the domain validator derives children for views. */
export function fromFlatAccountingRecords(
    meta: AccountingMeta,
    items: AccountingItem[],
): AccountingData {
    if ("depreciationRules" in meta)
        throw new Error("Unsupported account-bound depreciation metadata");
    return {
        ...(meta.timeZone === undefined ? {} : { timeZone: meta.timeZone }),
        ...(meta.statisticsViews === undefined
            ? {}
            : { statisticsViews: meta.statisticsViews }),
        accounts: meta.accounts,
        ...(meta.currencySettings === undefined
            ? {}
            : { currencySettings: meta.currencySettings }),
        transactions: items.map((item) =>
            fromAccountingItem(item, meta.accounts),
        ),
        ...(meta.tags === undefined
            ? {}
            : {
                  tagMetadata: {
                      tags: meta.tags,
                      groupsByUser: Object.fromEntries(
                          Object.entries(meta.personal ?? {}).map(
                              ([id, value]) => [id, value.tagGroups],
                          ),
                      ),
                  },
              }),
        ...(meta.map === undefined ? {} : { mapConfig: meta.map }),
    };
}
