import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { PublicSidebar } from "../src/components/public-sidebar";
import { Providers } from "../src/lib/providers";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "SPORX - AI Spor Analiz Platformu",
  description: "Futbol ve basketbol için AI destekli tahminler, canlı skorlar ve derinlemesine analizler."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="tr">
      <body className={`${inter.className} bg-void text-slate-200`}>
        <Providers>
          <div className="flex min-h-screen">
            <PublicSidebar />
            <main className="flex-1 pt-20 lg:pt-0">
              <div className="p-4 sm:p-6 lg:p-8">{children}</div>
            </main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
