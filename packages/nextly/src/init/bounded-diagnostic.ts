/**
 * Run a startup diagnostic that may report but must never block the boot.
 *
 * A diagnostic on the initialized-boot path is information for the operator,
 * not a prerequisite for serving. Two things would otherwise let it become one:
 * a REJECTED query, which is caught here, and a STALLED one, which never
 * rejects — a saturated pool or an unresponsive database holds the await for
 * the driver's own timeout, which can be minutes, and startup waits with it.
 * So the wait is bounded here rather than left to the driver, and a timeout
 * is logged at debug rather than reported: it says nothing about the schema.
 *
 * Kept apart from the check it bounds, because any diagnostic added beside it
 * wants exactly this contract and a second copy of the race would drift from
 * the first.
 *
 * @module init/bounded-diagnostic
 */

interface LoggerLike {
  debug?: (msg: string) => void;
}

export interface BoundedDiagnosticArgs {
  /** The check itself. Whatever it warns about, it does through its own logger. */
  run: () => Promise<void>;
  logger: LoggerLike;
  /** How long the check may take before boot proceeds without it. */
  timeoutMs: number;
  /** What to call the check in the debug line written when it times out. */
  timedOutMessage: string;
  /** Prefix for the debug line written when the check throws. */
  failedMessagePrefix: string;
}

export async function runBoundedDiagnostic(
  args: BoundedDiagnosticArgs
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timedOut = Symbol("diagnostic-timeout");
    const deadline = new Promise<typeof timedOut>(resolve => {
      timer = setTimeout(() => resolve(timedOut), args.timeoutMs);
      // Do not hold the event loop open for a diagnostic.
      timer.unref?.();
    });

    const outcome = await Promise.race([args.run(), deadline]);
    if (outcome === timedOut) {
      args.logger.debug?.(args.timedOutMessage);
    }
  } catch (error) {
    // Diagnostics must not be the reason a boot fails.
    args.logger.debug?.(
      `${args.failedMessagePrefix}${
        error instanceof Error ? error.message : String(error)
      }`
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
}
