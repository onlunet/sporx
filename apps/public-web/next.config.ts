import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@sporx/ui", "@sporx/api-contract"],
  async redirects() {
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
          { key: "Alt-Svc", value: "clear" }
        ]
      }
    ];
  }
};

export default nextConfig;
