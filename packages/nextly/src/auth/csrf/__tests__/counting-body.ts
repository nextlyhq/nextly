/**
 * A request body that counts what is read from it, for the tests of the CSRF
 * body read.
 *
 * Shared by the route option's tests and `ctx.auth.verifyCsrf`'s, because the
 * two go through one reader and have to be held to the same bound.
 *
 * `MAX_CSRF_BODY_BYTES` restates the reader's cap rather than importing it:
 * a test bound derived from the code under test moves with it, and stops
 * catching a cap that was raised.
 */

/** The cap the CSRF read stops at, and a chunk small enough to see it. */
export const MAX_CSRF_BODY_BYTES = 64 * 1024;
export const CHUNK = 4 * 1024;

/**
 * What a stream costs before anyone reads it on purpose: undici primes the
 * body when the Request is constructed, and primes the second tee branch when
 * it is cloned. Measured, not assumed: the tests that use it bound their
 * reads by it.
 */
export const PRIMED = 2 * CHUNK;

/**
 * A body that COUNTS what is taken from it.
 *
 * The defect is invisible in the response — a forged request is refused
 * either way — so the measurement has to be of the reading itself.
 */
export function countingBody(chunks: number): {
  stream: ReadableStream<Uint8Array>;
  read: () => number;
} {
  let sent = 0;
  let bytes = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= chunks) {
        controller.close();
        return;
      }
      sent += 1;
      bytes += CHUNK;
      controller.enqueue(new Uint8Array(CHUNK).fill(0x20));
    },
  });
  return { stream, read: () => bytes };
}
