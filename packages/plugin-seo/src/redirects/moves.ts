/**
 * The redirect a moved page leaves behind: from each address it let go of
 * to the address it holds now in the same language. One rule for a save,
 * which leaves it in the save's own transaction, and for a deploy's move,
 * which the catch-up at start leaves after the route has already moved.
 *
 * @module redirects/moves
 */
import type {
  AddressHolder,
  HeldAddress,
  ParticipantTransaction,
  PluginContext,
} from "@nextlyhq/plugin-sdk";

import { recordNotFound } from "../not-found/log";

import { putRedirect, type RedirectInput } from "./store";

type Transaction = ParticipantTransaction["transaction"];

/**
 * The redirect a page holding `holds` now leaves from `old`, an address it
 * held before, or none: where it holds nothing in that language now, where
 * it holds the same address, or for a range at the root, which no pattern
 * can name. A range leaves a pattern carrying every address below it across.
 */
export function movedRedirect(
  old: HeldAddress,
  holds: readonly HeldAddress[]
): RedirectInput | undefined {
  const range = old.range === true;
  if (range && old.path === "/") return undefined;
  const now = holds.find(
    held => held.locale === old.locale && (held.range === true) === range
  );
  if (now === undefined || now.path === old.path) return undefined;
  const pattern = (path: string) =>
    range ? `${path === "/" ? "" : path}/*` : path;
  return {
    locale: old.locale,
    source: pattern(old.path),
    target: pattern(now.path),
    permanent: true,
    origin: "automatic",
  };
}

/** List `old` as a broken link: its route moved, and no redirect could be saved. */
function listBroken(ctx: PluginContext, old: HeldAddress): Promise<void> {
  return recordNotFound(ctx, { locale: old.locale, path: old.path }, "moved");
}

/**
 * Leave a redirect from each address `holder` let go of in a deploy's move,
 * to the address it holds now in the same language: read by `heldOn` on the
 * redirect's own transaction once every claim stands, so an address a save
 * gave the page meanwhile is where it goes, an address the page lost to the
 * page already holding it gets none, and an old address another page now
 * holds is refused rather than used as a step to a third page. The route
 * has already moved, so a redirect that cannot be saved does not keep the
 * old address; it is listed as a broken link instead. A refusal because
 * another page serves the old address, or because it would loop, leaves none.
 */
export async function redirectDeployMove(
  ctx: PluginContext,
  holder: AddressHolder,
  released: readonly HeldAddress[],
  heldOn: (transaction: Transaction) => Promise<HeldAddress[]>
): Promise<void> {
  for (const old of released) {
    let outcome: Awaited<ReturnType<typeof putRedirect>> | undefined;
    try {
      outcome = await ctx.services.collections.withTransaction(
        async transaction => {
          const input = movedRedirect(old, await heldOn(transaction));
          return input === undefined
            ? undefined
            : putRedirect(ctx, transaction, input);
        }
      );
    } catch (error) {
      ctx.logger.warn("A moved page's old address could not be redirected", {
        old,
        page: holder,
        error,
      });
      await listBroken(ctx, old);
      continue;
    }
    if (
      outcome !== undefined &&
      "refused" in outcome &&
      outcome.reason === "invalid"
    ) {
      await listBroken(ctx, old);
    }
  }
}
