import type { NextConfig } from "next";

const strictSecurityHeaders = process.env.STRICT_SECURITY_HEADERS_ENABLED !== "false";
const contentSecurityPolicy =
  process.env.PUBLIC_WEB_CSP ??
  "default-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; img-src 'self' data: https:; font-src 'self' data: https://fonts.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; script-src 'self' 'unsafe-inline'; connect-src 'self' https: wss:;";

function buildSecurityHeaders() {
  if (!strictSecurityHeaders) {
    return [];
  }

  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Permissions-Policy", value: "accelerometer=(), camera=(), geolocation=(), microphone=(), payment=(), usb=()" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Cross-Origin-Resource-Policy", value: "same-site" },
    { key: "Content-Security-Policy", value: contentSecurityPolicy }
  ];
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@sporx/ui", "@sporx/api-contract"],
  async rewrites() {
    return [
      { source: "/panel", destination: "/dashboard" },
      { source: "/futbol", destination: "/football" },
      { source: "/futbol/maclar", destination: "/football/matches" },
      { source: "/futbol/maclar/:id", destination: "/matches/:id" },
      { source: "/futbol/tahminler", destination: "/football/predictions" },
      { source: "/futbol/sonuclar", destination: "/football/predictions/completed" },
      { source: "/futbol/lig-performansi", destination: "/football/predictions/leagues" },
      { source: "/futbol/karsilastir", destination: "/compare/teams?sport=football" },
      { source: "/futbol/canli", destination: "/football/live" },
      { source: "/basketbol", destination: "/basketball" },
      { source: "/basketbol/maclar", destination: "/basketball/matches" },
      { source: "/basketbol/maclar/:id", destination: "/basketball/matches/:id" },
      { source: "/basketbol/tahminler", destination: "/basketball/predictions" },
      { source: "/basketbol/sonuclar", destination: "/basketball/predictions/completed" },
      { source: "/basketbol/lig-performansi", destination: "/basketball/predictions/leagues" },
      { source: "/basketbol/karsilastir", destination: "/compare/teams?sport=basketball" },
      { source: "/basketbol/canli", destination: "/basketball/live" },
      { source: "/ligler", destination: "/leagues" },
      { source: "/ligler/:id", destination: "/leagues/:id" },
      { source: "/takimlar", destination: "/teams" },
      { source: "/takimlar/:id", destination: "/teams/:id" },
      { source: "/rehber", destination: "/guide" },
      { source: "/hesap", destination: "/account" }
    ];
  },
  async redirects() {
    if (process.env.FORCE_HTTP_SSLIP_REDIRECT !== "1") {
      return [];
    }

    return [
      {
        source: "/:path*",
        has: [
          { type: "header", key: "x-forwarded-proto", value: "https" },
          { type: "host", value: "(?<host>.+\\.sslip\\.io)" }
        ],
        destination: "http://:host/:path*",
        permanent: false
      }
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Help browsers fall back to HTTP/2 when HTTP/3/QUIC path is unstable on edge proxy.
          { key: "Alt-Svc", value: "clear" },
          ...buildSecurityHeaders()
        ]
      }
    ];
  }
};

export default nextConfig;
