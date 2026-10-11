import {
    amountToNumber as centAmountToNumber,
    numberToAmount as centNumberToAmount,
} from "../bill";
import type { Amount } from "./types";

/** 可用于边界校验；允许零余额，正式分录的非零约束由交易校验负责。 */
export function assertAmount(amount: number): void {
    if (!Number.isSafeInteger(amount)) {
        throw new RangeError(
            "Amount must be a safe integer (1 unit = 1/10000)",
        );
    }
}

/** 复用 Cent 的四位小数舍入，同时拒绝非有限数和转换后的溢出。 */
export function numberToAmount(value: number): Amount {
    if (!Number.isFinite(value)) {
        throw new RangeError("Money must be finite");
    }
    const amount = centNumberToAmount(value);
    assertAmount(amount);
    return amount === 0 ? 0 : amount;
}

/** 只在输入/显示边界转换成以元为单位的 number。 */
export function amountToNumber(amount: Amount): number {
    assertAmount(amount);
    return centAmountToNumber(amount);
}

/** 表单文本边界精确转换，避免大金额经浮点乘除后丢失最末一位。 */
export function decimalToAmount(text: string): Amount {
    const value = text.trim();
    if (!/^-?(?:\d+|\d*\.\d{1,4})$/.test(value)) {
        throw new Error("请输入金额，最多四位小数。");
    }
    const negative = value.startsWith("-");
    const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(
        ".",
    );
    const units =
        BigInt(whole || "0") * 10000n + BigInt(fraction.padEnd(4, "0"));
    const result = Number(negative ? -units : units);
    assertAmount(result);
    return result === 0 ? 0 : result;
}

/** 精确的十进制编辑值，无千位分隔符。 */
export function amountToDecimal(amount: Amount): string {
    assertAmount(amount);
    const absolute = BigInt(amount < 0 ? -amount : amount);
    const fraction = (absolute % 10000n)
        .toString()
        .padStart(4, "0")
        .replace(/0+$/, "");
    return `${amount < 0 ? "-" : ""}${absolute / 10000n}${fraction ? `.${fraction}` : ""}`;
}

/**
 * 精确整数聚合。BigInt 只用于中间计算，不进入模型或 JSON。
 * 即使中间和超过安全范围，抵消后的结果也不受遍历顺序影响。
 */
export function sumAmounts(amounts: readonly Amount[]): Amount {
    let total = 0n;
    for (const amount of amounts) {
        assertAmount(amount);
        total += BigInt(amount);
    }
    const result = Number(total);
    assertAmount(result);
    return result;
}
