import Papa from "papaparse";
import * as XLSX from "xlsx";
import type { BillCategory } from "../../ledger/type";

// Bundled with the app: statement parsing never requests a third-party CDN.
self.onmessage = async (
    event: MessageEvent<{
        code: string;
        file: File;
        DefaultCategories: BillCategory[];
    }>,
) => {
    try {
        const { code, file, DefaultCategories } = event.data;
        const transform = new Function(
            `${code}\nreturn typeof transform === 'function' ? transform : undefined;`,
        )();
        if (typeof transform !== "function")
            throw new Error("脚本中未定义 transform(file, ctx) 函数。");
        const result = await transform(file, { Papa, XLSX, DefaultCategories });
        self.postMessage(result);
    } catch (error) {
        self.postMessage({
            error: true,
            message: error instanceof Error ? error.message : String(error),
        });
    }
};
