// 智能导入脚本：微信官方 XLSX / XLS / CSV / TSV 账单。
// paymentMethod 用于预览时按支付方式选择资产账户；金额单位为 1/10000 元。
async function transform(file, ctx) {
    const clean = (value) =>
        String(value ?? "")
            .replace(/^\uFEFF/, "")
            .trim();
    const meaningful = (value) => !["", "/", "-", "--"].includes(clean(value));
    const buffer = await file.arrayBuffer();
    let rows;
    if (/\.(csv|tsv|txt)$/i.test(file.name)) {
        let text;
        try {
            text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
        } catch {
            text = new TextDecoder("gb18030", { fatal: true }).decode(buffer);
        }
        const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
        const start = lines.findIndex(
            (line) =>
                line.includes("交易时间") &&
                line.includes("交易单号") &&
                line.includes("收/支"),
        );
        if (start < 0)
            throw new Error(
                "未找到微信账单表头（交易时间、收/支、交易单号）。",
            );
        const delimiter = lines[start].includes("\t") ? "\t" : ",";
        const parsed = ctx.Papa.parse(lines.slice(start).join("\n"), {
            delimiter,
            dynamicTyping: false,
            skipEmptyLines: "greedy",
        });
        if (parsed.errors.length)
            throw new Error(`CSV 格式错误：${parsed.errors[0].message}`);
        rows = parsed.data;
    } else {
        const workbook = ctx.XLSX.read(buffer, {
            type: "array",
            cellDates: false,
        });
        // 某些工作簿第一张是说明页，遍历寻找真正的明细表。
        for (const name of workbook.SheetNames) {
            const candidate = ctx.XLSX.utils.sheet_to_json(
                workbook.Sheets[name],
                {
                    header: 1,
                    raw: true,
                    defval: "",
                    blankrows: false,
                },
            );
            if (
                candidate.some(
                    (row) =>
                        row.map(clean).includes("交易时间") &&
                        row.map(clean).includes("交易单号"),
                )
            ) {
                rows = candidate;
                break;
            }
        }
    }
    if (!rows) throw new Error("未找到微信账单明细工作表。");
    const headerIndex = rows.findIndex((row) => {
        const names = row.map(clean);
        return (
            names.includes("交易时间") &&
            names.includes("交易单号") &&
            names.includes("收/支")
        );
    });
    if (headerIndex < 0) throw new Error("未找到微信账单表头。");
    const header = rows[headerIndex].map((value) =>
        clean(value).replace(/（/g, "(").replace(/）/g, ")"),
    );
    const column = (name, required = false) => {
        const index = header.indexOf(name);
        if (required && index < 0) throw new Error(`缺少列：${name}`);
        return index;
    };
    const columns = Object.fromEntries(
        [
            "交易时间",
            "交易类型",
            "交易对方",
            "商品",
            "收/支",
            "金额(元)",
            "支付方式",
            "当前状态",
            "交易单号",
            "商户单号",
            "备注",
        ].map((name) => [
            name,
            column(
                name,
                ["交易时间", "收/支", "金额(元)", "交易单号"].includes(name),
            ),
        ]),
    );
    const amountOf = (value) => {
        const text = clean(value).replace(/^[¥￥]\s*/, "");
        if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,4})?$/.test(text))
            throw new Error(`无效金额：${text}`);
        const [whole, fraction = ""] = text.replace(/,/g, "").split(".");
        const amount = BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, "0"));
        if (amount > BigInt(Number.MAX_SAFE_INTEGER))
            throw new Error("金额超出安全范围。");
        return Number(amount);
    };
    const timeOf = (value) => {
        let parts;
        if (typeof value === "number") {
            const date = ctx.XLSX.SSF.parse_date_code(value);
            if (date)
                parts = [
                    date.y,
                    date.m,
                    date.d,
                    date.H,
                    date.M,
                    Math.floor(date.S),
                ];
        } else {
            const match = clean(value).match(
                /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})$/,
            );
            if (match) parts = match.slice(1).map(Number);
        }
        if (!parts) throw new Error(`无效交易时间：${clean(value)}`);
        const [year, month, day, hour, minute, second] = parts;
        const utc = Date.UTC(year, month - 1, day, hour, minute, second);
        const date = new Date(utc);
        if (
            date.getUTCFullYear() !== year ||
            date.getUTCMonth() !== month - 1 ||
            date.getUTCDate() !== day ||
            hour > 23 ||
            minute > 59 ||
            second > 59
        )
            throw new Error("交易时间超出有效范围。");
        // 微信账单明确使用 UTC+08:00，避免依赖浏览器所在时区。
        return utc - 8 * 60 * 60 * 1000;
    };
    const expenseCategory = (merchant) => {
        if (/吉野家|咖啡|cafe|居酒屋|餐厅|食堂|饭店/i.test(merchant))
            return "food";
        if (/拼多多|淘宝|京东|天猫/.test(merchant)) return "shopping";
        return "other-expenses";
    };
    const items = [];
    for (let index = headerIndex + 1; index < rows.length; index++) {
        const row = rows[index];
        const get = (name) => clean(row[columns[name]]);
        const direction = get("收/支"),
            status = get("当前状态");
        if (!["收入", "支出"].includes(direction)) continue; // 中性交易需要两个已知账户，不自动推断。
        if (
            /支付失败|交易关闭|已关闭|已取消|未支付|待支付|待收款|已退还|已撤销/.test(
                status,
            )
        )
            continue;
        try {
            const rawId = row[columns["交易单号"]];
            if (typeof rawId === "number" && !Number.isSafeInteger(rawId))
                throw new Error(
                    "交易单号已丢失精度，请使用官方原始文件，勿将单号列转成数字。",
                );
            const transactionId = get("交易单号").replace(/^'+/, "");
            if (!/^\d+$/.test(transactionId))
                throw new Error("缺少有效交易单号。");
            const amount = amountOf(row[columns["金额(元)"]]);
            if (amount === 0) continue;
            const transactionType = get("交易类型"),
                merchant = get("交易对方");
            // 收入方向的退款冲减费用。已退款的原支出仍保留，与退款行互相抵消。
            const refund =
                direction === "收入" && /退款/.test(transactionType + status);
            const type = direction === "支出" || refund ? "expense" : "income";
            let paymentMethod = get("支付方式");
            if (!meaningful(paymentMethod))
                paymentMethod = /已存入零钱/.test(status)
                    ? "零钱"
                    : "未注明支付方式";
            items.push({
                id: `${transactionId}-wechat`,
                type,
                amount: refund ? -amount : amount,
                time: timeOf(row[columns["交易时间"]]),
                categoryId:
                    type === "expense"
                        ? expenseCategory(merchant)
                        : "other-income",
                creatorId: "from-wechat",
                paymentMethod,
                comment: [
                    "微信",
                    ...[
                        "交易类型",
                        "交易对方",
                        "商品",
                        "支付方式",
                        "当前状态",
                        "商户单号",
                        "备注",
                    ]
                        .filter((name) => meaningful(get(name)))
                        .map((name) => `${name}：${get(name)}`),
                ].join("；"),
            });
        } catch (error) {
            throw new Error(`微信账单第 ${index + 1} 行：${error.message}`);
        }
    }
    if (!items.length) throw new Error("账单中没有可导入的已完成收支记录。");
    return {
        items,
        meta: {
            categories: ctx.DefaultCategories,
            tags: [],
            baseCurrency: "CNY",
        },
    };
}
