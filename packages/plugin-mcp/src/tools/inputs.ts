/**
 * The shapes the review tools take, as the protocol advertises them to an agent.
 *
 * Every object is strict: a key the tool does not name is refused rather than dropped, so an
 * argument such as `overrideAccess` or `withoutReview` is an error the agent sees, never one it
 * believes was honoured. These are the protocol's boundary; `ctx.services.workflows` parses what
 * it is handed again, strictly and with core's own bounds, so a value these let through is still
 * refused there.
 *
 * @module tools/inputs
 */
import { z } from "zod";

/** A document, as the review tools name it: an entry of a collection, or a Single. */
export const DocumentRef = z
  .union([
    z
      .object({
        collection: z.string().min(1).describe("The collection's slug"),
        id: z.string().min(1).describe("The entry's id"),
      })
      .strict(),
    z
      .object({ single: z.string().min(1).describe("The Single's slug") })
      .strict(),
  ])
  .describe(
    "The document: `{ collection, id }` for an entry, `{ single }` for a Single"
  );

/** A part of a document: a language's code, or null for the part every language shares. */
export const Part = z
  .string()
  .min(1)
  .nullable()
  .describe("A language code, or null for the part every language shares");

/** A part as the caller saw it, read from `get_review_state`. */
export const SeenPart = z
  .object({
    part: Part,
    revision: z
      .number()
      .int()
      .min(0)
      .describe("The part's `revision`, as `get_review_state` told it"),
    version: z
      .string()
      .min(1)
      .describe("The part's `version`, as `get_review_state` told it"),
  })
  .strict();
