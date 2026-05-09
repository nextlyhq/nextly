/**
 * Stripe-style request IDs (`req_<16 base32 chars>`) for the unified error
 * system. Generated at the boundary by withErrorHandler / withAction unless
 * an upstream proxy already set `x-request-id` (or one of the cloud-provider
 * variants Vercel and Cloudflare emit), in which case we honor it so a
 * single user request shares one id across all hops.
 *
 * Format: `req_` prefix + 16 chars of RFC 4648 base32-lowercase. 10 random
 * bytes provide 80 bits of entropy — uniquely identifying every request at
 * any reasonable scale.
 *
 * Works in both Node and Edge runtimes (uses Web Crypto's
 * `crypto.getRandomValues`).
 */

const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";

function base32(bytes: Uint8Array): string {
  let out = "";
  let buf = 0;
  let bits = 0;
  for (const byte of bytes) {
    buf = (buf << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(buf >> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(buf << (5 - bits)) & 0x1f];
  }
  return out;
}

export function generateRequestId(): string {
  // 10 bytes encodes to exactly 16 base32 chars.
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return "req_" + base32(bytes).slice(0, 16);
}

/**
 * Read an upstream-set request id, falling back to a freshly generated one.
 * Header precedence (most-specific first): `x-request-id` (our convention) >
 * `x-vercel-id` (Vercel) > `cf-ray` (Cloudflare).
 */
export function readOrGenerateRequestId(req: Request): string {
  return (
    req.headers.get("x-request-id") ??
    req.headers.get("x-vercel-id") ??
    req.headers.get("cf-ray") ??
    generateRequestId()
  );
}
