import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  async rewrites() {
    return [
      {
        source: '/api/webhooks/razorpa',
        destination: '/api/webhooks/razorpay',
      },
    ];
  },
};

export default nextConfig;
