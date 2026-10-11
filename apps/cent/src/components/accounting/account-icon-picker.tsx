import { useState } from "react";
import { useIntl } from "@/locale";
import { cn } from "@/utils";
import { Button } from "../ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import { ICONS } from "./account-icons";

/** 账户的内置图标 / SVG 选择器。 */
export default function AccountIconPicker({
    value,
    onChange,
    className,
}: {
    value?: string;
    onChange: (icon: string | undefined) => void;
    className?: string;
}) {
    const t = useIntl();
    const [svg, setSvg] = useState(() =>
        value?.trim().startsWith("<svg") ? value : "",
    );
    return (
        <Tabs
            defaultValue={value?.trim().startsWith("<svg") ? "custom" : "icons"}
            className={cn(
                "w-full flex flex-col flex-1 overflow-hidden p-2 gap-2",
                className,
            )}
        >
            <div className="flex justify-center">
                <TabsList>
                    <TabsTrigger value="icons">{t("icons-tab")}</TabsTrigger>
                    <TabsTrigger value="custom">{t("custom-tab")}</TabsTrigger>
                </TabsList>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto border rounded-lg p-2">
                <TabsContent value="icons" className="flex flex-col gap-2">
                    {ICONS.map((set) => (
                        <div key={set.labelKey} className="flex flex-col gap-2">
                            <div className="text-sm">{t(set.labelKey)}</div>
                            <div className="grid grid-cols-[repeat(auto-fill,minmax(48px,1fr))] gap-2">
                                {set.icons.map((icon) => (
                                    <button
                                        key={icon.name}
                                        type="button"
                                        aria-label={icon.name}
                                        aria-pressed={value === icon.className}
                                        onClick={() => onChange(icon.className)}
                                        className={cn(
                                            "size-12 p-2 rounded-full border flex justify-center items-center cursor-pointer",
                                            value === icon.className &&
                                                "border-primary bg-accent",
                                        )}
                                    >
                                        <i
                                            aria-hidden
                                            className={icon.className}
                                        />
                                    </button>
                                ))}
                            </div>
                        </div>
                    ))}
                </TabsContent>
                <TabsContent value="custom" className="flex flex-col gap-2 m-0">
                    <div className="text-sm opacity-80 flex justify-between items-center px-2 gap-2">
                        <div className="flex flex-col gap-1">
                            <div>{t("copy-and-paste-svg-below")}:</div>
                            <div className="text-xs opacity-60">
                                {t("icon-svg-tip")}
                            </div>
                        </div>
                        <Button
                            type="button"
                            size="sm"
                            onClick={() => {
                                setSvg("");
                                onChange(undefined);
                            }}
                        >
                            {t("clear")}
                        </Button>
                    </div>
                    <textarea
                        aria-label={t("copy-and-paste-svg-below")}
                        className="w-full min-h-36 border rounded-lg p-2"
                        placeholder={
                            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">...</svg>'
                        }
                        value={svg}
                        onChange={(event) => {
                            const text = event.currentTarget.value;
                            setSvg(text);
                            const trimmed = text.trim();
                            if (
                                trimmed.startsWith("<svg") &&
                                trimmed.endsWith("</svg>")
                            )
                                onChange(trimmed);
                        }}
                    />
                </TabsContent>
            </div>
        </Tabs>
    );
}
