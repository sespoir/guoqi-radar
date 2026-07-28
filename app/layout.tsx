import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host?.includes("localhost") ? "http" : "https");
  const baseUrl = host ? `${protocol}://${host}` : null;
  return {
    title: "国企雷达｜计算机类招聘信息每日更新",
    description: "聚合国企计算机、软件、算法、数据、网络安全与通信类招聘信息，每日自动更新。",
    icons: {
      icon: "/favicon.png",
      shortcut: "/favicon.png",
    },
    openGraph: {
      title: "国企雷达｜不错过每一个技术岗位",
      description: "AI 筛选国企计算机类招聘信息，每日自动更新。",
      type: "website",
      locale: "zh_CN",
      images: baseUrl ? [{ url: `${baseUrl}/og.png`, width: 1200, height: 630 }] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title: "国企雷达｜计算机类招聘信息每日更新",
      description: "AI 筛选国企技术岗位，每天替你查一遍。",
      images: baseUrl ? [`${baseUrl}/og.png`] : undefined,
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
