/**
 * Phase 5 (2026-05-01) — stdout capture shim for drizzle-kit pushSchema.
 *
 * What this is for: drizzle-kit's pushSchema sometimes writes to
 * process.stdout / process.stderr during introspection (status lines,
 * partial-schema warnings, etc.). Those lines leak into the dev
 * server's console alongside Nextly's own logs, creating noise that's
 * hard to attribute. This helper captures any writes drizzle-kit
 * makes during a single pushSchema invocation and reroutes them to
 * `logger.debug`, so they only surface when the operator opts into
 * verbose logging.
 *
 * Scope caveat: we use drizzle-kit's synchronous return path
 * (`pushSchema(...)` resolves to `{ statementsToExecute, ... }`) and
 * execute the statements ourselves via DrizzleStatementExecutor. We do
 * NOT use drizzle-kit's `apply()` auto-execute. Most of drizzle-kit's
 * verbose logging happens inside `apply()`, so this shim's catch is
 * limited — but the cost of adding it is minimal and it cleans up the
 * cases where introspection itself emits status lines. If a future
 * drizzle-kit release becomes chattier on the synchronous path, this
 * shim absorbs that without code changes here.
 *
 * Implementation notes:
 *   - Monkey-patches process.stdout.write and process.stderr.write
 *     for the duration of `work()`, restores them in a finally so a
 *     thrown error doesn't leak the patches.
 *   - Coalesces writes by stream — debug-line per coalesced chunk so
 *     consumers don't get spammed by drizzle-kit's per-character
 *     emission (some terminal libraries do this).
 *   - No process-wide state outside the invocation. Re-entrant calls
 *     work as long as both invocations don't overlap (they shouldn't —
 *     the pipeline is per-request).
 */

interface StdoutCaptureLogger {
  debug?: (msg: string) => void;
}

/**
 * Runs `work` with process.stdout / process.stderr captured. Captured
 * writes are coalesced and forwarded to `logger.debug` so they only
 * appear when verbose logging is enabled.
 *
 * Returns whatever `work` returns. If `work` throws, restores the
 * stream methods before re-throwing.
 */
export async function withCapturedStdout<T>(
  work: () => Promise<T>,
  logger: StdoutCaptureLogger | undefined
): Promise<T> {
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  // Buffer per-stream so we can flush a single debug line per stream
  // when work() finishes. drizzle-kit's emission patterns don't really
  // matter — coalescing keeps log volume manageable regardless.
  let stdoutBuffer = "";
  let stderrBuffer = "";

  // Cast to `any` because process.stdout.write has multiple overloads
  // (string + encoding, Uint8Array, etc.) and recreating the full
  // signature is needlessly verbose. Behavior parity with the original
  // is what matters; we just buffer the input.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stdout as any).write = ((chunk: unknown): boolean => {
    stdoutBuffer += String(chunk);
    return true;
  }) as typeof process.stdout.write;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stderr as any).write = ((chunk: unknown): boolean => {
    stderrBuffer += String(chunk);
    return true;
  }) as typeof process.stderr.write;

  try {
    const result = await work();
    flushBufferedToDebug("[drizzle-kit stdout]", stdoutBuffer, logger);
    flushBufferedToDebug("[drizzle-kit stderr]", stderrBuffer, logger);
    return result;
  } finally {
    // Restore originals even on throw — leaving the patches in place
    // would silently swallow every subsequent log line in the process.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stdout as any).write = originalStdoutWrite;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (process.stderr as any).write = originalStderrWrite;
  }
}

function flushBufferedToDebug(
  prefix: string,
  buffer: string,
  logger: StdoutCaptureLogger | undefined
): void {
  if (!buffer) return;
  // Trim trailing newlines that drizzle-kit emits at end of its
  // output — pure stylistic; debug consumers don't need the noise.
  const trimmed = buffer.replace(/\n+$/, "");
  if (!trimmed) return;
  if (logger?.debug) {
    logger.debug(`${prefix} ${trimmed}`);
  }
  // Without a debug logger, captured output is silently dropped.
  // That's fine — the whole point of capture is to keep stdout clean
  // in normal operation. Operators wanting to see drizzle-kit's
  // chatter wire a logger or set DEBUG_SCHEMA=1 (consumer's choice).
}
