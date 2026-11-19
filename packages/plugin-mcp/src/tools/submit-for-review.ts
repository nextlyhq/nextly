/**
 * `submit_for_review`: the one tool that writes. It submits parts of a document for review, with
 * a comment the reviewer reads, and does nothing else.
 *
 * Only a step of kind `submit`: the service refuses any other (an approval, a request for
 * changes, a move), and with no step named it takes the submit step out of the parts' stage. A
 * submit approves nothing, so a submitted part is not made publishable by it; a person still
 * reviews it. Each part is named one by one with what the caller saw of it, so a part that moved
 * since is refused as stale rather than moved on a guess. The history names the caller: the
 * person, or the API key by its own id.
 *
 * @module tools/submit-for-review
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { answered, forCaller, type ToolCaller } from "./answer";
import { DocumentRef, Part, SeenPart } from "./inputs";

/** The name an agent calls it by. */
export const SUBMIT_FOR_REVIEW_TOOL = "submit_for_review";

/** The prose of every answer: a constant, so neither the comment nor a label can reach it. */
const ANSWER =
  "The submit was taken. `structuredContent` says which parts moved and to which stage, which were left where they stand, and who was assigned to review them. A submit approves and publishes nothing: a person reviews what you submitted.";

/** Each part named, with what was seen of it and a comment that is more than blanks. */
const INPUT = z
  .object({
    document: DocumentRef,
    parts: z
      .array(Part)
      .min(1)
      .describe("The parts to submit, each named: never every part at once"),
    seen: z
      .array(SeenPart)
      .min(1)
      .describe("Each part as `get_review_state` told it to you"),
    comment: z
      .string()
      .trim()
      .min(1)
      .describe("What the reviewer should know: required"),
    step: z
      .string()
      .min(1)
      .optional()
      .describe(
        "The submit step to take; left out, the one out of the parts' stage"
      ),
  })
  .strict();

/** The step's result, loose: the service's result is the one to read. */
const OUTPUT = z.looseObject({
  step: z.string().describe("The submit step taken"),
  moved: z.array(z.looseObject({})).describe("The parts moved, and where"),
  left: z.array(z.looseObject({})).describe("The parts left where they stand"),
});

/** Register the tool on a server built for one caller. */
export function registerSubmitForReview(
  server: McpServer,
  caller: ToolCaller
): void {
  server.registerTool(
    SUBMIT_FOR_REVIEW_TOOL,
    {
      title: "Submit for review",
      description:
        "Submit parts of a document for review, with a comment for the reviewer. Only a submit: it cannot approve, request changes, publish or move a part any other way. Read the document with `get_review_state` first and pass each part's `revision` and `version` as `seen`; a part that moved since is refused, and you should read it again.",
      inputSchema: INPUT,
      outputSchema: OUTPUT,
      // It writes, it destroys nothing, and a second identical call is not a no-op: it is
      // refused as stale or takes another submit.
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
      },
    },
    input =>
      forCaller(caller, async opts =>
        answered(ANSWER, await caller.services.workflows.submit(input, opts))
      )
  );
}
