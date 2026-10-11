import { defineConfig } from "vitest/config";

// 领域测试使用 Node；不加载应用的 React/PWA 插件或浏览器全局状态。
export default defineConfig({
    test: {
        environment: "node",
        include: ["tests/**/*.test.ts"],
    },
});
