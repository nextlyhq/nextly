/**
 * The problem list as one person on the dashboard may read it: what the SEO
 * card draws and its Needs attention lines count, read from the same kept
 * rows, by the same reader, as the list's own route answers.
 *
 * A card's `load` is handed the person and reads bound to them, not a
 * route's caller: which entries they may read is asked through those reads,
 * and which types they may read is core's published answer for that person
 * (`readableContent`). Whether they hold site-wide SEO is a permission only
 * a route's caller can be asked, so the card is read as someone who does
 * not: redirect chains, which the list names only to that permission, are
 * left out of the card and kept on the list.
 *
 * @module problems/card-source
 */
import {
  NextlyError,
  readableContent,
  type AttentionItem,
} from "@nextlyhq/plugin-sdk";

import { keptSeoContext } from "../not-found/report";

import { problemList, type ProblemChecks } from "./check";
import type { Problem } from "./contract";
import { singleKey } from "./page-types";
import { inChunks, readerAs } from "./reader";

/** What a card's `load` and a Needs attention line's `count` are handed. */
type CardInput = Parameters<AttentionItem["count"]>[0];

/** The person a card or a Needs attention line is answered for. */
type CardReader = CardInput["user"];

/** The problem list as the person a card is answered for may read it. */
export type ProblemsFor = (
  input: Pick<CardInput, "user" | "services">
) => Promise<readonly Problem[]>;

/**
 * Rows one widget read answers at most: core clamps every read a card
 * makes to fifty, so a piece asked for in one read is no larger.
 */
const WIDGET_READ = 50;

/**
 * The types of `checks` that `user` may read, by the key their pages are
 * kept under, as core decides it for that person.
 */
async function readableBy(
  user: CardReader,
  checks: ProblemChecks
): Promise<Set<string>> {
  const { entities } = await readableContent({
    user: {
      id: user.id,
      ...(user.roles === undefined ? {} : { roles: user.roles }),
    },
  });
  const collections = new Set(checks.targets);
  const singles = new Set(checks.singles);
  const readable = new Set<string>();
  for (const { slug, kind } of entities) {
    if (kind === "collection" && collections.has(slug)) readable.add(slug);
    if (kind === "single" && singles.has(slug)) readable.add(singleKey(slug));
  }
  return readable;
}

/** The list's problems as each person on the dashboard may read them. */
export function problemsForCard(checks: ProblemChecks): ProblemsFor {
  return async ({ user, services }) => {
    const ctx = keptSeoContext();
    if (ctx === undefined) {
      throw NextlyError.internal({
        logContext: { reason: "seo-card-before-plugin-start" },
      });
    }
    const reader = readerAs(
      {
        readable: (type, ids) =>
          inChunks(ids, WIDGET_READ, async chunk => {
            const { items } = await services.find(type, {
              where: { id: { in: chunk } },
              select: ["id"],
              limit: chunk.length,
              depth: 0,
            });
            return items.flatMap(({ id }) =>
              typeof id === "string" || typeof id === "number"
                ? [String(id)]
                : []
            );
          }),
        count: type => services.count(type),
      },
      await readableBy(user, checks),
      false
    );
    return (await problemList(ctx, checks, reader)).problems;
  };
}
