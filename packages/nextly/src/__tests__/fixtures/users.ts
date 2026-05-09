import { randomUUID } from "crypto";

/**
 * Factory for creating test user data.
 *
 * Provides a simple way to create user records for testing.
 */
export function userFactory(overrides?: {
  id?: string;
  name?: string;
  email?: string;
  emailVerified?: number | null;
  passwordUpdatedAt?: number | null;
  image?: string | null;
  passwordHash?: string | null;
}) {
  const randomSuffix = randomUUID().slice(0, 8);

  return {
    id: overrides?.id ?? randomUUID(),
    name: overrides?.name ?? `Test User ${randomSuffix}`,
    email: overrides?.email ?? `user-${randomSuffix}@test.com`,
    emailVerified: overrides?.emailVerified ?? null,
    passwordUpdatedAt: overrides?.passwordUpdatedAt ?? null,
    image: overrides?.image ?? null,
    passwordHash: overrides?.passwordHash ?? null,
  };
}

/**
 * Factory for creating multiple test users.
 *
 * @param count - Number of users to create
 * @param overrideFn - Optional function to customize each user
 * @returns Array of user objects
 */
export function bulkUsersFactory(
  count: number,
  overrideFn?: (index: number) => Partial<ReturnType<typeof userFactory>>
) {
  return Array.from({ length: count }, (_, i) => {
    const overrides = overrideFn ? overrideFn(i) : {};
    return userFactory(overrides);
  });
}
