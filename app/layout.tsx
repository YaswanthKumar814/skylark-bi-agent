import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Skylark BI Agent",
  description: "Conversational business intelligence over monday.com Deals and Work Orders boards.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
