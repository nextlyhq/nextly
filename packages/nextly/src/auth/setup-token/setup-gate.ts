/**
 * What setup needs from the token module at request time: a reader of the
 * stored token that lasts as long as the process, and the claim that lets
 * exactly one setup run at a time.
 *
 * @module auth/setup-token/setup-gate
 */
import { randomUUID } from "node:crypto";

import {
  OPERATOR_TOKEN_MIN_DISTINCT,
  OPERATOR_TOKEN_MIN_LENGTH,
  SETUP_TOKEN_ENV,
  SETUP_TOKEN_LOG_PREFIX,
  cachedRecordReader,
  ensureSetupTokenAtBoot,
  type SetupTokenMeta,
  type SetupTokenRecord,
} from "./setup-token";

/** The `nextly_meta` key a setup in progress holds. */
export const SETUP_CLAIM_META_KEY = "auth.setup-claim";

/** The value Next.js gives `NEXT_PHASE` while `next build` runs. */
const NEXT_PRODUCTION_BUILD_PHASE = "phase-production-build";

/**
 * How long a claim stands before another setup may take it over: a setup that
 * stopped between claiming and finishing must not close setup for good.
 */
export const SETUP_CLAIM_STALE_MS = 2 * 60 * 1000;

/**
 * How often a held claim is renewed. Well inside the stale age, so a setup
 * still running however long its work takes is never taken for a stopped
 * one; only a holder whose process stopped lets its claim go stale.
 */
export const SETUP_CLAIM_RENEW_MS = 30 * 1000;

const readers = new WeakMap<
  SetupTokenMeta,
  () => Promise<SetupTokenRecord | null>
>();

/**
 * The stored token's record, read through one copy per process at most a
 * second old. Kept beside the meta service rather than built per request, so
 * the copy outlives the request that made it.
 */
export function sharedRecordReader(
  meta: SetupTokenMeta
): () => Promise<SetupTokenRecord | null> {
  let reader = readers.get(meta);
  if (!reader) {
    reader = cachedRecordReader(meta);
    readers.set(meta, reader);
  }
  return reader;
}

interface SetupClaim {
  id: string;
  at: number;
}

function isClaim(value: unknown): value is SetupClaim {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as SetupClaim).id === "string" &&
    typeof (value as SetupClaim).at === "number"
  );
}

/**
 * Claim the right to create the first administrator, or `null` when another
 * setup holds it. The holder releases it when it finishes, however it ends.
 *
 * One row, written only if absent and read back to see whose it is, so of
 * any number of setups arriving together exactly one proceeds; the rest are
 * refused as setup having completed. The holder renews its claim every
 * {@link SETUP_CLAIM_RENEW_MS} while it runs; one not renewed for
 * {@link SETUP_CLAIM_STALE_MS} is taken over by compare-and-set, so a setup
 * that stopped halfway does not close setup for good, and one still running
 * is never taken over however long its work takes.
 */
export async function claimFirstSetup(
  meta: SetupTokenMeta,
  now: () => number = Date.now
): Promise<{ release: () => Promise<void> } | null> {
  const mine: SetupClaim = { id: randomUUID(), at: now() };
  await meta.insertIfAbsent(SETUP_CLAIM_META_KEY, mine);
  const entry = await meta.getEntry<unknown>(SETUP_CLAIM_META_KEY);
  const held = entry.present && isClaim(entry.value) ? entry.value : null;
  const won =
    held?.id === mine.id ||
    (held !== null &&
      now() - held.at >= SETUP_CLAIM_STALE_MS &&
      (await meta.compareAndSet(SETUP_CLAIM_META_KEY, held, mine)));
  if (!won) return null;
  // Renewed while held, each renewal from the value this holder last wrote,
  // so it stops at once if the claim was ever taken over.
  let current = mine;
  const renew = setInterval(() => {
    const next: SetupClaim = { id: mine.id, at: now() };
    void meta
      .compareAndSet(SETUP_CLAIM_META_KEY, current, next)
      .then(renewed => {
        if (renewed) current = next;
        else clearInterval(renew);
      })
      .catch(() => clearInterval(renew));
  }, SETUP_CLAIM_RENEW_MS);
  // Never what keeps a process alive.
  renew.unref?.();
  return {
    release: async () => {
      clearInterval(renew);
      // Only the holder's own claim: a takeover after this one went stale
      // belongs to someone else.
      await meta.compareAndSet(SETUP_CLAIM_META_KEY, current, null);
      const after = await meta.getEntry<unknown>(SETUP_CLAIM_META_KEY);
      if (after.present && after.value === null) {
        await meta.delete(SETUP_CLAIM_META_KEY);
      }
    },
  };
}

/** Where a start says what it did about the token. */
interface BootLogger {
  warn?: (message: string) => void;
  info?: (message: string) => void;
}

/**
 * At a production start: issue the setup token, and say so where an operator
 * reads. Never throws: a start that cannot reach the token's row leaves setup
 * closed, which is safe, and says why.
 */
export async function issueSetupTokenAtBoot(input: {
  meta: SetupTokenMeta;
  hasAdministrator: () => Promise<boolean>;
  logger: BootLogger;
  env?: Readonly<Record<string, string | undefined>>;
}): Promise<void> {
  const { logger } = input;
  // `next build` boots the app to prerender, with NODE_ENV set to production.
  // A token issued there would be stored, and its only copy printed into the
  // build's output; the server that later serves setup would find it already
  // issued and print nothing. Only a server that serves setup issues one.
  if ((input.env ?? process.env).NEXT_PHASE === NEXT_PRODUCTION_BUILD_PHASE) {
    return;
  }
  try {
    const outcome = await ensureSetupTokenAtBoot(input);
    switch (outcome.kind) {
      case "printed":
        logger.warn?.(outcome.line);
        return;
      case "operator-token-weak":
        logger.warn?.(
          `${SETUP_TOKEN_LOG_PREFIX}: ${SETUP_TOKEN_ENV} is set but too weak, so setup stays closed. ` +
            `It needs at least ${OPERATOR_TOKEN_MIN_LENGTH} characters, ${OPERATOR_TOKEN_MIN_DISTINCT} of them distinct; ` +
            "run `nextly setup-token --generate` for a suitable value."
        );
        return;
      case "already-issued":
        logger.info?.(
          `${SETUP_TOKEN_LOG_PREFIX}: already issued for this install. Find the line that starts with ` +
            `"${SETUP_TOKEN_LOG_PREFIX} " in this install's earlier output, or run \`nextly setup-token\` ` +
            "against its database for a new one."
        );
        return;
      case "operator-token":
      case "administrator-exists":
        return;
    }
  } catch (error) {
    logger.warn?.(
      `${SETUP_TOKEN_LOG_PREFIX}: could not be issued (${error instanceof Error ? error.message : String(error)}). ` +
        "Setup stays closed until a start issues one, or run `nextly setup-token` against this database."
    );
  }
}
