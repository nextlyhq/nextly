import { randomBytes } from "node:crypto";

/**
 * Generate a random CSRF token (32 bytes, hex-encoded = 64 chars).
 */
export function generateCsrfToken(): string {
  return randomBytes(32).toString("hex");
}
