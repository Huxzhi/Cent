import { sameStateVersion, stateVersion } from "@glink25/sync-sdk";
import { importBillsToAccounting } from "../../ledger/accounting/import-bills";
import { accountingStore } from "../../store/accounting";
import createConfirmProvider from "../confirm";
import { prepareBillImages } from "./import-images";
import { PreviewForm, type PreviewState } from "./preview";

const [ImportPreviewProvider, openPreview] = createConfirmProvider<
    PreviewState,
    PreviewState
>(PreviewForm, {
    dialogTitle: "accounting-bill-import-preview",
    dialogModalClose: true,
    contentClassName:
        "h-full w-full max-h-full max-w-full rounded-none sm:rounded-md sm:max-h-[min(640px,calc(100vh-32px))] sm:w-[90vw] sm:max-w-[560px]",
});
export { ImportPreviewProvider };
export async function showImportPreview(input: PreviewState) {
    const current = accountingStore.getState().current;
    if (!current) throw new Error("请先选择账本。");
    const bills = await prepareBillImages(input.bills);
    return openPreview({
        ...input,
        bills,
        bookId: current.book.id,
        version: stateVersion(current.book.version),
    });
}

export async function importFromPreviewResult(result: PreviewState) {
    if (!result.paymentAccountId && !result.paymentAccountIds)
        throw new Error("请先选择收付款账户（资产或负债）。");
    const state = accountingStore.getState();
    if (!result.bookId || state.current?.book.id !== result.bookId)
        throw new Error("账本已切换，请重新预览导入。");
    await state.updateData((data) => {
        const current = accountingStore.getState().current;
        if (
            !current ||
            current.book.id !== result.bookId ||
            !result.version ||
            !sameStateVersion(current.book.version, result.version)
        )
            throw new Error("账本已变化，请重新预览导入。");
        return importBillsToAccounting(
            data,
            result.bills,
            result.meta,
            result.paymentAccountIds ?? result.paymentAccountId!,
            Date.now(),
        ).data;
    }, Date.now());
}
