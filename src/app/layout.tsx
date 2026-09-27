import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CHECKPOINT — NFC 워킹 레이스",
  description: "걸어서 지점마다 NFC 태깅하고, 팀 순위로 시상하는 레이스 운영 앱",
};

export const viewport: Viewport = {
  themeColor: "#12160f",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className="h-full">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.min.css"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Black+Han+Sans&family=Noto+Sans+KR:wght@400;500;700;900&display=swap"
        />
      </head>
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
