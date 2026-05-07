import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";

function buildContentSecurityPolicy() {
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "img-src 'self' data: blob: https://*.plaid.com https://cdn.plaid.com",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    `script-src 'self' 'unsafe-inline'${isProduction ? "" : " 'unsafe-eval'"} https://cdn.plaid.com`,
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.plaid.com",
    "frame-src 'self' https://*.plaid.com https://cdn.plaid.com",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    isProduction ? "upgrade-insecure-requests" : ""
  ];

  return directives.filter(Boolean).join("; ");
}

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: buildContentSecurityPolicy()
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()"
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin"
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload"
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff"
  },
  {
    key: "X-DNS-Prefetch-Control",
    value: "off"
  },
  {
    key: "X-Frame-Options",
    value: "DENY"
  }
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        headers: securityHeaders,
        source: "/(.*)"
      }
    ];
  },
  reactStrictMode: true
};

export default nextConfig;
