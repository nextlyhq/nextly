/**
 * The site-style Single's guard over its shared styles: a locked one holds
 * for everyone, a lock moves only through the lock route, and an entry leaves
 * only through the remove route, which checks first that nothing uses it.
 */
import { describe, expect, it } from "vitest";

import {
  refuseSharedStyleChangesOutsideTheirRoutes,
  SHARED_STYLE_LOCK_WRITE_CONTEXT,
  SHARED_STYLE_REMOVE_WRITE_CONTEXT,
  siteStyleSingle,
} from "./site-style-storage";

const card = {
  id: "c-card",
  slug: "card",
  label: "Card",
  orderIndex: 0,
  styles: { base: { base: { color: "#111111" } } },
};
const hero = {
  id: "c-hero",
  slug: "hero",
  orderIndex: 1,
  styles: { base: { base: { padding: "24px" } } },
};
const lockedCard = { ...card, locked: true as const };
const author = { id: "user-1" };

type Hook = Parameters<typeof refuseSharedStyleChangesOutsideTheirRoutes>[0];

function refused(hook: Hook): unknown {
  try {
    refuseSharedStyleChangesOutsideTheirRoutes(hook);
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("a locked shared style", () => {
  it("refuses a change to its styles", () => {
    const error = refused({
      data: {
        classes: [
          { ...lockedCard, styles: { base: { base: { color: "#ff0000" } } } },
          hero,
        ],
      },
      originalData: { classes: [lockedCard, hero] },
      user: author,
      context: {},
    });
    expect(error).toMatchObject({
      code: "CONFLICT",
      publicMessage:
        "Card is locked, so it can't be changed, renamed or removed. Unlock it first.",
    });
  });

  it("refuses a rename, of its slug or of its name", () => {
    for (const renamed of [
      { ...lockedCard, slug: "promo" },
      { ...lockedCard, label: "Promo" },
    ]) {
      expect(
        refused({
          data: { classes: [renamed, hero] },
          originalData: { classes: [lockedCard, hero] },
          user: author,
          context: {},
        })
      ).toMatchObject({ code: "CONFLICT" });
    }
  });

  it("refuses its removal, even through the remove route", () => {
    expect(
      refused({
        data: { classes: [hero] },
        originalData: { classes: [lockedCard, hero] },
        user: author,
        context: { ...SHARED_STYLE_REMOVE_WRITE_CONTEXT },
      })
    ).toMatchObject({ code: "CONFLICT" });
  });

  it("passes a write that sends it back unchanged, keys in another order", () => {
    const reordered = {
      styles: lockedCard.styles,
      locked: true,
      orderIndex: 0,
      label: "Card",
      slug: "card",
      id: "c-card",
    };
    expect(
      refused({
        data: { classes: [reordered, { ...hero, slug: "hero-2" }] },
        // As SQLite returns a JSON column: text.
        originalData: { classes: JSON.stringify([lockedCard, hero]) },
        user: author,
        context: {},
      })
    ).toBeUndefined();
  });
});

describe("a shared style's lock", () => {
  it("refuses a lock or an unlock written outside the lock route", () => {
    for (const [before, after] of [
      [card, lockedCard],
      [lockedCard, card],
    ] as const) {
      expect(
        refused({
          data: { classes: [after, hero] },
          originalData: { classes: [before, hero] },
          user: author,
          context: {},
        })
      ).toMatchObject({
        code: "VALIDATION_ERROR",
        publicData: {
          errors: [
            {
              path: "classes",
              message:
                "A shared style is locked and unlocked with its own action, which needs the permission to lock shared styles.",
            },
          ],
        },
      });
    }
  });

  it("refuses a new style written already locked", () => {
    expect(
      refused({
        data: {
          classes: [card, hero, { ...lockedCard, id: "c-new", slug: "new" }],
        },
        originalData: { classes: [card, hero] },
        user: author,
        context: {},
      })
    ).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("lets the lock route's own write lock and unlock", () => {
    for (const [before, after] of [
      [card, lockedCard],
      [lockedCard, card],
    ] as const) {
      expect(
        refused({
          data: { classes: [after, hero] },
          originalData: { classes: [before, hero] },
          user: author,
          context: { ...SHARED_STYLE_LOCK_WRITE_CONTEXT },
        })
      ).toBeUndefined();
    }
  });
});

describe("removing a shared style", () => {
  it("is refused outside the remove route", () => {
    expect(
      refused({
        data: { classes: [hero] },
        originalData: { classes: [card, hero] },
        user: author,
        context: {},
      })
    ).toMatchObject({
      code: "VALIDATION_ERROR",
      publicData: {
        errors: [
          {
            path: "classes",
            message:
              "Shared styles are removed with Remove, which first checks that nothing uses them.",
          },
        ],
      },
    });
  });

  it("is refused to a person a plugin signs in, as to a user", () => {
    expect(
      refused({
        data: { classes: [] },
        originalData: { classes: [card] },
        principal: { type: "principal", kind: "member", id: "m-1" },
        context: {},
      })
    ).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("passes through the remove route", () => {
    expect(
      refused({
        data: { classes: [hero] },
        originalData: { classes: [card, hero] },
        user: author,
        context: { ...SHARED_STYLE_REMOVE_WRITE_CONTEXT },
      })
    ).toBeUndefined();
  });
});

describe("writes the guard lets through", () => {
  it("passes a change to an unlocked style, and a new one", () => {
    expect(
      refused({
        data: {
          classes: [
            { ...card, slug: "promo" },
            hero,
            { ...hero, id: "c-new", slug: "new" },
          ],
        },
        originalData: { classes: [card, hero] },
        user: author,
        context: {},
      })
    ).toBeUndefined();
  });

  it("passes a write that does not name the classes", () => {
    expect(
      refused({
        data: { tokens: { tokens: [] } },
        originalData: { classes: [lockedCard] },
        user: author,
        context: {},
      })
    ).toBeUndefined();
  });

  it("trusts server code acting as nobody, as for the breakpoints", () => {
    expect(
      refused({
        data: { classes: [] },
        originalData: { classes: [lockedCard, hero] },
        context: {},
      })
    ).toBeUndefined();
  });
});

describe("the Single's wiring", () => {
  it("runs the guard before validation, beside the breakpoints' door", () => {
    const hooks = siteStyleSingle().hooks?.beforeValidate ?? [];
    expect(hooks).toContain(refuseSharedStyleChangesOutsideTheirRoutes);
  });
});
