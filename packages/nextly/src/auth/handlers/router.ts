import {
  handleChangePassword,
  type ChangePasswordHandlerDeps,
} from "./change-password.js";
import { handleCsrf, type CsrfHandlerDeps } from "./csrf.js";
import {
  handleForgotPassword,
  type ForgotPasswordHandlerDeps,
} from "./forgot-password.js";
import { handleLogin, type LoginHandlerDeps } from "./login.js";
import { handleLogout, type LogoutHandlerDeps } from "./logout.js";
import { handleRefresh, type RefreshHandlerDeps } from "./refresh.js";
import { handleRegister, type RegisterHandlerDeps } from "./register.js";
import {
  handleResetPassword,
  type ResetPasswordHandlerDeps,
} from "./reset-password.js";
import { handleSession, type SessionHandlerDeps } from "./session.js";
import {
  handleSetupStatus,
  handleSetup,
  type SetupHandlerDeps,
} from "./setup.js";
import {
  handleVerifyEmail,
  handleResendVerification,
  type VerifyEmailHandlerDeps,
} from "./verify-email.js";

/**
 * Combined dependency interface for all auth handlers.
 * Defined as a standalone interface (not multi-extends) to avoid TS2320 conflicts
 * where the same method name has different return types across handler deps.
 * The route handler builds this from the DI container services and config.
 */
export interface AuthRouterDeps {
  secret: string;
  isProduction: boolean;
  accessTokenTTL: number;
  refreshTokenTTL: number;
  maxLoginAttempts: number;
  lockoutDurationSeconds: number;
  loginStallTimeMs: number;
  requireEmailVerification: boolean;
  allowedOrigins: string[];

  // User lookups (widest return type to satisfy all handlers)
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
  findUserById: (userId: string) => Promise<{
    id: string;
    email: string;
    name: string;
    image: string | null;
    isActive: boolean;
  } | null>;

  incrementFailedAttempts: (userId: string) => Promise<void>;
  lockAccount: (userId: string, lockedUntil: Date) => Promise<void>;
  resetFailedAttempts: (userId: string) => Promise<void>;

  fetchRoleIds: (userId: string) => Promise<string[]>;
  fetchCustomFields: (userId: string) => Promise<Record<string, unknown>>;

  storeRefreshToken: (record: {
    id: string;
    userId: string;
    tokenHash: string;
    userAgent: string | null;
    ipAddress: string | null;
    expiresAt: Date;
  }) => Promise<void>;
  findRefreshTokenByHash: (
    tokenHash: string
  ) => Promise<{ id: string; userId: string; expiresAt: Date } | null>;
  deleteRefreshToken: (id: string) => Promise<void>;
  deleteRefreshTokenByHash: (tokenHash: string) => Promise<void>;
  deleteAllRefreshTokensForUser: (userId: string) => Promise<void>;

  getUserCount: () => Promise<number>;
  createSuperAdmin: (data: {
    email: string;
    name: string;
    password: string;
  }) => Promise<{ id: string; email: string; name: string }>;
  seedPermissions: () => Promise<void>;

  registerUser: (data: {
    email: string;
    password: string;
    name: string;
  }) => Promise<{
    success: boolean;
    user?: { id: string; email: string; name: string };
    error?: string;
  }>;

  generatePasswordResetToken: (
    email: string,
    redirectPath?: string
  ) => Promise<{ success: boolean; token?: string }>;
  resetPasswordWithToken: (
    token: string,
    newPassword: string
  ) => Promise<{ success: boolean; error?: string; email?: string }>;
  changePassword: (
    userId: string,
    currentPassword: string,
    newPassword: string
  ) => Promise<{ success: boolean; error?: string }>;

  verifyEmail: (
    token: string
  ) => Promise<{ success: boolean; error?: string; email?: string }>;
  resendVerificationEmail: (
    email: string
  ) => Promise<{ success: boolean; error?: string }>;
}

/**
 * Route an auth request to the appropriate handler.
 * Returns null if the path doesn't match any auth route (caller handles 404).
 *
 * @param request - The incoming HTTP request
 * @param authPath - The path after the auth prefix (e.g., "login", "setup-status")
 * @param deps - Injected service dependencies
 */
export async function routeAuthRequest(
  request: Request,
  authPath: string,
  deps: AuthRouterDeps
): Promise<Response | null> {
  const method = request.method.toUpperCase();

  if (method === "GET") {
    switch (authPath) {
      case "setup-status":
        return handleSetupStatus(request, deps);
      case "session":
        return handleSession(request, deps);
      case "csrf":
        return handleCsrf(request, deps);
      default:
        return null;
    }
  }

  if (method === "POST") {
    switch (authPath) {
      case "login":
        return handleLogin(request, deps);
      case "logout":
        return handleLogout(request, deps);
      case "refresh":
        return handleRefresh(request, deps);
      case "setup":
        return handleSetup(request, deps);
      case "register":
        return handleRegister(request, deps);
      case "forgot-password":
        return handleForgotPassword(request, deps);
      case "reset-password":
        return handleResetPassword(request, deps);
      case "verify-email":
        return handleVerifyEmail(request, deps);
      case "verify-email/resend":
        return handleResendVerification(request, deps);
      default:
        return null;
    }
  }

  if (method === "PATCH") {
    switch (authPath) {
      case "change-password":
        return handleChangePassword(request, deps);
      default:
        return null;
    }
  }

  return null;
}
