import { PrismaClient } from "@prisma/client";

// Prisma 单例：避免开发模式下热重载重复实例化
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
