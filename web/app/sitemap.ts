import type { MetadataRoute } from "next";

// TODO: replace the fallback below with the real production URL once
// deployed (Phase 3), or set NEXT_PUBLIC_SITE_URL in the deploy environment.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://climagrid.example.com";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1,
    },
  ];
}