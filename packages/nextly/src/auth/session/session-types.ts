export interface SessionUser {
  id: string;
  email: string;
  name: string;
  image: string | null;
  roleIds: string[];
  /** Custom user fields from user_ext table */
  [key: string]: unknown;
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
