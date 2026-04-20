/**
 * SVG Security Utilities
 *
 * Provides CSP header constants and helpers for securing SVG file responses.
 * SVG files can contain embedded `<script>` tags, event handlers, and
 * `<foreignObject>` elements that execute JavaScript when the SVG is
 * rendered directly in a browser (not via `<img>` tags, which are sandboxed).
 *
 * Since Nextly delegates file serving to cloud storage providers (S3, Vercel Blob),
 * these headers cannot be applied at the application level. Instead:
 *
 * 1. **S3 uploads**: `Content-Disposition: attachment` is set automatically for SVGs,
 *    forcing browsers to download instead of render (preventing script execution).
 *
 * 2. **CDN configuration**: Use these exported constants to configure response header
 *    policies on your CDN (CloudFront, Cloudflare, Vercel Edge Config) for SVG files.
 *
 * @example CloudFront Response Header Policy
 * ```
 * // In your CloudFront distribution config, create a response header policy
 * // that matches Content-Type: image/svg+xml and adds:
 * Content-Security-Policy: script-src 'none'; style-src 'unsafe-inline'
 * X-Content-Type-Options: nosniff
 * ```
 *
 * @example Custom Next.js route (proxy pattern)
 * ```typescript
 * import { getSvgSecurityHeaders, isSvgMimeType } from '@revnixhq/nextly/storage';
 *
 * export async function GET(req: Request) {
 *   const file = await fetchFromStorage(req);
 *   const headers = new Headers();
 *   headers.set('Content-Type', file.mimeType);
 *
 *   if (isSvgMimeType(file.mimeType)) {
 *     for (const [key, value] of Object.entries(getSvgSecurityHeaders())) {
 *       headers.set(key, value);
 *     }
 *   }
 *
 *   return new Response(file.buffer, { headers });
 * }
 * ```
 */

// ============================================================
// Constants
// ============================================================

/**
 * Content-Security-Policy header value for SVG responses.
 *
 * - `script-src 'none'` — blocks all JavaScript execution (inline scripts,
 *   event handlers, `<script>` tags, `<foreignObject>` scripts)
 * - `style-src 'unsafe-inline'` — allows inline styles (SVGs commonly use
 *   `style` attributes and `<style>` elements for legitimate styling)
 */
export const SVG_CSP_HEADER =
  "script-src 'none'; style-src 'unsafe-inline'" as const;

// ============================================================
// Helpers
// ============================================================

/**
 * Check if a MIME type is SVG.
 *
 * @param mimeType - MIME type string to check
 * @returns `true` if the MIME type is `image/svg+xml`
 */
export function isSvgMimeType(mimeType: string): boolean {
  return mimeType.toLowerCase().trim() === "image/svg+xml";
}

/**
 * Get the full set of security headers that should be applied to SVG responses.
 *
 * Returns headers that prevent script execution while preserving SVG rendering:
 * - `Content-Security-Policy` — blocks scripts
 * - `X-Content-Type-Options: nosniff` — prevents MIME type sniffing
 *
 * @returns Record of header name → value pairs
 */
export function getSvgSecurityHeaders(): Record<string, string> {
  return {
    "Content-Security-Policy": SVG_CSP_HEADER,
    "X-Content-Type-Options": "nosniff",
  };
}
