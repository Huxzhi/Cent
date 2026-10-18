// 智能导入脚本：支付宝官方 XLSX / XLS / CSV / TSV 账单。
// paymentMethod 用于预览时按收/付款方式选择收付款账户；金额单位为 1/10000 元。
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
                line.includes("交易订单号") &&
                line.includes("收/支"),
        );
        if (start < 0)
            throw new Error(
                "未找到支付宝账单表头（交易时间、收/支、交易订单号）。",
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
                        row.map(clean).includes("交易订单号"),
                )
            ) {
                rows = candidate;
                break;
            }
        }
    }
    if (!rows) throw new Error("未找到支付宝账单明细工作表。");
    const headerIndex = rows.findIndex((row) => {
        const names = row.map(clean);
        return (
            names.includes("交易时间") &&
            names.includes("交易订单号") &&
            names.includes("收/支")
        );
    });
    if (headerIndex < 0) throw new Error("未找到支付宝账单表头。");
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
            "交易分类",
            "交易对方",
            "商品说明",
            "收/支",
            "金额",
            "收/付款方式",
            "交易状态",
            "交易订单号",
            "商家订单号",
            "备注",
        ].map((name) => [
            name,
            column(
                name,
                ["交易时间", "收/支", "金额", "交易订单号"].includes(name),
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
                /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/,
            );
            if (match) parts = match.slice(1).map((part) => Number(part ?? 0));
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
        // 支付宝账单按北京时间（UTC+08:00）解析，避免依赖浏览器所在时区。
        return utc - 8 * 60 * 60 * 1000;
    };
    const categoryMap = {
        餐饮美食: "food",
        日用百货: "shopping",
        服饰装扮: "clothing",
        交通出行: "transport",
        家居家装: "housing",
        数码电器: "electronics",
        文化休闲: "entertainment",
        休闲娱乐: "entertainment",
        医疗健康: "medical",
        教育培训: "education",
        运动户外: "fitness",
        美容美发: "wellness",
        充值缴费: "housing",
        爱心公益: "charity",
        人情往来: "relationship",
    };
    const expenseCategory = (category, merchant, product) => {
        // 学校食堂经常被平台归为教育培训，优先使用明确的商品说明。
        if (
            /食堂|咖啡|coffee|手抓饭|小吃|肉包|餐厅|餐饮|可口可乐|饮料/i.test(
                product,
            )
        )
            return "food";
        if (/餐饮美食/.test(category)) return "food";
        if (/咖啡|coffee|手抓饭|小吃|肉包|餐厅/i.test(merchant)) return "food";
        return categoryMap[category] ?? "other-expenses";
    };
    const items = [];
    for (let index = headerIndex + 1; index < rows.length; index++) {
        const row = rows[index];
        const get = (name) => clean(row[columns[name]]);
        const direction = get("收/支"),
            status = get("交易状态");
        if (!["收入", "支出"].includes(direction)) continue; // 中性交易需要两个已知账户，不自动推断。
        if (
            /支付失败|交易关闭|已关闭|已取消|未支付|待支付|待收款|已退还|已撤销/.test(
                status,
            )
        )
            continue;
        try {
            const rawId = row[columns["交易订单号"]];
            if (typeof rawId === "number" && !Number.isSafeInteger(rawId))
                throw new Error(
                    "交易订单号已丢失精度，请使用官方原始文件，勿将单号列转成数字。",
                );
            const transactionId = get("交易订单号").replace(/^'+/, "");
            if (!/^\d+$/.test(transactionId))
                throw new Error("缺少有效交易订单号。");
            const amount = amountOf(row[columns["金额"]]);
            if (amount === 0) continue;
            const transactionType = get("交易分类"),
                merchant = get("交易对方");
            // 收入方向的退款冲减费用。已退款的原支出仍保留，与退款行互相抵消。
            const refund =
                direction === "收入" && /退款/.test(transactionType + status);
            const type = direction === "支出" || refund ? "expense" : "income";
            let paymentMethod = get("收/付款方式");
            if (!meaningful(paymentMethod)) paymentMethod = "未注明支付方式";
            // 组合付款保留原文，预览中手动指定账户；本文件未提供可用于拆分的金额。
            items.push({
                id: `${transactionId}-alipay`,
                type,
                amount: refund ? -amount : amount,
                time: timeOf(row[columns["交易时间"]]),
                categoryId:
                    type === "expense"
                        ? expenseCategory(
                              transactionType,
                              merchant,
                              get("商品说明"),
                          )
                        : "other-income",
                creatorId: "from-alipay",
                paymentMethod,
                comment: [
                    "支付宝",
                    ...[
                        "交易分类",
                        "交易对方",
                        "商品说明",
                        "收/付款方式",
                        "交易状态",
                        "商家订单号",
                        "备注",
                    ]
                        .filter((name) => meaningful(get(name)))
                        .map((name) => `${name}：${get(name)}`),
                ].join("；"),
            });
        } catch (error) {
            throw new Error(`支付宝账单第 ${index + 1} 行：${error.message}`);
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
