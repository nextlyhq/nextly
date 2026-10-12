/**
 * The `isActive` and `deactivatedAt` writes an administrator's update makes.
 *
 * @module domains/users/services/user-activation
 */
import type { UserUpdateData } from "../../../types/database-operations";

/**
 * The writes for an update that sets `isActive`.
 *
 * An explicit `false` records the deactivation even when the account was
 * already inactive — a self-registration still waiting on its link is
 * inactive, and deactivating it is what stops that link from switching it on.
 * Recording it always writes `isActive: false` in the same statement, rather
 * than only when the value read looked different: a verification link
 * followed between the read and the write can have activated the account, and
 * a deactivation that wrote only the timestamp would leave it active. An
 * explicit `true` clears the record. The first deactivation's time is kept.
 */
export function activationChanges(
  next: boolean,
  current: { isActive: boolean; deactivatedAt: Date | null }
): Pick<UserUpdateData, "isActive" | "deactivatedAt"> {
  if (!next) {
    return current.deactivatedAt
      ? current.isActive
        ? { isActive: false }
        : {}
      : { isActive: false, deactivatedAt: new Date() };
  }
  const out: Pick<UserUpdateData, "isActive" | "deactivatedAt"> = {};
  if (!current.isActive) out.isActive = true;
  if (current.deactivatedAt) out.deactivatedAt = null;
  return out;
}
