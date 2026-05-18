import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Tally - Personal Finance Copilot",
    short_name: "Tally",
    description: "A calm personal finance dashboard for reviewing bank data, recurring spending, and trusted budget records.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#f7f7f4",
    theme_color: "#f7f7f4",
    icons: [
      {
        src: "/icons/tally-icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable"
      },
      {
        src: "/icons/tally-icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable"
      }
    ]
  };
}
