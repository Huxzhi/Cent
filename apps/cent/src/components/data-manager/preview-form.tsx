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
        revision: current.book.revision,
    });
}

export async function importFromPreviewResult(result: PreviewState) {
    if (!result.assetAccountId && !result.assetAccountIds)
        throw new Error("请先选择资产账户。");
    const state = accountingStore.getState();
    if (!result.bookId || state.current?.book.id !== result.bookId)
        throw new Error("账本已切换，请重新预览导入。");
    await state.updateData((data) => {
        const current = accountingStore.getState().current;
        if (
            !current ||
            current.book.id !== result.bookId ||
            current.book.revision !== result.revision
        )
            throw new Error("账本已变化，请重新预览导入。");
        return importBillsToAccounting(
            data,
            result.bills,
            result.meta,
            result.assetAccountIds ?? result.assetAccountId!,
            Date.now(),
        ).data;
    }, Date.now());
}
