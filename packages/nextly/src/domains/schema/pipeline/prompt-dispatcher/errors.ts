// Shared error classes for the PromptDispatcher contract.
//
// Lives in its own file so callers (the F3 pipeline orchestrator, F4
// reload-config code-first wiring, F5 UI-first dispatcher) can catch
// these without coupling to a specific dispatcher implementation.

/** How the refusal begins: why the confirmation was not asked. */
const TTY_REQUIRED_LEAD =
  "Schema confirmation needs an answer, and nobody can be asked (no terminal, CI, or --non-interactive).";

/** How the refusal ends: what a command run can do instead. */
const TTY_REQUIRED_ADVICE =
  "Run from an interactive terminal without CI or --non-interactive, or use code-first migration files via `nextly migrate:create`.";

/**
 * Thrown when a prompt is required but nobody can be asked: no terminal, `CI`
 * set, or `--non-interactive`. Carries an actionable message directing users
 * to either run where a person can answer or use code-first migration files
 * via `nextly migrate:create`.
 */
export class TTYRequiredError extends Error {
  constructor(detail: string) {
    super(`${TTY_REQUIRED_LEAD} ${detail} ${TTY_REQUIRED_ADVICE}`);
    this.name = "TTYRequiredError";
  }
}

/**
 * The detail a `TTYRequiredError` message carries, without its lead and its
 * advice: for a caller that words the refusal its own way. A message of any
 * other shape is returned trimmed, as it is.
 */
export function ttyRequiredDetail(message: string): string {
  let detail = message.trim();
  if (detail.startsWith(TTY_REQUIRED_LEAD)) {
    detail = detail.slice(TTY_REQUIRED_LEAD.length);
  }
  if (detail.endsWith(TTY_REQUIRED_ADVICE)) {
    detail = detail.slice(0, -TTY_REQUIRED_ADVICE.length);
  }
  return detail.trim();
}

/**
 * Thrown when the user cancels a prompt mid-flow (e.g., Ctrl+C in clack).
 * The pipeline catches this and reports apply as cancelled-by-user.
 */
export class PromptCancelledError extends Error {
  constructor() {
    super("Schema apply cancelled by user");
    this.name = "PromptCancelledError";
  }
}
