import { type ReactNode, useMemo, useState } from "react";
import { useCopyToClipboard, useLocalStorage } from "react-use";
import { toast } from "sonner";
import PopupLayout from "@/layouts/popup-layout";
import { BillCategories } from "@/ledger/category";
import type { ExportedJSON } from "@/ledger/type";
import { t, useIntl } from "@/locale";
import { measure } from "@/measurement";
import { readClipboard } from "@/utils/clipboard";
import { isCancelError } from "../confirm/state";
import modal from "../modal";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "../ui/select";
import { promptText } from "./llm-prompt";
import { importFromPreviewResult, showImportPreview } from "./preview-form";
import AlipayCode from "./schemas/alipay.js?raw";
import WechatCode from "./schemas/wechat.js?raw";

type ImportTransformer = {
    id: string;
    label?: ReactNode;
    transformerCode: string;
};

const getDefaultTransformers = () => [
    {
        label: t("alipay-import-transformer"),
        id: "alipay",
        transformerCode: AlipayCode,
    },
    {
        label: t("wechat-import-transformer"),
        id: "wechat",
        transformerCode: WechatCode,
    },
];

const CUSTOM_TRANSFORMERS_KEY = "custom-import-transformers";

export function SmartImport({ onCancel }: { onCancel?: () => void }) {
    const t = useIntl();

    const [selected, setSelected] = useState(
        () => getDefaultTransformers()[0].id,
    );
    const DefaultTransformers = useMemo(() => getDefaultTransformers(), []);
    const [customTransformers, setCustomTransformers] = useLocalStorage(
        CUSTOM_TRANSFORMERS_KEY,
        [] as ImportTransformer[],
    );
    const AllTransformers = useMemo(
        () => [...DefaultTransformers, ...customTransformers!],
        [customTransformers, DefaultTransformers],
    );

    const selectedTransformer = AllTransformers.find((v) => v.id === selected);
    const isDefaultTransformer = Boolean(
        DefaultTransformers.find((v) => v.id === selected),
    );
    const updateTransformerCode = (code: string) => {
        setCustomTransformers(() => {
            const prev = customTransformers;
            const newValue = code;
            const item = prev?.find((v) => v.id === selected);
            if (!item) {
                return prev;
            }
            item.transformerCode = newValue;
            return [...(prev ?? [])];
        });
    };

    const toEditName = async () => {
        const name = (await modal.prompt({
            title: t("please-enter-a-new-schema-name"),
            input: { type: "text" },
        })) as string;
        if (!name) {
            return;
        }
        setCustomTransformers(() => {
            const prev = customTransformers;
            const newValue = name;
            const item = prev?.find((v) => v.id === selected);
            if (!item) {
                return prev;
            }
            item.id = newValue;
            Promise.resolve().then(() => {
                setSelected(item.id);
            });
            return [...(prev ?? [])];
        });
    };

    const [file, setFile] = useState<File>();
    const [errorInfo, setErrorInfo] = useState<string>();
    const [, copy] = useCopyToClipboard();
    const [loading, setLoading] = useState(false);

    const toImport = async () => {
        if (!selectedTransformer?.transformerCode || !file) {
            return;
        }
        setLoading(true);
        const data = await (async () => {
            try {
                const result = await runCode(
                    selectedTransformer.transformerCode,
                    file,
                );
                return checkJSON(result);
            } catch (error) {
                console.error(error);
                const errorInfo =
                    (error as Error).message ?? JSON.stringify(error);
                setErrorInfo(errorInfo);
                toast.error(errorInfo);
                return undefined;
            } finally {
                setLoading(false);
            }
        })();
        if (!data) {
            return;
        }
        try {
            const res = await showImportPreview({
                bills: data.items,
                meta: data.meta,
            });
            if (!res) {
                return;
            }
            await importFromPreviewResult(res);
            if (res.bills.length > 0) {
                measure("bill_created", {
                    source: "import",
                    item_count: res.bills.length,
                });
            }
            onCancel?.();
        } catch (error) {
            if (!isCancelError(error)) {
                const message =
                    error instanceof Error ? error.message : String(error);
                setErrorInfo(message);
                toast.error(message);
            }
        }
    };
    return (
        <PopupLayout
            title={t("smart-import")}
            onBack={onCancel}
            className="h-full overflow-hidden"
            right={
                <Button
                    disabled={loading}
                    onClick={() => {
                        setCustomTransformers(() => {
                            const prev = customTransformers;
                            const id = `${t("custom-import-transformer-name")}${(prev?.length ?? 0) + 1}`;
                            Promise.resolve().then(() => {
                                setSelected(id);
                            });
                            return [
                                ...(prev ?? []),
                                {
                                    id,
                                    transformerCode: "",
                                },
                            ];
                        });
                    }}
                >
                    {t("add-new-scheme")}
                </Button>
            }
        >
            <div className="flex gap-3 flex-col flex-1 p-4 overflow-y-auto px-4">
                <div className="flex gap-2 items-center">
                    <span className="flex-shrink-0">{t("select-scheme")}:</span>
                    <Select value={selected} onValueChange={setSelected}>
                        <SelectTrigger>
                            <SelectValue className="w-[180px]"></SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                            {AllTransformers.map(({ id, label }) => (
                                <SelectItem key={id} value={id}>
                                    {label ?? id}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    {!isDefaultTransformer && (
                        <Button variant="secondary" onClick={toEditName}>
                            {t("rename-scheme")}
                        </Button>
                    )}
                </div>
                <div className="flex gap-2 items-center">
                    <span className="flex-shrink-0">{t("bill-file")}:</span>
                    <Input
                        type="file"
                        onChange={(e) => {
                            const file = e.currentTarget.files?.item(0);
                            if (file) {
                                setFile(file);
                            }
                        }}
                    />
                </div>
                {!isDefaultTransformer && (
                    <div className="flex flex-col gap-2">
                        <div className="text-xs opacity-60">
                            {t("step1-prompt-copy")}
                        </div>
                        <div className="flex gap-2">
                            <div className="flex-1 rounded-md border p-1 h-9 text-xs break-all opacity-40 overflow-y-auto">
                                {promptText}
                            </div>
                            <Button
                                variant="secondary"
                                onClick={async () => {
                                    await copy(promptText);
                                    toast.success(t("copy-success"));
                                }}
                            >
                                {t("copy-prompt")}
                            </Button>
                        </div>
                        <div className="text-xs opacity-60">
                            {t("step2-code-paste")}
                        </div>
                        <div className="flex gap-2">
                            <textarea
                                placeholder={t("placeholder-paste-code")}
                                className="w-full border rounded-md p-1 h-20 resize-none text-sm"
                                value={selectedTransformer?.transformerCode}
                                onChange={(e) => {
                                    const newValue = e.currentTarget.value;
                                    updateTransformerCode(newValue);
                                }}
                            ></textarea>
                            <div className="flex flex-col gap-2">
                                <Button
                                    variant="secondary"
                                    onClick={async () => {
                                        const { text } = await readClipboard();
                                        if (text !== null) {
                                            updateTransformerCode(text);
                                        }
                                    }}
                                >
                                    {t("paste")}
                                </Button>
                                <Button
                                    variant="destructive"
                                    onClick={() => updateTransformerCode("")}
                                >
                                    {t("clear")}
                                </Button>
                            </div>
                        </div>
                        <div className="text-xs opacity-60">
                            {t("step3-import-finish")}
                        </div>
                        {errorInfo && (
                            <div className="flex gap-2">
                                <div className="flex-1 rounded-md border p-1 h-9 text-xs text-red-500 select-auto overflow-x-auto">
                                    {errorInfo}
                                </div>
                                <Button
                                    variant="secondary"
                                    onClick={async () => {
                                        await copy(errorInfo);
                                        toast.success(t("copy-success"));
                                    }}
                                >
                                    {t("copy-error-info")}
                                </Button>
                            </div>
                        )}
                    </div>
                )}
            </div>
            <div className="flex-shrink-0 px-4 pb-4 flex justify-end">
                <Button onClick={toImport} disabled={loading || !file}>
                    {loading && (
                        <i className="icon-[mdi--loading] animate-spin"></i>
                    )}
                    {t("import")}
                </Button>
            </div>
        </PopupLayout>
    );
}

const runCode = (code: string, file: File) => {
    const worker = new Worker(
        new URL("./transform.worker.ts", import.meta.url),
        { type: "module" },
    );
    return new Promise<unknown>((resolve, reject) => {
        worker.onmessage = (event) => {
            worker.terminate();
            if (event.data?.error) reject(new Error(event.data.message));
            else resolve(event.data);
        };
        worker.onerror = (event) => {
            event.preventDefault();
            worker.terminate();
            reject(new Error(event.message || "导入解析器加载失败。"));
        };
        worker.postMessage({
            code: code.trim(),
            file,
            DefaultCategories: BillCategories,
        });
    });
};

const checkJSON = (v: unknown) => {
    if (!v || typeof v !== "object") {
        throw new Error("result is not an object");
    }
    if (!Array.isArray((v as any)["items"])) {
        throw new Error("the value of key 'items' in result is not an array");
    }
    if ((v as ExportedJSON).items.length === 0) {
        throw new Error("the array value of key 'items's length is 0");
    }
    return v as ExportedJSON;
};
