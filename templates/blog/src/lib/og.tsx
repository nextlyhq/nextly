/**
 * Shared building blocks for OG image routes.
 *
 * Every opengraph-image.tsx in the app emits a 1200×630 PNG. To keep
 * the five routes consistent (site default, post, author, category,
 * tag), they all call `renderOg` here with a specialized content block.
 *
 * Kept as a .tsx file so each route can import JSX directly.
 */

import { ImageResponse } from "next/og";

export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_CONTENT_TYPE = "image/png" as const;

type OgVariant = "site" | "post" | "author" | "category" | "tag";

interface RenderOgInput {
  variant: OgVariant;
  siteName: string;
  /** Main line — post title, author name, category label, etc. */
  primary: string;
  /** Secondary line — tagline, category description, "By X", etc. */
  secondary?: string;
  /** Small top-left badge (e.g. "Blog", "Author", "#tag"). */
  eyebrow?: string;
}

/**
 * Render a branded OG card. Uses system sans via ImageResponse's default
 * font loader — no custom font fetches (keeps the route fast and avoids
 * bundling font files into the edge runtime).
 */
export function renderOg({
  variant: _variant,
  siteName,
  primary,
  secondary,
  eyebrow,
}: RenderOgInput): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "60px 72px",
          background:
            "linear-gradient(135deg, #0f172a 0%, #1e293b 60%, #334155 100%)",
          color: "white",
          fontFamily: "sans-serif",
        }}
      >
        {/* Top band — eyebrow + site name */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 22,
            opacity: 0.75,
            textTransform: "uppercase",
            letterSpacing: "0.12em",
          }}
        >
          <span>{eyebrow ?? "Blog"}</span>
          <span>{siteName}</span>
        </div>

        {/* Main content */}
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div
            style={{
              fontSize: primary.length > 80 ? 56 : 72,
              fontWeight: 700,
              lineHeight: 1.1,
              letterSpacing: "-0.02em",
              // Clamp to ~3 lines visually
              display: "flex",
            }}
          >
            {primary}
          </div>
          {secondary ? (
            <div style={{ fontSize: 28, opacity: 0.75 }}>{secondary}</div>
          ) : null}
        </div>

        {/* Bottom band */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            fontSize: 22,
            opacity: 0.6,
          }}
        >
          Powered by Nextly
        </div>
      </div>
    ),
    OG_SIZE
  );
}
