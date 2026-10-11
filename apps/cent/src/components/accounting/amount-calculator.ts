import {
    amountToDecimal,
    assertAmount,
    decimalToAmount,
} from "../../ledger/accounting/amount";

const formula =
    /^(-?(?:\d+(?:\.\d{0,4})?|\.\d{1,4}))([+−×÷])(-?(?:\d+(?:\.\d{0,4})?|\.\d{1,4}))$/;
const decimal = (text: string) =>
    decimalToAmount(text.endsWith(".") ? text.slice(0, -1) : text);

/** 与账本一致的四位小数整数计算，乘除按绝对值四舍五入。 */
export function calculateAmount(text: string): string {
    const match = formula.exec(text);
    if (!match) return amountToDecimal(decimal(text));
    const left = BigInt(decimal(match[1]));
    const right = BigInt(decimal(match[3]));
    let numerator: bigint;
    let denominator = 1n;
    switch (match[2]) {
        case "+":
            numerator = left + right;
            break;
        case "−":
            numerator = left - right;
            break;
        case "×":
            numerator = left * right;
            denominator = 10000n;
            break;
        default:
            if (right === 0n) throw new Error("除数不能为零。");
            numerator = left * 10000n;
            denominator = right;
    }
    const negative = numerator < 0n !== denominator < 0n;
    const absolute = numerator < 0n ? -numerator : numerator;
    const divisor = denominator < 0n ? -denominator : denominator;
    const rounded = (absolute + divisor / 2n) / divisor;
    const result = Number(negative ? -rounded : rounded);
    assertAmount(result);
    return amountToDecimal(result);
}

export function appendAmountKey(text: string, key: string): string {
    if (key === "backspace") return text.slice(0, -1);
    if (key === "clear") return "";
    if (key === "=") return calculateAmount(text || "0");
    if (["+", "−", "×", "÷"].includes(key)) {
        const withoutTrailingOperator = text.replace(/[+−×÷]$/, "");
        return `${calculateAmount(withoutTrailingOperator || "0")}${key}`;
    }
    if (!/^[\d.]$/.test(key)) return text;
    const operand = text.split(/[+−×÷]/).at(-1) ?? "";
    if (key === "." && operand.includes(".")) return text;
    if (operand.split(".")[1]?.length === 4) return text;
    return `${text}${key === "." && !operand ? "0." : key}`;
}
