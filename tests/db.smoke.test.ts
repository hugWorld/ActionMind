import { describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";

// Gate 0: Prisma 连接 + pgvector 可用
describe("Gate 0: Prisma + pgvector", () => {
  it("connects to PostgreSQL and the vector extension is available", async () => {
    const prisma = new PrismaClient();
    try {
      const rows = await prisma.$queryRaw<
        { extname: string; extversion: string }[]
      >`
        SELECT extname, extversion
        FROM pg_extension
        WHERE extname = 'vector'
      `;
      expect(rows.length).toBe(1);
      expect(rows[0].extname).toBe("vector");
      expect(rows[0].extversion).toBeTruthy();
    } finally {
      await prisma.$disconnect();
    }
  });
});
