import { useStore } from "zustand";
import { accountingStore } from "../../store/accounting";
import {
    AccountingSyncConflictError,
    accountingBooks,
} from "../../sync/accounting";
import { Button } from "../ui/button";
import { FormError, useFormAction } from "./shared";
/** No conflicted amount reaches the normal ledger or statistics views. */
export default function AccountingSyncConflicts() {
    const conflict = useStore(accountingStore, (s) => s.conflict);
    const { error, submitting, run } = useFormAction();
    if (!conflict) return null;
    const refresh = async () => {
        try {
            await accountingStore.getState().selectBook(conflict.bookId);
        } catch (error) {
            if (!(error instanceof AccountingSyncConflictError)) throw error;
        }
    };
    return (
        <div className="h-full overflow-auto p-6 space-y-4 max-w-3xl mx-auto">
            <h1 className="text-lg font-medium">账本存在并发修改</h1>
            <p>
                请选择每项要保留的完整版本。当前候选会保留到冲突解决；解决前暂停显示账单和统计。
            </p>
            {conflict.records.map((record) => {
                const choices = record._sync.versions.map((version) => ({
                    label: `设备 ${version.writerId} · 批次 ${version.writerSeq}`,
                    value: version.value,
                }));
                return (
                    <fieldset
                        key={`${record.collection}/${record.id}`}
                        className="border rounded p-3 space-y-3"
                    >
                        <legend>
                            {record.collection} / {record.id}
                        </legend>
                        {choices.map((choice) => (
                            <div key={choice.label} className="space-y-2">
                                <p className="text-sm break-all">
                                    {choice.label}
                                </p>
                                <pre className="text-xs overflow-auto max-h-64 bg-muted p-2 rounded">
                                    {choice.value === null
                                        ? "删除记录"
                                        : JSON.stringify(choice.value, null, 2)}
                                </pre>
                                <Button
                                    disabled={submitting}
                                    onClick={() =>
                                        void run(async () => {
                                            await accountingBooks.resolveConflict(
                                                conflict.bookId,
                                                record,
                                                choice.value === null
                                                    ? { type: "delete" }
                                                    : {
                                                          type: "put",
                                                          value: choice.value,
                                                      },
                                                conflict.revision,
                                            );
                                            await refresh();
                                        })
                                    }
                                >
                                    {choice.value === null
                                        ? "确认删除"
                                        : "保留此版本"}
                                </Button>
                            </div>
                        ))}
                    </fieldset>
                );
            })}
            <Button
                variant="outline"
                disabled={submitting}
                onClick={() => void run(refresh)}
            >
                重新读取冲突
            </Button>
            <FormError error={error} />
        </div>
    );
}
