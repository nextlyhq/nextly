/**
 * The answer of `body` as a promise, with anything it throws as a rejection,
 * as an asynchronous provider or source would answer. The reference
 * implementations keep their state in memory, so their work is synchronous.
 */
export function later<T>(body: () => T): Promise<T> {
  return new Promise<T>(resolve => resolve(body()));
}
