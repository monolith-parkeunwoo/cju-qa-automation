import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "CJU QA Console",
  description: "개발 환경 ALL 예약 검증",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
