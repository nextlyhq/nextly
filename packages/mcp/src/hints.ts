/**
 * A tool's four hints, set from its operation's risk level and effects.
 *
 * Clients act on these without asking: ChatGPT and Codex run a tool marked
 * read-only with no confirmation, so a wrong read-only hint is a security
 * bug, not a cosmetic one. Every hint is therefore set explicitly, never left
 * to the protocol's defaults (which assume the worst for some and the best for
 * none).
 *
 * @module hints
 * @experimental
 */
import type { AgentOperation } from "./operation";

/** The four hints, every one stated. */
export interface ToolHints {
  readonly readOnlyHint: boolean;
  readonly destructiveHint: boolean;
  readonly idempotentHint: boolean;
  readonly openWorldHint: boolean;
}

/**
 * The hints for `operation`:
 *
 * - read-only only when its level is `read` and it destroys nothing, so a
 *   mislabelled read that removes data is still not run unasked;
 * - destructive when it removes or overwrites data that exists;
 * - idempotent when it is read-only (reading twice changes nothing) or says
 *   running it twice changes nothing more;
 * - open-world when it reaches outside the site (email, webhooks, outside
 *   addresses).
 */
export function hintsFor(
  operation: Pick<AgentOperation, "level" | "effects">
): ToolHints {
  const readOnly = operation.level === "read" && !operation.effects.destroys;
  return {
    readOnlyHint: readOnly,
    destructiveHint: operation.effects.destroys,
    idempotentHint: readOnly || operation.effects.idempotent,
    openWorldHint: operation.effects.outside,
  };
}
