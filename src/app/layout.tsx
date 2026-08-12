import type { Metadata } from "next";
import { AppFrame } from "@/components/AppFrame";
import { ShiftProvider } from "@/context/ShiftContext";
import "./globals.css";

export const metadata: Metadata = {
  title: "シフト調整アプリ",
  description: "アルバイトの希望シフトと確定シフトを管理するアプリ",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>
        <ShiftProvider>
          <AppFrame>{children}</AppFrame>
        </ShiftProvider>
      </body>
    </html>
  );
}
