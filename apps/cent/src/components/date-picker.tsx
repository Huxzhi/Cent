import type { Dayjs } from "dayjs";
import { ChevronDownIcon } from "lucide-react";
import type React from "react";
import { type ReactNode, useState } from "react";
import { useIntl } from "@/locale";
import { bookDayjs, denseDate, parseBookDateTime } from "@/utils/time";
import { Calendar } from "./ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

type Props = {
    value?: number;
    formatter?: (time: number) => string;
    displayFormatter?: string | ((time?: Dayjs) => string);
    onChange?: (value: number) => void;
    children?: React.ReactNode;
    onBlur?: () => void;
    type?: "datetime-local" | "date";
    /** 切换日期时不将时间重置为00:00 */
    fixedTime?: boolean;
};

const Hours = Array.from({ length: 24 }, (_, i) => ({
    label: `${i}`.padStart(2, "0"),
    value: `${i}`.padStart(2, "0"),
}));
const Minutes = Array.from({ length: 60 }, (_, i) => ({
    label: `${i}`.padStart(2, "0"),
    value: `${i}`.padStart(2, "0"),
}));

function NativeSelect({
    children,
    value,
    options,
    label,
    onValueChange,
}: {
    label: string;
    options: { label: string; value: string }[];
    value: string;
    children?: ReactNode;
    onValueChange?: (v: string) => void;
}) {
    return (
        <span className="has-focus:border-ring border-input shadow-xs has-focus:ring-ring/50 has-focus:ring-[3px] relative rounded-md border rdp-dropdown_root">
            <select
                className="bg-popover absolute inset-0 opacity-0 rdp-dropdown rdp-hours_dropdown"
                aria-label={label}
                value={value}
                onChange={(e) => {
                    onValueChange?.(e.currentTarget.value);
                }}
            >
                {options.map((h) => (
                    <option key={h.value} value={h.value}>
                        {h.label}
                    </option>
                ))}
            </select>
            <span
                className="select-none h-(--cell-size) font-medium [&>svg]:text-muted-foreground flex items-center gap-1 rounded-md pl-2 pr-1 text-sm [&>svg]:size-3.5 rdp-caption_label"
                aria-hidden
            >
                {children ?? value}
                <ChevronDownIcon />
            </span>
        </span>
    );
}

export function DatePicker({
    value,
    displayFormatter = (v) => (v ? denseDate(v) : ""),
    onChange,
    children,
    onBlur,
    fixedTime,
    type = "datetime-local",
}: Props) {
    const t = useIntl();

    const [open, setOpen] = useState(false);
    const [dateError, setDateError] = useState(false);
    const emitDate = (value: string) => {
        try {
            onChange?.(parseBookDateTime(value));
            setDateError(false);
        } catch {
            setDateError(true);
        }
    };

    // display 格式化函数
    const display =
        typeof displayFormatter === "function"
            ? displayFormatter
            : (d?: Dayjs) => d?.format(displayFormatter as string);

    const current = bookDayjs(value ?? Date.now());
    return (
        <Popover
            open={open}
            onOpenChange={(v) => {
                setOpen(v);
                if (!v) {
                    onBlur?.();
                }
            }}
        >
            <PopoverTrigger>
                <div className="flex justify-center items-center relative cursor-pointer">
                    {children}
                    <div className="mx-2">
                        {display(value === undefined ? undefined : current)}
                    </div>
                </div>
            </PopoverTrigger>
            <PopoverContent
                className="w-auto overflow-hidden p-3 flex flex-col gap-2"
                align="center"
                side="bottom"
                sideOffset={-36}
            >
                <Calendar
                    mode="single"
                    captionLayout="dropdown"
                    className="rounded-md p-0"
                    selected={
                        new Date(
                            current.year(),
                            current.month(),
                            current.date(),
                        )
                    }
                    defaultMonth={
                        new Date(
                            current.year(),
                            current.month(),
                            current.date(),
                        )
                    }
                    today={
                        new Date(
                            bookDayjs().year(),
                            bookDayjs().month(),
                            bookDayjs().date(),
                        )
                    }
                    onSelect={(v) => {
                        if (v) {
                            const x = new Date(v);
                            const date = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
                            emitDate(
                                fixedTime
                                    ? `${date}T${current.format("HH:mm")}`
                                    : date,
                            );
                        }
                    }}
                />
                <div className="flex justify-between items-center [--cell-size:--spacing(8)] px-2">
                    <span className="text-sm">{t("time")}</span>
                    <div className="flex gap-2 items-center">
                        <NativeSelect
                            value={current.format("HH")}
                            label={t("accounting-choose-hour")}
                            options={Hours}
                            onValueChange={(v) => {
                                const newValue = current.hour(Number(v));
                                emitDate(newValue.format("YYYY-MM-DDTHH:mm"));
                            }}
                        />
                        <span>:</span>
                        <NativeSelect
                            value={current.format("mm")}
                            label={t("accounting-choose-minute")}
                            options={Minutes}
                            onValueChange={(v) => {
                                const newValue = current.minute(Number(v));
                                emitDate(newValue.format("YYYY-MM-DDTHH:mm"));
                            }}
                        />
                    </div>
                </div>
                {dateError && (
                    <p role="alert" className="text-xs text-destructive">
                        {t("accounting-time-zone-invalid-time")}
                    </p>
                )}
            </PopoverContent>
        </Popover>
    );
}
