/**
 * How the review tools act for their caller and answer them, written once for all of them.
 *
 * ## For whom each call is made
 *
 * Every call to `ctx.services.workflows` names the request's own user (`{ as: "user" }`) and the
 * key's scope where the request arrived on one, so the service judges the person or the key and
 * never the plugin: no call is made as the system, and none bypasses the access check. A request
 * with no user is refused before anything is asked.
 *
 * ## What an answer may carry
 *
 * The prose of a result (`content`) is a constant sentence per tool. Review state carries text
 * people wrote: a comment, a stage's label, a title. A model reading a tool result cannot tell an
 * instruction the server wrote from one that arrived inside a value, so nothing stored is ever
 * interpolated into prose: the data travels as `structuredContent`, beside it.
 *
 * ## What a refusal may carry
 *
 * The protocol library catches whatever a tool throws and answers with the thrown message as the
 * result's text. A message from a driver or a bug can carry SQL, a path or a value, so no error
 * leaves a tool by being thrown: a `NextlyError` is answered with its public JSON, which is what
 * the REST routes send and never carries its log context, and anything else with one constant
 * sentence. The original is written to the plugin's log under the id the answer names.
 *
 * @module tools/answer
 */
import { randomUUID } from "node:crypto";

import type { CallToolResult } from "@modelcontextprotocol/server";
import {
  NextlyError,
  type PluginRouteContext,
  type ServiceOpts,
} from "@nextlyhq/plugin-sdk";

/**
 * What the review tools take from the request's context: who is asking, the service they ask
 * through, and where an unexpected failure is logged. Narrower than the route context so that
 * what a tool depends on is stated, and a test can hand it exactly that.
 */
export type ToolCaller = Pick<
  PluginRouteContext,
  "user" | "authenticatedScope" | "logger"
> & {
  services: Pick<PluginRouteContext["services"], "workflows">;
};

/** The sentence an answer carries for a failure that is not a deliberate refusal. */
export const INTERNAL_ERROR_TEXT =
  "The request failed with an internal error. Nothing in this answer came from the error itself; the server's log has the detail.";

/** The sentence an answer carries for a deliberate refusal; the reason is in `structuredContent`. */
export const REFUSED_TEXT =
  "The request was refused. `structuredContent.error` says why, as data: its `code` is the reason, and its `data` names what was refused.";

/** A result carrying `data`, with the tool's own constant sentence as its prose. */
export function answered<T extends object>(
  sentence: string,
  data: T
): CallToolResult {
  return {
    content: [{ type: "text", text: sentence }],
    structuredContent: { ...data },
  };
}

/**
 * A refusal for whatever `error` is: the public JSON of a `NextlyError`, or one constant sentence
 * for anything else, logged with the id the answer names so an operator can find it.
 */
export function refused(caller: ToolCaller, error: unknown): CallToolResult {
  const requestId = randomUUID();
  if (NextlyError.is(error)) {
    return {
      content: [{ type: "text", text: REFUSED_TEXT }],
      structuredContent: { error: error.toResponseJSON(requestId) },
      isError: true,
    };
  }
  caller.logger.error("@nextlyhq/plugin-mcp: a tool failed", {
    requestId,
    error:
      error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : String(error),
  });
  return {
    content: [{ type: "text", text: INTERNAL_ERROR_TEXT }],
    // Core's own internal error, serialised as the REST routes serialise it, so the shape and
    // the generic public message are core's rather than a second copy of them here.
    structuredContent: {
      error: NextlyError.internal().toResponseJSON(requestId),
    },
    isError: true,
  };
}

/**
 * Answers with what `work` returns for the request's caller, or with the refusal for whatever
 * it threw. A request with no user is refused before `work` runs: answering for nobody would
 * be answering with no access check at all.
 */
export async function forCaller(
  caller: ToolCaller,
  work: (opts: ServiceOpts) => Promise<CallToolResult>
): Promise<CallToolResult> {
  try {
    const user = caller.user;
    if (!user) {
      throw NextlyError.authRequired({
        logContext: { reason: "mcp-tool-without-user" },
      });
    }
    return await work({
      as: "user",
      user,
      // A key is judged on its own grants, never its owner's: the scope travels with the user.
      ...(caller.authenticatedScope
        ? { authenticatedScope: caller.authenticatedScope }
        : {}),
    });
  } catch (error) {
    return refused(caller, error);
  }
}
