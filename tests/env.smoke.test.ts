import { describe, expect, it } from "vitest";

// Gate 0: .env 可读取（DATABASE_URL 必须存在且非空）
describe("Gate 0: .env readable", () => {
  it("exposes DATABASE_URL", () => {
    expect(process.env.DATABASE_URL).toBeTruthy();
  });

  it("parses a valid postgres URL", () => {
    const url = process.env.DATABASE_URL!;
    expect(url.startsWith("postgresql://")).toBe(true);
  });
});
