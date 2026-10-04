-- Task 6: embedding 列维度 vector(1536) -> vector(512)（bge-small-zh-v1.5）
-- 注：Prisma 不 diff Unsupported() 内容，此迁移为手写。
ALTER TABLE "memories" ALTER COLUMN "embedding" TYPE vector(512);
