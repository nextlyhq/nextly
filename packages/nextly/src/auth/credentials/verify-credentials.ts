import { verifyPassword } from "../password/index.js";

export interface CredentialVerifyInput {
  email: string;
  password: string;
}

export interface VerifiedUser {
  id: string;
  email: string;
  name: string;
  image: string | null;
  emailVerified: Date | null;
  isActive: boolean;
}

export type CredentialVerifyResult =
  | { success: true; user: VerifiedUser }
  | {
      success: false;
      code:
        | "INVALID_CREDENTIALS"
        | "ACCOUNT_INACTIVE"
        | "EMAIL_NOT_VERIFIED"
        | "ACCOUNT_LOCKED";
      message: string;
      lockedUntil?: Date;
    };

/**
 * Verify email + password credentials.
 * This function:
 * 1. Looks up the user by email
 * 2. Checks account lockout
 * 3. Verifies password with bcrypt
 * 4. Updates failed login attempts
 * 5. Checks email verification and account status
 *
 * @param input - Email and password
 * @param deps - Injected dependencies (DB queries, config)
 */
export async function verifyCredentials(
  input: CredentialVerifyInput,
  deps: {
    findUserByEmail: (email: string) => Promise<{
      id: string;
      email: string;
      name: string;
      image: string | null;
      passwordHash: string;
      emailVerified: Date | null;
      isActive: boolean;
      failedLoginAttempts: number;
      lockedUntil: Date | null;
    } | null>;
    incrementFailedAttempts: (userId: string) => Promise<void>;
    lockAccount: (userId: string, lockedUntil: Date) => Promise<void>;
    resetFailedAttempts: (userId: string) => Promise<void>;
    maxLoginAttempts: number;
    lockoutDurationSeconds: number;
    requireEmailVerification: boolean;
  }
): Promise<CredentialVerifyResult> {
  const user = await deps.findUserByEmail(input.email);

  // Don't reveal whether email exists -- same response for missing user
  if (!user) {
    return {
      success: false,
      code: "INVALID_CREDENTIALS",
      message: "Invalid email or password",
    };
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return {
      success: false,
      code: "ACCOUNT_LOCKED",
      message: "Account locked due to too many failed attempts",
      lockedUntil: user.lockedUntil,
    };
  }

  const passwordValid = await verifyPassword(input.password, user.passwordHash);
  if (!passwordValid) {
    const newAttempts = user.failedLoginAttempts + 1;

    if (newAttempts >= deps.maxLoginAttempts) {
      const lockedUntil = new Date(
        Date.now() + deps.lockoutDurationSeconds * 1000
      );
      await deps.lockAccount(user.id, lockedUntil);
    } else {
      await deps.incrementFailedAttempts(user.id);
    }

    return {
      success: false,
      code: "INVALID_CREDENTIALS",
      message: "Invalid email or password",
    };
  }

  if (user.failedLoginAttempts > 0) {
    await deps.resetFailedAttempts(user.id);
  }

  if (deps.requireEmailVerification && !user.emailVerified) {
    return {
      success: false,
      code: "EMAIL_NOT_VERIFIED",
      message: "Please verify your email address before logging in",
    };
  }

  if (!user.isActive) {
    return {
      success: false,
      code: "ACCOUNT_INACTIVE",
      message: "Account is inactive",
    };
  }

  return {
    success: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
      emailVerified: user.emailVerified,
      isActive: user.isActive,
    },
  };
}
