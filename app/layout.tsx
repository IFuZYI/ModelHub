import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";

const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ModelHub · 模型导航",
  description: "浏览各 API 提供商可用的模型清单",
};

// Enable proper mobile scaling for the responsive layout.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="zh"
      data-theme="dark"
      className={`${inter.variable} ${jetbrains.variable}`}
    >
      <body>
        <div className="page-aurora" />
        <div className="page-glow" />
        <div className="page-grain" />
        {children}
      </body>
    </html>
  );
}
