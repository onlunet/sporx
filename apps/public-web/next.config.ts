import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@sporx/ui", "@sporx/api-contract"]
};

export default nextConfig;
