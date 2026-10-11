/** Cent 金额单位：1 元 = 10000。领域入口必须校验为安全整数。 */
import type { TransactionMedia } from "./transaction-media";
export type Amount = number;

export type AccountType =
    | "asset"
    | "liability"
    | "income"
    | "expense"
    | "equity";

export interface Account {
    id: string;
    name: string;
    type: AccountType;
    subtype?: string;
    /** 预置账户的显示/模板标识；业务关联始终使用独立的 id。 */
    presetKey?: string;
    /** 账户自己的图标：内置 icon class 或自定义 SVG。 */
    icon?: string;
    parentId?: string;
    currency: string;
    /** 外币或自定义币种的成本计量单位，余额属于 currency，平均成本从历史分录推导。 */
    costCurrency?: string;
    /** 隐藏交易表单中的支付来源；普通账户未设置时可支付，订阅账户强制为 true。 */
    paymentDisabled?: boolean;
    archived: boolean;
    createdAt: number;
    updatedAt: number;
}

export type TransactionType =
    | "currency_exchange"
    | "topup"
    | "journal"
    | "expense"
    | "income"
    | "transfer"
    | "asset_purchase"
    | "depreciation"
    | "liability_borrowing"
    | "opening_balance"
    | "adjustment"
    | "liability_payment"
    | "split";

export interface Entry {
    accountId: string;
    /** 借方为正、贷方为负；无 currency 时是记账金额，有 currency 时仅为本币估算。 */
    amount: Amount;
    /** 外币消费：amount 仅是 base 本币估算，实际记账金额为 currency.amount（target）。 */
    currency?: { base: string; target: string; amount: Amount };
}

export interface Transaction extends TransactionMedia {
    id: string;
    /** 业务语义，不决定分录是否平衡，也不决定账户余额。 */
    type: TransactionType;
    time: number;
    /** 可选的排他结束时间；有值时 time 为区间开始时间，列表默认按开始时间展示。 */
    endTime?: number;
    /** 根据账户派生，不持久化：普通消费为原币，换汇为付款币种。 */
    currency: string;
    /** 从分录和 currency_trading 权益账户派生，仅供领域计算和编辑，不持久化。 */
    exchange?: import("./currency-exchange").CurrencyExchange;
    description?: string;
    /**
     * 来源父交易；保存时完整嵌入父交易的 children，读取视图展开后计算一次。
     */
    parentTransactionId?: string;
    /** 完整直接子交易；由统一保存入口同步，数据库仅保存根交易。 */
    children?: Transaction[];
    creatorId?: number | string;
    entries: Entry[];
    tagIds?: string[];
    createdAt: number;
    updatedAt: number;
}
