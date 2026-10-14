import type { PasswordHelper } from "../core/ports";

/**
 * Password checks, and waits as long as one takes. A refusal that must
 * look like a wrong password takes a wrong password's time by waiting,
 * never by checking: anyone can make a valid known-browser token for an
 * account of their own, so a refusal that hashed would let them make the
 * server hash on demand.
 */
export interface PasswordPacer {
  /** Checks a password through core, timing the check. */
  verify(password: string, hash: string | null): Promise<boolean>;
  /** Waits about as long as a password check takes, computing nothing. */
  waitAsLongAsACheck(): Promise<void>;
}

/** The weight a new check's time carries in the running estimate. */
const WEIGHT = 0.2;

/**
 * A pacer that keeps a running estimate of how long core's checks take.
 * `prime` makes one check against the decoy at start, so the first refusal
 * already waits a check's time.
 */
export function passwordPacer(
  passwords: Pick<PasswordHelper, "verify">,
  clock: { now(): number; sleep(ms: number): Promise<void> } = {
    now: () => performance.now(),
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
  }
): PasswordPacer & { prime(): Promise<void>; estimateMs(): number } {
  let estimate: number | null = null;
  const timed = async (
    password: string,
    hash: string | null
  ): Promise<boolean> => {
    const started = clock.now();
    const valid = await passwords.verify(password, hash);
    const took = clock.now() - started;
    estimate =
      estimate === null ? took : estimate * (1 - WEIGHT) + took * WEIGHT;
    return valid;
  };

  return {
    verify: timed,
    waitAsLongAsACheck: () => clock.sleep(estimate ?? 0),
    prime: async () => {
      await timed("", null);
    },
    estimateMs: () => estimate ?? 0,
  };
}

/**
 * The pacer a plugin keeps for its life, so its estimate carries from one
 * request to the next: primed as it is made, and a wait asked for before
 * the priming check has ended waits for it first, so no refusal ever waits
 * nothing. A priming check that fails leaves the estimate to the first
 * check a request makes.
 */
export function primedPasswordPacer(
  passwords: Pick<PasswordHelper, "verify">,
  clock?: { now(): number; sleep(ms: number): Promise<void> }
): PasswordPacer {
  const pacer = passwordPacer(passwords, clock);
  const primed = pacer.prime().catch(() => undefined);

  return {
    verify: (password, hash) => pacer.verify(password, hash),
    waitAsLongAsACheck: async () => {
      await primed;
      await pacer.waitAsLongAsACheck();
    },
  };
}
