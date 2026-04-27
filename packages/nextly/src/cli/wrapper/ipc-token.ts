// What: generates and validates a loopback-only auth token for wrapper <-> child IPC.
// Why: even on 127.0.0.1 any process on the machine can POST to our IPC port. A
// token shared between wrapper and child via env var and checked with a
// timing-safe comparison prevents accidental or malicious external IPC calls
// from other dev tools, other Nextly instances, or stray curl attempts.

import { randomBytes, timingSafeEqual } from "node:crypto";

const MIN_TOKEN_LENGTH = 32;

// Generates a URL-safe 32+ character token suitable for an HTTP header.
export function generateIpcToken(): string {
  return randomBytes(24).toString("base64url");
}

// Compares two tokens in constant time to avoid leaking information via
// response timing. Returns false for empty or length-mismatched tokens
// without triggering timingSafeEqual's length-mismatch throw.
export function validateIpcToken(
  provided: string | null | undefined,
  expected: string | null | undefined
): boolean {
  if (!provided || !expected) return false;
  if (provided.length !== expected.length) return false;
  if (provided.length < MIN_TOKEN_LENGTH) return false;
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  } catch {
    return false;
  }
}
