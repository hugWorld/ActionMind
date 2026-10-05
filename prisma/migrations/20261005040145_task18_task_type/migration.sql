-- AlterTable
ALTER TABLE "meetings" ADD COLUMN     "notes" TEXT,
ADD COLUMN     "task_type" TEXT NOT NULL DEFAULT 'MEETING';
