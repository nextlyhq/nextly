/**
 * MySQL's two per-lock waits of a session, bounded for one try for a busy table and then put back.
 *
 * A table's metadata lock is bounded by `lock_wait_timeout`, a row's lock by
 * `innodb_lock_wait_timeout`. Both are session settings, which outlive a transaction on its pooled
 * connection, so each is set back to the value the session had before the try, never to the
 * server's default, which may not be what the session ran with.
 *
 * @module domains/schema/busy-table/mysql-wait-bounds
 */

/** The connection the settings are sent on: the try's transaction or session. */
export interface MysqlWaitSession {
  /** Runs fixed text and returns its rows. */
  read(text: string): Promise<readonly Record<string, unknown>[]>;
  /** Runs fixed text for its effect. */
  run(text: string): Promise<void>;
}

/** The two settings, in the order they are set and put back. */
const SETTINGS = [
  ["lock_wait_timeout", "lock_wait"],
  ["innodb_lock_wait_timeout", "row_wait"],
] as const;

/** A setting read back as a whole number, or undefined for anything else. */
function wholeNumber(value: unknown): number | undefined {
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isSafeInteger(number)
    ? number
    : undefined;
}

/**
 * Bounds both of `session`'s lock waits to `seconds` (whole seconds, at least 1) and returns what
 * sets each back to the value the session had: one that could not be read goes back to the
 * server's default, the nearest to it. Putting them back is best effort; the try has already
 * ended, and a failure there must not change how.
 */
export async function boundMysqlLockWaits(
  session: MysqlWaitSession,
  seconds: number
): Promise<() => Promise<void>> {
  const [row] = await session.read(
    "SELECT @@SESSION.lock_wait_timeout AS lock_wait, @@SESSION.innodb_lock_wait_timeout AS row_wait"
  );
  const before = SETTINGS.map(
    ([name, column]) => [name, wholeNumber(row?.[column])] as const
  );
  // Fixed text with a whole number of seconds, never caller input.
  const bound = String(Math.max(1, Math.ceil(seconds)));
  for (const [name] of SETTINGS) {
    await session.run(`SET SESSION ${name} = ${bound}`);
  }
  return async () => {
    for (const [name, value] of before) {
      await session
        .run(
          `SET SESSION ${name} = ${value === undefined ? "DEFAULT" : String(value)}`
        )
        .catch(() => undefined);
    }
  };
}
