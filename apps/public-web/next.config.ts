import type { NextConfig } from "next";

function trimTrailingSlash(value: string) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

const upstreamApiBase = trimTrailingSlash(
  process.env.INTERNAL_API_URL ?? process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"
);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@sporx/ui", "@sporx/api-contract"],
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: `${upstreamApiBase}/api/v1/:path*`
      }
    ];
  }
};

export default nextConfig;