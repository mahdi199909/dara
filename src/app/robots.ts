import type { MetadataRoute } from "next";

export const dynamic = "force-static";

// Crawling stays allowed on purpose: every page carries noindex (layout.tsx metadata and the
// X-Robots-Tag header), and a crawler blocked by robots.txt would never see that — already-indexed
// pages like /login would then stay in the results. No sitemap: nothing here should be listed.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/" } };
}
