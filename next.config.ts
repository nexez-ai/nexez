import path from "node:path";
import type { NextConfig } from "next";
import { parseMarketplaceDiscoveryEnabled } from "./lib/marketplace-discovery";

function configuredAppOrigin(): string {
  try {
    const url = new URL(process.env.NEXT_PUBLIC_APP_URL || "https://app.nexez.ai");
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.origin
      : "https://app.nexez.ai";
  } catch {
    return "https://app.nexez.ai";
  }
}

const nextConfig: NextConfig = {
  // The project canonicalizes local dev on 127.0.0.1 (see redirects below), so
  // allow it as a dev origin — otherwise Next blocks HMR/client dev resources
  // and client components never hydrate locally. Dev-only; no production impact.
  allowedDevOrigins: ["127.0.0.1"],
  // Don't advertise the framework version in responses.
  poweredByHeader: false,
  // Keep react-email out of the server bundle so its transitive deps are present at
  // runtime in the Vercel serverless function. Bundling it dropped a dependency under
  // Next's output tracing, so render() threw at runtime (passed locally + in the build
  // — full node_modules — but failed live), silently killing every transactional email.
  serverExternalPackages: ["@react-email/components", "@react-email/render"],
  turbopack: {
    root: path.resolve("."),
  },
  async redirects() {
    const marketplaceDiscoveryEnabled = parseMarketplaceDiscoveryEnabled(
      process.env.NEXT_PUBLIC_MARKETPLACE_DISCOVERY_ENABLED,
    );
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "localhost:3000" }],
        destination: "http://127.0.0.1:3000/:path*",
        permanent: false,
      },
      {
        source: "/:path*",
        has: [{ type: "host", value: "localhost" }],
        destination: "http://127.0.0.1:3000/:path*",
        permanent: false,
      },
      ...(!marketplaceDiscoveryEnabled
        ? [
            { source: "/discovery", destination: "/", permanent: false },
            { source: "/leaderboard", destination: "/", permanent: false },
          ]
        : []),
      // Legacy human marketplace aliases follow the same launch switch. Hidden
      // redirects are temporary so browsers do not cache them past launch.
      {
        source: "/directory",
        destination: marketplaceDiscoveryEnabled ? "/discovery" : "/",
        permanent: marketplaceDiscoveryEnabled,
      },
      {
        source: "/marketplace",
        destination: marketplaceDiscoveryEnabled ? "/discovery?sort=trending" : "/",
        permanent: marketplaceDiscoveryEnabled,
      },
      // Agent Lab consolidation: the standalone Competitors dashboard page folded
      // into the simulator as its signed-in "Compare a competitor" lens.
      { source: "/dashboard/competitors", destination: "/simulator?mode=compare", permanent: true },
      // Storefront/Listing rename: the seller's "Pages" manager is now "Listings"
      // at /dashboard/listings. 308 preserves bookmarks + the incoming ?status query.
      { source: "/dashboard/pages", destination: "/dashboard/listings", permanent: true },
    ];
  },
  async headers() {
    // Safe on every route, every host (no behavior change).
    const baseline = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
    ];
    // Clickjacking protection for the authed/app surfaces. Deliberately NOT applied to
    // the public agent pages ([slug]) or marketing: the dashboard's "test" preview
    // iframes /<slug> (which redirects cross-origin to the agent runtime), so a blanket
    // SAMEORIGIN would break that preview. frame-ancestors here governs who may frame
    // THESE pages, not what they embed (Stripe Elements / the preview iframe are fine).
    const frame = [
      ...baseline,
      { key: "X-Frame-Options", value: "SAMEORIGIN" },
      { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
    ];
    // Staged settlement links are bearer-gated on the cookie-isolated agent
    // runtime. The authenticated app may act as a first-party buyer client, so
    // these exact public endpoints support app-to-runtime browser requests.
    const appActionCors = [
      { key: "Access-Control-Allow-Origin", value: configuredAppOrigin() },
      { key: "Access-Control-Allow-Headers", value: "Content-Type, Idempotency-Key" },
      { key: "Access-Control-Max-Age", value: "600" },
    ];
    return [
      { source: "/:path*", headers: baseline },
      {
        source: "/api/staged-settlements/:token",
        headers: [
          ...appActionCors,
          { key: "Access-Control-Allow-Methods", value: "GET, OPTIONS" },
        ],
      },
      {
        source: "/api/staged-settlements/:token/checkout",
        headers: [
          ...appActionCors,
          { key: "Access-Control-Allow-Methods", value: "POST, OPTIONS" },
        ],
      },
      // The marketing homepage can be clickjacking-protected without affecting
      // crawlable agent pages, public JSON artifacts, or dashboard preview iframes.
      { source: "/", headers: frame },
      { source: "/dashboard/:path*", headers: frame },
      { source: "/console/:path*", headers: frame },
      { source: "/admin/:path*", headers: frame },
      { source: "/login", headers: frame },
      { source: "/auth/:path*", headers: frame },
      { source: "/onboard", headers: frame },
      { source: "/create", headers: frame },
      { source: "/create/:path*", headers: frame },
    ];
  },
};

export default nextConfig;
