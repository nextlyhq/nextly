/**
 * The redirect a moved page leaves behind: from each address it let go of
 * to the address it holds now in the same language. One rule for a save,
 * which leaves it in the save's own transaction, and for a deploy's move,
 * which the catch-up at start leaves after the route has already moved.
 *
 * @module redirects/moves
 */
import {
  languageAddressOf,
  type AddressHolder,
  type HeldAddress,
  type PluginContext,
} from "@nextlyhq/plugin-sdk";

import { recordNotFound } from "../not-found/log";

import { putRedirect, type RedirectInput } from "./store";

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
async function listBroken(ctx: PluginContext, old: HeldAddress): Promise<void> {
  const served = await languageAddressOf(old.path, old.locale);
  await recordNotFound(
    ctx,
    served.status === "resolved" ? served.path : old.path,
    "moved"
  );
}

/**
 * Leave a redirect from each address `page` let go of in a deploy's move,
 * each on a transaction of its own, once every page's claim stands: an old
 * address another page now holds is then refused, so it is never used as a
 * step towards a third page. None goes to an address the page lost to the
 * page already holding it (`lost`). The route has already moved, so a
 * redirect that cannot be saved does not keep the old address; the old
 * address is listed as a broken link instead. A refusal because another
 * page serves the old address, or because it would loop, leaves none.
 */
export async function redirectDeployMove(
  ctx: PluginContext,
  page: { holder: AddressHolder; holds: readonly HeldAddress[] },
  released: readonly HeldAddress[],
  lost: readonly HeldAddress[]
): Promise<void> {
  const kept = page.holds.filter(
    held =>
      !lost.some(
        gone =>
          gone.locale === held.locale &&
          gone.path === held.path &&
          (gone.range === true) === (held.range === true)
      )
  );
  for (const old of released) {
    const input = movedRedirect(old, kept);
    if (input === undefined) continue;
    let outcome: Awaited<ReturnType<typeof putRedirect>>;
    try {
      outcome = await ctx.services.collections.withTransaction(transaction =>
        putRedirect(ctx, transaction, input)
      );
    } catch (error) {
      ctx.logger.warn("A moved page's old address could not be redirected", {
        old,
        page: page.holder,
        error,
      });
      await listBroken(ctx, old);
      continue;
    }
    if ("refused" in outcome && outcome.reason === "invalid") {
      await listBroken(ctx, old);
    }
  }
}
