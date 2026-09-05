import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "قسم الموارد البشرية – مسائي",
  description: "نظام فن النسيج لإدارة عمليات الموارد البشرية – الشفت المسائي",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl">
      <body className="antialiased">{children}</body>
    </html>
  );
}
