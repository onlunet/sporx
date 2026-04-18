import type { NextConfig } from "next";

const strictSecurityHeaders = process.env.STRICT_SECURITY_HEADERS_ENABLED !== "false";
const adminContentSecurityPolicy =
  process.env.ADMIN_WEB_CSP ??
  "default-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; img-src 'self' data: https:; font-src 'self' data: https://fonts.gstatic.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; script-src 'self' 'unsafe-inline'; connect-src 'self' https: wss:;";

function buildAdminSecurityHeaders() {
  if (!strictSecurityHeaders) {
    return [];
  }
  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "no-referrer" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Permissions-Policy", value: "accelerometer=(), camera=(), geolocation=(), microphone=(), payment=(), usb=()" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Cross-Origin-Resource-Policy", value: "same-site" },
    { key: "Content-Security-Policy", value: adminContentSecurityPolicy }
  ];
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@sporx/ui", "@sporx/api-contract"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: buildAdminSecurityHeaders()
      }
    ];
  }
};

export default nextConfig;
