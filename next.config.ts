import type { NextConfig } from "next";
import { enfyraConfig } from "./lib/enfyra-config";

const nextConfig: NextConfig = {
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      {
        source: `${enfyraConfig.apiProxyPrefix}/:path*`,
        destination: `${enfyraConfig.enfyraApiUrl}/:path*`,
      },
      {
        source: "/socket.io/",
        destination: `${enfyraConfig.enfyraAppUrl}/ws/socket.io/`,
      },
    ];
  },
};

export default nextConfig;
