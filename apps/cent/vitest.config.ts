import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// 领域测试使用 Node；不加载应用的 React/PWA 插件或浏览器全局状态。
export default defineConfig({
    resolve: {
        alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    test: {
        environment: "node",
        include: ["tests/**/*.test.ts"],
    },
});
