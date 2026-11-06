/**
 * Another writer's change, landing between a write's lost version-number
 * attempt and its retry.
 *
 * The adapter retries a version conflict itself (`versionConflictRetries`), so
 * one `adapter.transaction` call makes every attempt, and the only point
 * between two attempts a test can reach is `retryWhen`: the adapter asks it
 * once the lost attempt has rolled back, outside any transaction. The change
 * starts there, so it runs on its own and commits before the retry reads
 * anything, as a concurrent save would.
 *
 * @module domains/versions/__tests__/helpers/between-attempts
 */
import type {
  TransactionContext,
  TransactionOptions,
} from "@nextlyhq/adapter-drizzle/types";
import { vi } from "vitest";

/** The adapter, as far as opening a transaction. */
interface Transactor {
  transaction<T>(
    work: (ctx: TransactionContext) => Promise<T>,
    options?: TransactionOptions
  ): Promise<T>;
}

/**
 * Spy on `adapter.transaction` so that, in the transaction that retries a
 * version conflict (the one given `retryWhen`), `change` runs once the first
 * attempt has lost and has finished before the retry's work begins. Every
 * other transaction runs as it would.
 *
 * @returns How many attempts that transaction made so far
 */
export function changeBetweenAttempts(
  adapter: Transactor,
  change: () => Promise<unknown>
): () => number {
  const transaction = adapter.transaction.bind(adapter);
  let attempts = 0;
  let between: Promise<unknown> | undefined;
  vi.spyOn(adapter, "transaction").mockImplementation(((
    work: (ctx: TransactionContext) => Promise<unknown>,
    options?: TransactionOptions
  ) => {
    const retryWhen = options?.retryWhen;
    if (retryWhen === undefined) return transaction(work, options);
    return transaction(
      async ctx => {
        attempts += 1;
        // The retry starts from the database as the change left it.
        if (attempts > 1) await between;
        return work(ctx);
      },
      {
        ...options,
        retryWhen: error => {
          const retried = retryWhen(error);
          if (retried && between === undefined) between = change();
          return retried;
        },
      }
    );
  }) as Transactor["transaction"]);
  return () => attempts;
}
