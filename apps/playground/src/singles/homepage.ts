/**
 * Homepage single — proves the `blocks` field mounts inside a Single exactly as
 * it does inside a collection. The host single form persists the `layout`
 * document.
 *
 * It used to declare the page builder's own field, which stored that plugin's
 * private document shape. That shape and the engine's `BlockDocument` were not
 * interchangeable — a synthetic root against a flat node array, among other
 * disagreements — so a single authored through it could not be read by the
 * renderer everything else draws with.
 */
import { blocks } from "@nextlyhq/plugin-page-builder";
import { defineSingle, text } from "nextly/config";

export const Homepage = defineSingle({
  slug: "homepage",
  label: { singular: "Homepage" },
  // `/` draws this single for every visitor, signed in or not. A signed-out
  // visitor is judged by the built-in Public role, which boot grants read only
  // where the rule answers exactly `true`; without it `/` is refused and
  // renders no page. Nothing unpublished is exposed: the single keeps no draft
  // status, and `versions.drafts` below records recovery points only.
  access: { read: () => true },
  // Recovery points are opt-in per entity and the server enforces it, so
  // without this every autosave against this single is correctly refused —
  // which is what exercises the page builder's own recording here.
  versions: { drafts: true },
  fields: [
    text({ name: "title" }),
    blocks({ name: "layout", label: "Layout", blocks: { allow: ["core/*"] } }),
  ],
});
