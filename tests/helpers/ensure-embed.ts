import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * 测试用：确保本地 embedding 服务已就绪（幂等，共享进程，不 kill）。
 * 调用 scripts/ensure-embed.sh —— 已健康直接返回；否则拉起并等待就绪。
 */
export async function ensureEmbedServer(timeoutMs = 180_000): Promise<void> {
  const { stdout, stderr } = await execFileAsync(
    "bash",
    ["./scripts/ensure-embed.sh"],
    { cwd: process.cwd(), timeout: timeoutMs },
  );
  const out = `${stdout}\n${stderr}`.trim();
  if (out) console.log(`[ensure-embed] ${out}`);
}
