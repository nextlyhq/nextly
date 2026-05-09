// Shared error classes for the PromptDispatcher contract.
//
// Lives in its own file so callers (the F3 pipeline orchestrator, F4
// reload-config code-first wiring, F5 UI-first dispatcher) can catch
// these without coupling to a specific dispatcher implementation.

/**
 * Thrown when a prompt is required but the runtime has no TTY.
 * Carries an actionable message directing users to either run from a
 * real terminal or use code-first migration files via `nextly migrate:create`.
 */
export class TTYRequiredError extends Error {
  constructor(detail: string) {
    super(
      `TTY required for schema confirmation. ${detail} ` +
        "Run from an interactive terminal, or use code-first migration files " +
        "via `nextly migrate:create`."
    );
    this.name = "TTYRequiredError";
  }
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
