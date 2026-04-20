import { publicApi } from "../lib/api/publicApi";

/**
 * Request a password reset email for the given address.
 * The backend always returns success regardless of whether the email exists
 * (security best practice — never reveal user existence).
 */
export async function requestPasswordReset(
  email: string,
  csrfToken: string
): Promise<void> {
  await publicApi.post("/auth/forgot-password", { email, csrfToken });
}

/**
 * Reset a user's password using the token from the reset email.
 */
export async function resetPassword(
  token: string,
  newPassword: string,
  csrfToken: string
): Promise<void> {
  await publicApi.post("/auth/reset-password", {
    token,
    newPassword,
    csrfToken,
  });
}

/**
 * Verify a user's email address using the token from the verification email.
 * No CSRF needed here: the URL token itself is the unguessable secret.
 * See docs/auth/csrf.md.
 */
export async function verifyEmail(token: string): Promise<void> {
  await publicApi.post("/auth/verify-email", { token });
}

export const authApi = {
  requestPasswordReset,
  resetPassword,
  verifyEmail,
} as const;
