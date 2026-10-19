import { env } from "./env";

/**
 * Resolve the public base URL for outbound links — email templates,
 * absolutized media URLs in API responses, anywhere the server needs to
 * hand a fully-qualified URL to an external client.
 *
 * Priority:
 *   1. `override` if provided (e.g. `emailConfig.baseUrl`)
 *   2. `env.NEXT_PUBLIC_APP_URL`
 *   3. `http://localhost:3000` (development fallback)
 *
 * The env schema enforces presence of `NEXT_PUBLIC_APP_URL` in production
 * at boot (see `_envSchema.superRefine` in `./env`), so the localhost
 * fallback is only reachable in development and test.
 *
 * Trailing slashes are stripped so callers can concatenate paths
 * (`${base}${path}`) without producing `//` in the result.
 */
export function getBaseUrl(override?: string | null): string {
  return getPublicOrigin(override) ?? "http://localhost:3000";
}

/**
 * The public origin set for outbound links: `override`, else
 * `env.NEXT_PUBLIC_APP_URL`, without a trailing slash; null when neither is
 * set. For a caller that must not fall back to a guessed host, where
 * {@link getBaseUrl} would answer `http://localhost:3000`.
 */
export function getPublicOrigin(override?: string | null): string | null {
  const raw = override?.trim() || env.NEXT_PUBLIC_APP_URL?.trim();
  return raw ? raw.replace(/\/+$/, "") : null;
}
