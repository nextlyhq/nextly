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
  const raw = override?.trim() || env.NEXT_PUBLIC_APP_URL?.trim();
  const url = raw || "http://localhost:3000";
  return url.replace(/\/+$/, "");
}
