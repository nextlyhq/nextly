/**
 * The body a publish or unpublish of a document's chosen parts is sent with, a collection entry's
 * and a Single's alike, so the two doors read one request.
 *
 * @module dispatcher/handlers/publish-parts-body
 */
import { z } from "zod";

/**
 * The body of a publish or unpublish of a document's chosen parts, a collection entry's or a
 * Single's: the languages, or `"all"`, whether the shared part is chosen too, whether to only say
 * what it would do, and, for a publish made without review, why. The version fields (`_rev`,
 * `_overwrite`) are read beside it, as for every lifecycle move.
 */
export const PublishPartsBody = z
  .object({
    locales: z.union([
      z.literal("all"),
      z.array(z.string().min(1).max(64)).max(500),
    ]),
    shared: z.boolean().optional(),
    describe: z.boolean().optional(),
    withoutReview: z
      .object({ reason: z.string().trim().min(1).max(2000) })
      .strict()
      .optional(),
  })
  .passthrough();
