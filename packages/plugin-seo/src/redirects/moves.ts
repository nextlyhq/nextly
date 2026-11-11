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

import { putRedirect, removeRedirect, type RedirectInput } from "./store";

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

/** A redirect a catch-up left, to take back if its page loses the address. */
export interface DeployRedirect {
  id: string;
  holder: AddressHolder;
  locale: string;
  to: string;
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
 * Leave a redirect from each address `page` let go of in a deploy's move, each
 * on a transaction of its own after the release: the route has already
 * moved, so a redirect that cannot be saved does not keep the old address,
 * and the old address is listed as a broken link instead. A refusal because
 * another page serves the old address, or because the redirect would loop (as
 * two pages swapping addresses do, part-way through), leaves none. Each one
 * left is added to `made`.
 */
export async function redirectDeployMove(
  ctx: PluginContext,
  page: { holder: AddressHolder; holds: readonly HeldAddress[] },
  released: readonly HeldAddress[],
  made: DeployRedirect[]
): Promise<void> {
  for (const old of released) {
    const input = movedRedirect(old, page.holds);
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
    if ("saved" in outcome) {
      made.push({
        id: outcome.saved.id,
        holder: page.holder,
        locale: old.locale,
        to: input.target,
      });
    } else if (outcome.reason === "invalid") {
      await listBroken(ctx, old);
    }
  }
}

/**
 * Take back the redirects a catch-up left to an address its page then lost to
 * another: a page left without an address gets no redirect to it.
 */
export async function takeBackLost(
  ctx: PluginContext,
  made: readonly DeployRedirect[],
  lost: readonly { holder: AddressHolder; address: HeldAddress }[]
): Promise<void> {
  for (const each of lost) {
    const target =
      each.address.range === true
        ? `${each.address.path === "/" ? "" : each.address.path}/*`
        : each.address.path;
    for (const left of made) {
      if (
        left.holder.collection !== each.holder.collection ||
        left.holder.id !== each.holder.id ||
        left.locale !== each.address.locale ||
        left.to !== target
      ) {
        continue;
      }
      try {
        await ctx.services.collections.withTransaction(transaction =>
          removeRedirect(ctx, transaction, left.id)
        );
      } catch (error) {
        ctx.logger.warn(
          "A redirect to a lost address could not be taken back",
          {
            redirect: left.id,
            error,
          }
        );
      }
    }
  }
}
