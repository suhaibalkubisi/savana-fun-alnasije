import type { Metadata } from "next";
import "./globals.css";
import "./workspace-theme.css";

export const metadata: Metadata = {
  title: "قسم الموارد البشرية – مسائي | FANU ALNASIJ",
  description: "نظام فن النسيج لإدارة عمليات الموارد البشرية – الشفت المسائي",
  icons: {
    icon: [
      { url: "/favicon.ico?v=2" },
      { url: "/favicon-16x16.png?v=2", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png?v=2", sizes: "32x32", type: "image/png" },
    ],
    shortcut: "/favicon.ico?v=2",
    apple: "/apple-touch-icon.png?v=2",
  },
  manifest: "/site.webmanifest",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl">
      <body className="antialiased hr-product">{children}</body>
    </html>
  );
}
