/**
 * The deploy-time lock that turns AI off: `NEXTLY_AI=off` where the site is
 * deployed.
 *
 * Read once, when a boot records its plugins, and kept for that boot: the
 * lock is set where the site is deployed, so nothing a request does, and
 * nothing in the admin, can lift it while the site runs. Core holds the one
 * answer; the AI package and anything else that must stay off with AI read
 * it here rather than reading the environment again. It removes nothing: the
 * provider and its settings stay as they were, and core simply stops asking.
 *
 * @module domains/ai/ai-switch
 */
import { AI_LOCK_OFF, AI_LOCK_VARIABLE } from "./ai-contract";

/** Where the lock may be set. */
export interface AILockSources {
  /** The site's environment. */
  environment: Readonly<Record<string, string | undefined>>;
  /**
   * Whether the site's configuration sets the lock, where it can. The
   * environment wins: a configuration cannot lift a lock the environment
   * sets.
   */
  configuration?: boolean;
}

/**
 * Whether these sources lock AI off: the variable set to `off` (trimmed,
 * any case), or the configuration's setting. Any other value of the
 * variable leaves AI as the configuration says.
 */
export function aiLockedOff({
  environment,
  configuration,
}: AILockSources): boolean {
  const value = environment[AI_LOCK_VARIABLE]?.trim().toLowerCase();
  if (value === AI_LOCK_OFF) return true;
  return configuration === true;
}

const globalForAILock = globalThis as unknown as {
  __nextly_aiLockedOff?: boolean;
};

/**
 * Decide the lock for this boot and keep the answer. On globalThis, like the
 * other boot records, so it survives the module re-evaluation Next.js does.
 */
export function recordAILock(sources: AILockSources): void {
  globalForAILock.__nextly_aiLockedOff = aiLockedOff(sources);
}

/** Forget the boot's answer, for a process whose boot has been undone. */
export function forgetAILock(): void {
  globalForAILock.__nextly_aiLockedOff = undefined;
}

/**
 * Core's one answer to "is AI locked off on this site?": this boot's, or,
 * before any boot has decided, what the environment says now, so a check
 * made that early never takes a locked site for an open one.
 */
export function aiTurnedOff(): boolean {
  return (
    globalForAILock.__nextly_aiLockedOff ??
    aiLockedOff({ environment: process.env })
  );
}
