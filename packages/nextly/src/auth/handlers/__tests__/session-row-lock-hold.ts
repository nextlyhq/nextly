/**
 * Holding a real session-row transaction open after it has taken its
 * user-row lock, so a test can start a revocation while the lock is held and
 * watch whether it waits.
 *
 * The revocation is started by the test body, outside the request's async
 * context, once `lockHeld` resolves: nothing inside the locked transaction
 * awaits it, so a revocation that does not wait for the lock commits during
 * the hold and a revocation that does wait commits after the transaction.
 */
import type { AuthRouterDeps } from "../router";

/** What the test body records, and what the hold observed of it. */
export interface RevocationProbe {
  /** Set by the test body once its revocation has committed. */
  revoked: boolean;
  /** `revoked` as it stood when the hold ended, before the write went on. */
  revokedDuringHold?: boolean;
}

/**
 * Wrap `deps.withSessionRowTransaction` so the first `lockAccountState` takes
 * the real lock, resolves `lockHeld`, and keeps the transaction open for
 * `holdMs` before the write continues.
 */
export function holdSessionRowLock(
  deps: AuthRouterDeps,
  holdMs = 400
): { lockHeld: Promise<void>; probe: RevocationProbe } {
  const probe: RevocationProbe = { revoked: false };
  let locked!: () => void;
  const lockHeld = new Promise<void>(resolve => {
    locked = resolve;
  });
  let held = false;
  const withTransaction = deps.withSessionRowTransaction;
  deps.withSessionRowTransaction = work =>
    withTransaction(tx =>
      work({
        ...tx,
        lockAccountState: async userId => {
          const state = await tx.lockAccountState(userId);
          if (!held) {
            held = true;
            locked();
            await new Promise(resolve => setTimeout(resolve, holdMs));
            probe.revokedDuringHold = probe.revoked;
          }
          return state;
        },
      })
    );
  return { lockHeld, probe };
}
