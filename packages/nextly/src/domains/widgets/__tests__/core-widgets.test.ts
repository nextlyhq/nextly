/**
 * The core cards' declarations, held against the modules that have to honour
 * them.
 *
 * Deliberately NOT a restatement of the list. Asserting that a card carries the
 * literal written three lines away in `core-widgets.ts` is a test that can only
 * ever agree with itself, and it would go on agreeing while the thing the
 * literal REFERS to was renamed underneath it. What is checked here is each
 * declaration against the module that consumes it.
 */
import { describe, expect, it } from "vitest";

import { parsePermissionSlug } from "../../../plugins/routes/permission-slug";
import { RELEASES_RESOURCE } from "../../releases/services/releases-service";
import { CORE_WIDGETS } from "../core-widgets";
import {
  requiredPermissionSlugs,
  validateWidgetDefinition,
} from "../definition";

function card(id: string) {
  const found = CORE_WIDGETS.find(widget => widget.id === id);
  // Resolved through a lookup that REFUSES rather than through `!`, so a
  // renamed or removed card fails here naming itself, instead of every
  // assertion below reading `undefined` and reporting something unrelated.
  if (!found) throw new Error(`no core widget with id "${id}"`);
  return found;
}

describe("core widget definitions", () => {
  /*
   * Every card goes through the same door a plugin's does. Core's list is a
   * hand-written literal that no caller validates on the way in -- boot calls
   * `registerWidget`, which validates, but a definition that would be REFUSED
   * there fails at boot rather than in a test naming the field.
   */
  it.each(CORE_WIDGETS.map(widget => [widget.id, widget] as const))(
    "%s is a valid definition",
    (_id, widget) => {
      // An assertion function: it THROWS with a named reason and returns
      // nothing, so the absence of a throw is the whole result.
      expect(() => validateWidgetDefinition(widget)).not.toThrow();
    }
  );

  /*
   * 🔴 The load-bearing one. `core/upcoming-releases` is gated by a permission
   * SLUG -- a string this file spells out -- and the gate only works if that
   * string parses to the action and resource `ReleasesService` actually
   * enforces. Two independent renames break it silently and in the dangerous
   * direction: a slug that parses to a resource nothing grants is refused for
   * everyone, and the card simply never appears, which looks exactly like a
   * reader without the permission.
   *
   * Compared against `RELEASES_RESOURCE` rather than against the literal
   * "content-releases", so renaming the resource fails here instead of leaving
   * a card gated on a resource that no longer exists.
   */
  it("gates upcoming releases on the resource the releases service enforces", () => {
    const slugs = requiredPermissionSlugs(
      card("core/upcoming-releases").requiredPermission
    );

    // Read through the gate's own reader, so a declaration this test approves
    // is one the gate can actually use.
    expect(slugs).toBeDefined();
    expect((slugs ?? []).map(parsePermissionSlug)).toEqual([
      { action: "read", resource: RELEASES_RESOURCE },
      { action: "create", resource: RELEASES_RESOURCE },
      { action: "publish", resource: RELEASES_RESOURCE },
    ]);
  });

  /*
   * 🔴 The authorities, held against the RULE rather than against a list.
   * `ReleasesService.authorize` returns early for `create` or `publish` when the
   * authority asked for is `read`, so those two are what the card must also
   * admit. Asserted by exercising that implication -- a card gated on read alone
   * would satisfy the test above and still hide from a create-only editor, which
   * is precisely the defect this replaced.
   */
  it("admits every authority the service treats as satisfying read", () => {
    const slugs = new Set(
      requiredPermissionSlugs(card("core/upcoming-releases").requiredPermission)
    );

    for (const action of ["read", "create", "publish"]) {
      expect(
        slugs.has(`${action}-${RELEASES_RESOURCE}`),
        `a role holding only ${action}-${RELEASES_RESOURCE} can read releases, so the card must admit it`
      ).toBe(true);
    }
  });

  /*
   * The other cards' lack of a gate is a decision rather than an omission -- see
   * the module docblock -- so it is asserted, not assumed. A gate added to one
   * of these hides a card every authenticated admin can see today, which is the
   * behaviour change that docblock exists to prevent.
   */
  it("gates no card that predates the grid", () => {
    const gated = CORE_WIDGETS.filter(
      widget => widget.requiredPermission !== undefined
    ).map(widget => widget.id);

    expect(gated).toEqual(["core/upcoming-releases"]);
  });

  /*
   * 🔴 Asserted in THIS direction only, and the other one is false. Naming a
   * component does not imply declining the grid's frame: `core/quick-create`
   * names one and draws no heading, section or card of its own, so it wants
   * `WidgetCard` around it and correctly omits `chrome`. The first version of
   * this test asserted the converse and failed on that card -- which was the
   * test being wrong, not the card.
   *
   * What does hold is that only a card supplying its own body may decline the
   * frame. An archetype-drawn card with `chrome: "none"` would render its rows
   * bare, with nothing naming what they are.
   */
  it("declines the grid's frame only where the card brings a body", () => {
    for (const widget of CORE_WIDGETS) {
      if (widget.chrome !== "none") continue;
      expect(
        widget.component,
        `${widget.id} declines chrome, so it must draw its own`
      ).toBeDefined();
    }
  });
});
