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
  },
});
