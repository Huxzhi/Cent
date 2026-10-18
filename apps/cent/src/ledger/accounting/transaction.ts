import { isEqual } from "lodash-es";
import type { Transaction } from "./types";

type TransactionNode<T> = {
    id: string;
    parentTransactionId?: string;
    children?: T[];
};

/** 存储树展开为计算视图；拒绝重复、环、错误父引用，防止一笔分录重复累计。 */
export function flattenTransactionTree<T extends TransactionNode<T>>(
    roots: readonly T[],
): T[] {
    const result: T[] = [],
        ids = new Set<string>();
    const visit = (node: T, parent?: string, depth = 0) => {
        if (depth > 64)
            throw new Error("Transaction hierarchy exceeds 64 levels");
        if (ids.has(node.id))
            throw new Error(`Duplicate transaction ID: ${node.id}`);
        if (
            (parent === undefined && node.parentTransactionId !== undefined) ||
            (node.parentTransactionId !== undefined &&
                node.parentTransactionId !== parent)
        )
            throw new Error(
                `Transaction parent does not match its container: ${node.id}`,
            );
        ids.add(node.id);
        const { children, ...own } = node;
        result.push({ ...own, parentTransactionId: parent } as T);
        for (const child of children ?? []) visit(child, node.id, depth + 1);
    };
    for (const root of roots) visit(root);
    return result;
}

/** 扁平编辑视图为更新来源；新增、更新、移动、清除子交易均重新构建所有父级。 */
export function synchronizeTransactionChildren(
    transactions: readonly Transaction[],
    now?: number,
): Transaction[] {
    const byId = new Map<string, Transaction>(),
        groups = new Map<string, Transaction[]>();
    for (const transaction of transactions) {
        if (byId.has(transaction.id))
            throw new Error(`Duplicate transaction ID: ${transaction.id}`);
        byId.set(transaction.id, transaction);
        if (transaction.parentTransactionId) {
            const group = groups.get(transaction.parentTransactionId) ?? [];
            group.push(transaction);
            groups.set(transaction.parentTransactionId, group);
        }
    }
    for (const item of transactions)
        if (item.parentTransactionId && !byId.has(item.parentTransactionId))
            throw new Error(
                `Parent transaction not found: ${item.parentTransactionId}`,
            );
    const built = new Map<string, Transaction>(),
        visiting = new Set<string>();
    const build = (transaction: Transaction, depth = 0): Transaction => {
        if (visiting.has(transaction.id))
            throw new Error(`Transaction parent cycle: ${transaction.id}`);
        if (depth > 64)
            throw new Error("Transaction hierarchy exceeds 64 levels");
        const existing = built.get(transaction.id);
        if (existing) return existing;
        visiting.add(transaction.id);
        const children = [...(groups.get(transaction.id) ?? [])]
            .sort((a, b) => a.time - b.time || a.id.localeCompare(b.id))
            .map((child) => build(child, depth + 1));
        const { children: _oldChildren, ...own } = transaction;
        const changed = !isEqual(transaction.children ?? [], children);
        const result = {
            ...own,
            ...(children.length ? { children } : {}),
            updatedAt: changed
                ? Math.max(
                      transaction.updatedAt,
                      now ?? transaction.updatedAt,
                      ...children.map((child) => child.updatedAt),
                  )
                : transaction.updatedAt,
        };
        visiting.delete(transaction.id);
        built.set(transaction.id, result);
        return result;
    };
    // 从根节点检查深度，不让输入顺序或已缓存子节点绕过层级限制。
    for (const transaction of transactions)
        if (transaction.parentTransactionId === undefined) build(transaction);
    return transactions.map((transaction) => build(transaction));
}

export function getRootTransactions(
    transactions: readonly Transaction[],
): Transaction[] {
    return synchronizeTransactionChildren(transactions).filter(
        (item) => item.parentTransactionId === undefined,
    );
}

/** 子交易只能通过其来源父交易编辑；多层关系回到根交易。 */
export function getTransactionEditTarget(
    transaction: Transaction,
    transactions: readonly Transaction[],
): Transaction {
    let current = transaction;
    const visited = new Set<string>();
    while (current.parentTransactionId) {
        if (visited.has(current.id))
            throw new Error(`Transaction parent cycle: ${current.id}`);
        visited.add(current.id);
        const parent = transactions.find(
            (item) => item.id === current.parentTransactionId,
        );
        if (!parent)
            throw new Error(
                `Parent transaction not found: ${current.parentTransactionId}`,
            );
        current = parent;
    }
    return current;
}

/**
 * 从已校验集合查询直接子交易，不将孙交易重复归入父层。
 * 返回新数组，按发生时间、ID 排序，使结果不依赖同步输入顺序。
 * 此查询仅表达关联；子交易金额仍由各自的 entries 决定。
 */
export function getChildTransactions(
    parentTransactionId: string,
    transactions: readonly Transaction[],
): Transaction[] {
    return transactions
        .filter(
            (transaction) =>
                transaction.parentTransactionId === parentTransactionId,
        )
        .sort((left, right) => {
            const timeDifference = left.time - right.time;
            if (timeDifference !== 0) return timeDifference;
            return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
        });
}
