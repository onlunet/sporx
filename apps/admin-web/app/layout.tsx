import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { AdminSidebar } from "../src/components/admin-sidebar";

export const metadata: Metadata = {
  title: "SPORX Admin | Yönetim Paneli",
  description: "Profesyonel spor analitik yönetim paneli"
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const headerList = await headers();
  const isAuthenticated = headerList.get("x-admin-authenticated") === "1";
  const isLoginPage = headerList.get("x-admin-login-page") === "1";
  const showSidebar = isAuthenticated && !isLoginPage;

  return (
    <html lang="tr">
      <body className="min-h-screen bg-admin-bg-primary">
        {showSidebar ? (
          <div className="flex min-h-screen">
            <AdminSidebar />
            <main className="flex-1 ml-72 p-8">
              <div className="max-w-7xl mx-auto">
                {children}
              </div>
            </main>
          </div>
        ) : (
          <main className="min-h-screen flex items-center justify-center p-4">
            {children}
          </main>
        )}
      </body>
    </html>
  );
}
