import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "../src/lib/providers";
import { PublicSidebar } from "../src/components/public-sidebar";

export const metadata: Metadata = {
  title: "SPORX | AI Spor Analitigi",
  description: "Yapay zeka destekli spor tahmin ve analitik platformu",
  icons: {
    icon: "/icon.svg",
    shortcut: "/icon.svg"
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const forceHttpForSslipScript = `
    (function () {
      try {
        var host = window.location.hostname || "";
        if (window.location.protocol === "https:" && host.endsWith(".sslip.io")) {
          var nextUrl =
            "http://" +
            window.location.host +
            window.location.pathname +
            window.location.search +
            window.location.hash;
          window.location.replace(nextUrl);
        }
      } catch (error) {
        // no-op
      }
    })();
  `;

  return (
    <html lang="tr">
      <head>
        <script dangerouslySetInnerHTML={{ __html: forceHttpForSslipScript }} />
      </head>
      <body className="min-h-screen bg-void text-slate-200 antialiased">
        <Providers>
          <div className="relative flex min-h-screen">
            {/* Ambient Glow Effects */}
            <div className="fixed left-0 top-0 h-96 w-96 rounded-full bg-neon-cyan/5 blur-[120px] pointer-events-none" />
            <div className="fixed right-0 bottom-0 h-96 w-96 rounded-full bg-neon-purple/5 blur-[120px] pointer-events-none" />

            <PublicSidebar />

            <main className="flex-1 p-6 lg:p-8 relative z-10">
              <div className="mx-auto max-w-7xl">
                {children}
              </div>
            </main>
          </div>
        </Providers>
      </body>
    </html>
  );
}
