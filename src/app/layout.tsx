import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ActionMind",
  description: "Context-Aware Personal Action Agent",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
