import { useEffect, useMemo, useState } from "react";
import type { AccountingData } from "../ledger/accounting";
import { getAccountingHistoryThrough } from "../ledger/accounting/accounting-history";

/** 时间变化只更新读取视图，不触发账本保存。页面恢复可见时同步跨日/月结果。 */
export function useAccountingView(data: AccountingData | undefined) {
    const [now, setNow] = useState(Date.now);
    useEffect(() => {
        const refresh = () => setNow(Date.now());
        const timer = window.setInterval(refresh, 60_000);
        document.addEventListener("visibilitychange", refresh);
        return () => {
            window.clearInterval(timer);
            document.removeEventListener("visibilitychange", refresh);
        };
    }, []);
    return useMemo(
        () => ({
            now,
            transactions: data ? getAccountingHistoryThrough(data, now) : [],
        }),
        [data, now],
    );
}
