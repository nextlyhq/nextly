/**
 * Default Nextly brand mark — single source of truth for the inline SVG used
 * as a fallback when no custom branding logo or favicon is configured.
 *
 * Consumed by:
 * - components/shared/ThemeAwareLogo.tsx (logo fallback)
 * - context/providers/BrandingProvider.tsx (favicon fallback)
 */

export const DEFAULT_MARK_VIEWBOX = "0 0 82 97";

export const DEFAULT_MARK_PATHS = [
  "M0 96.1715L20.8952 86.5276V32.9464L47.1482 45.2098V22.2346L0 0V96.1715Z",
  "M82 0.000366211L61.1048 9.64431V63.3306L34.8028 51.0672L34.8518 73.9372L82 96.1719V0.000366211Z",
] as const;
