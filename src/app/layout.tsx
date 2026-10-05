import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ActionMind",
  description: "Personal Task & Schedule Agent",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      {/* suppressHydrationWarning：浏览器扩展（如 Grammarly）会向 body 注入属性，导致客户端
          DOM 与 SSR 不一致而触发 hydration mismatch 告警，表现为 dev 页面持续显示 issue 指示。
          单机自用 MVP 下忽略该差异（数据本身不依赖 SSR 快照）。 */}
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <header className="flex items-center justify-between border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
          <a href="/" className="text-sm font-semibold text-black dark:text-zinc-50">
            ActionMind
          </a>
          <nav className="flex gap-4 text-sm">
            <a href="/" className="text-zinc-500 hover:text-black dark:text-zinc-400 dark:hover:text-zinc-100">
              首页
            </a>
            <a href="/schedule" className="text-zinc-500 hover:text-black dark:text-zinc-400 dark:hover:text-zinc-100">
              日程
            </a>
            <a href="/actions" className="text-zinc-500 hover:text-black dark:text-zinc-400 dark:hover:text-zinc-100">
              Action Cards
            </a>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
