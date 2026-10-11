import type { ReactNode } from "react";

/** 原账单与复式交易共用的条目详情弹窗布局。 */
export default function BillInfoLayout({
    header,
    children,
    footer,
}: {
    header: ReactNode;
    children: ReactNode;
    footer: ReactNode;
}) {
    return (
        <div className="min-h-[min(320px,85dvh)] max-h-[85dvh] p-4 flex flex-col w-full">
            <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
                {header}
                <div className="w-full border border-dashed my-2" />
                {children}
            </div>
            <div className="footer flex justify-between items-center shrink-0 pt-4 gap-2">
                {footer}
            </div>
        </div>
    );
}
