import { defineConfig } from "vitest/config";
import { config } from "dotenv";

// 让 Vitest 能读取项目根目录 .env
config({ path: ".env" });

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Task 17 (Stage B)：文件级串行执行。
    // 多个测试文件共享同一个 PostgreSQL 时，并行会互相污染种子数据
    // （如同名联系人导致 resolveContact ambiguous、同内容记忆导致检索断言错位）。
    fileParallelism: false,
  },
});
