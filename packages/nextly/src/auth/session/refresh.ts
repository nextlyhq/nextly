import { randomBytes, createHash } from "node:crypto";

/**
 * Generate a new opaque refresh token (64 bytes, hex-encoded = 128 chars).
 */
export function generateRefreshToken(): string {
  return randomBytes(64).toString("hex");
}

/**
 * Hash a refresh token using SHA-256 for database storage.
 * We use SHA-256 (not bcrypt) because refresh tokens have high entropy (64 bytes).
 */
export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Generate a unique ID for a refresh token record.
 */
export function generateRefreshTokenId(): string {
  return `rt_${randomBytes(16).toString("hex")}`;
}
