import type { Brand } from "./core";

export type AuthRole = "admin" | "editor" | "viewer";

export type AuthUserId = Brand<string, "AuthUserId">;

export interface AuthUser {
  id: AuthUserId;
  email: string;
  name?: string | null;
  image?: string | null;
  /**
   * True when the account holds an admin-set password the user must replace
   * before a session is issued. Carried from the credential check to the login
   * handler; not persisted in the JWT.
   */
  mustChangePassword?: boolean;
}

export interface JwtPayload {
  sub: string; // subject (user id)
  iat?: number;
  exp?: number;
  [key: string]: unknown;
}

export interface SessionUser extends Omit<AuthUser, "id"> {
  id: string; // serialized as string in session
}

export interface SessionData {
  user: SessionUser;
  expires?: string;
}

// Password reset & verification token types (shared across services)
export interface CreateResetTokenOptions {
  email: string;
  expiresInMinutes?: number; // default 60
}

export type ConsumeResetTokenResult =
  | { ok: true; email: string }
  | { ok: false; code: string };

// Minimal auth user projection used across services
// Index signature allows custom fields from user_ext to flow through
export type MinimalUser = {
  id: number | string;
  email: string;
  emailVerified?: Date | string | null;
  name: string | null;
  image: string | null;
  passwordHash?: string | null;
  roles?: string[] | null;
  isActive?: boolean | null;
  sendWelcomeEmail?: boolean | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
  [key: string]: unknown;
};

export type UserAccount = {
  id: number | string;
  userId: number | string;
  provider: string;
  providerAccountId: string;
  type: string;
};

// Structural type for dialect-agnostic table bundles used in services
export interface AuthTables {
  users: unknown;
  accounts: unknown;
  sessions: unknown;
  passwordResetTokens: unknown;
  emailVerificationTokens?: unknown;
}
export type ServiceResult = {
  success?: boolean;
  statusCode?: number;
  status?: number;
  message?: string;
  data?: unknown;
};
