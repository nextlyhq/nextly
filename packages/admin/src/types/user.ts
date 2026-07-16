// User entity type definitions

import type { ApiRole } from "@admin/types/entities";

export interface User {
  id: string;
  name: string;
  email: string;
  roles: string[];
  created: string;
  image?: string;
  password: string;
  isActive?: boolean;
  createdAt?: string;
  updatedAt: string;
}

export interface UserApiResponse {
  id: string;
  name: string;
  email: string;
  roles: ApiRole[];
  created: string;
  image?: string;
  createdAt?: string;
  updatedAt: string;
  /** Index signature allows custom fields from user_ext to flow through */
  [key: string]: unknown;
}

/**
 * Payload for updating a user via API
 *
 * Note: This differs from User interface because the API accepts
 * roles as objects with id property, while User stores them as string[]
 */
/**
 * Payload for creating a user via API.
 *
 * Extends Partial<User> with an index signature for custom user fields.
 * Omitting `password` creates the account in invite mode (a set-password link
 * is returned); providing one sets the credential directly.
 */
export interface CreateUserPayload extends Partial<User> {
  [key: string]: unknown;
}

export interface UpdateUserPayload {
  name?: string;
  email?: string;
  roles?: Array<{ id: string }>;
  image?: string;
  password?: string;
  isActive?: boolean;
}
