export interface SessionUser {
  id: string;
  email: string;
  name: string;
  image: string | null;
  roleIds: string[];
  /** Custom user fields from user_ext table */
  [key: string]: unknown;
}

/**
 * The caller the deprecated `nextly/auth` guards were handed.
 *
 * @deprecated Only `checkPermission`, `checkCollectionAccess` and
 * `authenticateApiKey` use it, and they are deprecated with it. Removed in the
 * next release.
 */
export interface AuthContext {
  userId: string;
  userName: string;
  userEmail: string;
  permissions: Map<string, boolean>;
  roles: string[];
  authMethod: "session" | "api-key";
}

export interface RefreshTokenRecord {
  id: string;
  userId: string;
  tokenHash: string;
  userAgent: string | null;
  ipAddress: string | null;
  expiresAt: Date;
  createdAt: Date;
}
