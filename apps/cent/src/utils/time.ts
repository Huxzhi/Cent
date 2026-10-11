import dayjs, { type Dayjs, type OpUnitType } from "dayjs";
import duration from "dayjs/plugin/duration";
import isBetween from "dayjs/plugin/isBetween";
import isSameOrBefore from "dayjs/plugin/isSameOrBefore";
import timezone from "dayjs/plugin/timezone";
import utc from "dayjs/plugin/utc";

dayjs.extend(isBetween);
dayjs.extend(isSameOrBefore);
dayjs.extend(duration);
dayjs.extend(utc);
dayjs.extend(timezone);

type TimeContext = {
    getTimeZone?: () => string | undefined;
    getLocale?: () => string | undefined;
    translate?: (key: string) => string;
};
let timeContext: TimeContext = {};

/** 应用启动时提供界面上下文，通用时间工具不依赖 store 或语言模块。 */
export function configureTime(context: TimeContext) {
    timeContext = context;
}

export function isValidTimeZone(value: string): boolean {
    try {
        new Intl.DateTimeFormat("en", { timeZone: value }).format(0);
        return value.length > 0;
    } catch {
        return false;
    }
}

export function getDefaultTimeZone(): string {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** 时间戳始终表示 UTC 时刻；仅在日期计算和显示时应用指定时区。 */
export function zonedDate(time: number, timeZone = getDefaultTimeZone()) {
    return dayjs.utc(time).tz(timeZone);
}

/** 当地日期输入转换成 UTC；不存在的夏令时时刻拒绝，重复时刻取较早者。 */
export function parseZonedDateTime(
    value: string,
    timeZone = getDefaultTimeZone(),
): number {
    if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/.test(value))
        throw new RangeError("Invalid local date/time");
    const format =
        value.length === 10
            ? "YYYY-MM-DD"
            : value.length === 16
              ? "YYYY-MM-DDTHH:mm"
              : "YYYY-MM-DDTHH:mm:ss";
    const wall = dayjs.utc(value);
    if (!wall.isValid() || wall.format(format) !== value)
        throw new RangeError("Invalid local date/time");
    const candidates = new Set<number>();
    for (const hours of [-36, -12, 0, 12, 36]) {
        const offset = zonedDate(
            wall.valueOf() + hours * 3600000,
            timeZone,
        ).utcOffset();
        const candidate = wall.valueOf() - offset * 60000;
        if (zonedDate(candidate, timeZone).format(format) === value)
            candidates.add(candidate);
    }
    if (!candidates.size)
        throw new RangeError(
            "Local time does not exist in the selected time zone",
        );
    return Math.min(...candidates);
}

export function zonedDayIndex(time: number, timeZone = getDefaultTimeZone()) {
    return (
        dayjs.utc(zonedDate(time, timeZone).format("YYYY-MM-DD")).valueOf() /
        86400000
    );
}

/** 按日历加天，再解析新的午夜；不假定每一天都是 24 小时。 */
export function addZonedDays(
    time: number,
    days: number,
    timeZone = getDefaultTimeZone(),
) {
    const date = dayjs
        .utc(zonedDate(time, timeZone).format("YYYY-MM-DD"))
        .add(days, "day")
        .format("YYYY-MM-DD");
    return parseZonedDateTime(date, timeZone);
}

export const getBookTimeZone = () =>
    timeContext.getTimeZone?.() ?? getDefaultTimeZone();
export const bookDayjs = (time = Date.now()) =>
    zonedDate(time, getBookTimeZone());
export const parseBookDateTime = (value: string) =>
    parseZonedDateTime(value, getBookTimeZone());

export const formatTime = (t: number) =>
    bookDayjs(t).format("YYYY-MM-DD HH:mm");

/**
 * 格式化日期为 YYYY-MM-DD
 * @param timestamp 时间戳
 * @param gap 最小时间单位
 * @returns 格式化后的日期字符串
 */
export function formatDate(timestamp: number, gap: OpUnitType = "day"): string {
    const date = bookDayjs(timestamp).startOf(gap);
    return date.format("YYYY-MM-DD");
}

export const denseDate = (value: Dayjs, joiner = "-") => {
    const time = bookDayjs(value.valueOf());
    const now = bookDayjs();
    if (time.isSame(now, "days")) {
        return timeContext.translate?.("Today") ?? "Today";
    }
    const dayDiff = Math.abs(time.diff(now, "day"));
    if (dayDiff <= 3 && time.isSame(now, "M")) {
        if (timeContext.getLocale?.() === "zh") return `${time.format("DD")}日`;
        return time.format(`MM${joiner}DD`);
    }
    if (time.isSame(now, "year")) {
        return time.format(`MM${joiner}DD`);
    }
    return time.format(`YYYY${joiner}MM${joiner}DD`);
};

export const denseTime = (_time: Dayjs | number) => {
    const now = bookDayjs();
    const time = bookDayjs(typeof _time === "number" ? _time : _time.valueOf());
    if (time.isSame(now, "days")) {
        return time.format("HH:mm");
    }
    const dayDiff = Math.abs(time.diff(now, "day"));
    if (dayDiff <= 3 && time.isSame(now, "M")) {
        if (timeContext.getLocale?.() === "zh")
            return `${time.format("DD")}日 ${time.format("HH:mm")}`;
        return time.format("MM/DD HH:mm");
    }
    if (time.isSame(now, "year")) {
        return time.format("MM/DD HH:mm");
    }
    return time.format("YY/MM/DD HH:mm");
};

export const shortTime = (t: number) => bookDayjs(t).format("YY/MM/DD HH:mm");

export const toDayjs = (v: number | dayjs.Dayjs | Date) => {
    if (typeof v === "number") {
        return bookDayjs(v);
    }
    return bookDayjs(v.valueOf());
};
