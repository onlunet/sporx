import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AdminSidebar } from "../src/components/admin-sidebar";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "SPORX Admin",
  description: "SPORX Yonetim Paneli"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="tr">
      <body className={`${inter.className} bg-admin-bg-primary text-admin-text-primary`}>
        <div className="min-h-screen md:ml-72">
          <AdminSidebar />
          <main className="pt-20 md:pt-6">
            <div className="p-4 sm:p-6 lg:p-8">{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}
