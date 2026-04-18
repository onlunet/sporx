import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import { AdminSidebar } from "../src/components/admin-sidebar";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "SPORX Admin",
  description: "SPORX Yonetim Paneli"
};

export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const headerStore = await headers();
  const isLoginPage = headerStore.get("x-admin-login-page") === "1";

  return (
    <html lang="tr">
      <body className={`${inter.className} bg-admin-bg-primary text-admin-text-primary`}>
        <div className={`min-h-screen ${isLoginPage ? "" : "md:ml-72"}`}>
          {!isLoginPage ? <AdminSidebar /> : null}
          <main className={isLoginPage ? "grid min-h-screen place-items-center p-4 sm:p-6 lg:p-8" : "pt-20 md:pt-6"}>
            <div className={isLoginPage ? "w-full max-w-md" : "p-4 sm:p-6 lg:p-8"}>{children}</div>
          </main>
        </div>
      </body>
    </html>
  );
}
