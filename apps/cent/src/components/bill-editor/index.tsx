import {
    getTransactionEditTarget,
    type Transaction,
} from "@/ledger/accounting";
import type { Bill } from "@/ledger/type";
import { measure } from "@/measurement";
import { accountingStore } from "@/store/accounting";
import type { EditBill } from "@/store/ledger";
import createConfirmProvider from "../confirm";
import EditorForm from "./form";

const confirms = createConfirmProvider<Transaction, void>(EditorForm, {
    dialogTitle: "accounting-nav-add",
    contentClassName:
        "h-full w-full max-h-full max-w-full rounded-none sm:rounded-md sm:max-h-[85vh] sm:w-[90vw] sm:max-w-[600px]",
});

const [BillEditorProvider, showTransactionEditor] = confirms;

export { BillEditorProvider };

/** 未迁移的旧模块不能再通过旧 Bill 接口写入账本。 */
export const showBillEditor = (_value?: EditBill): Promise<Bill> =>
    Promise.reject(
        new Error("旧账单编辑已停用，请先通过导入将旧数据转换为交易。"),
    );

export const goAddBill = async (value?: Transaction) => {
    const transactions =
        accountingStore.getState().current?.data.transactions ?? [];
    await showTransactionEditor(
        value ? getTransactionEditTarget(value, transactions) : undefined,
    );
    measure("bill_created", { source: "manual", item_count: 1 });
};
