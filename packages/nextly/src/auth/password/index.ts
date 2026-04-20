import bcrypt from "bcryptjs";

import { PasswordSchema } from "@nextly/schemas/validation";

/**
 * Password hashing/verification utilities for credentials authentication.
 * Uses bcryptjs to avoid native build steps and keep portability.
 */

const defaultSaltRounds = 12; // Reasonable default; can be tuned via env later

export async function hashPassword(
  plain: string,
  saltRounds: number = defaultSaltRounds
): Promise<string> {
  if (!plain) {
    throw new Error("hashPassword: plain must be non-empty");
  }
  const salt = await bcrypt.genSalt(saltRounds);
  return bcrypt.hash(plain, salt);
}

export async function verifyPassword(
  plain: string,
  hash: string
): Promise<boolean> {
  if (!plain || !hash) return false;
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

export type PasswordStrengthResult =
  | { ok: true; errors?: undefined }
  | { ok: false; errors: string[] };

export function validatePasswordStrength(
  password: string
): PasswordStrengthResult {
  const result = PasswordSchema.safeParse(password);
  if (result.success) {
    return { ok: true };
  } else {
    return {
      ok: false,
      errors: result.error.issues.map(
        (issue: { message: string }) => issue.message
      ),
    };
  }
}
