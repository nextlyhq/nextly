/**
 * The site-style Single's guard over its shared styles: a locked one holds
 * for everyone, a lock moves only through the lock route, and an entry leaves
 * only through the remove route, which checks first that nothing uses it.
 * While a breakpoint removal is open, the settings write may bring a locked
 * style back stripped of exactly the removed breakpoints' values.
 */
import { describe, expect, it } from "vitest";

import type { Removal } from "./breakpoint-removal/strip";
import {
  refuseSharedStyleChangesOutsideTheirRoutes,
  SHARED_STYLE_LOCK_WRITE_CONTEXT,
  SITE_SETTINGS_WRITE_CONTEXT,
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

  it("refuses its removal, even through the lock route's mark", () => {
    expect(
      refused({
        data: { classes: [hero] },
        originalData: { classes: [lockedCard, hero] },
        user: author,
        context: { ...SHARED_STYLE_LOCK_WRITE_CONTEXT },
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
  it("passes for an unlocked style, as an undo of making one writes", () => {
    // Undo writes the section back as it was, which removes the style made.
    expect(
      refused({
        data: { classes: [hero] },
        originalData: { classes: [card, hero] },
        user: author,
        context: {},
      })
    ).toBeUndefined();
    expect(
      refused({
        data: { classes: [] },
        originalData: { classes: [card] },
        principal: { type: "principal", kind: "member", id: "m-1" },
        context: {},
      })
    ).toBeUndefined();
  });

  it("is refused for a locked style, however it is written", () => {
    expect(
      refused({
        data: { classes: [hero] },
        originalData: { classes: [lockedCard, hero] },
        user: author,
        context: {},
      })
    ).toMatchObject({ code: "CONFLICT" });
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

/** Every hook the Single runs before validation, in order, on one write. */
async function wiredRefusal(
  hook: Hook,
  openRemoval?: () => Promise<Removal | null>,
  /** The code's classes the Single is configured with. */
  classes?: readonly (typeof lockedCard)[]
): Promise<unknown> {
  const policy = classes === undefined ? {} : { defaults: { classes } };
  const hooks =
    siteStyleSingle(policy, openRemoval).hooks?.beforeValidate ?? [];
  try {
    for (const run of hooks) await run(hook as never);
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("the Single's wiring", () => {
  it("runs the guard before validation, beside the breakpoints' door", async () => {
    const error = await wiredRefusal({
      data: {
        classes: [
          { ...lockedCard, styles: { base: { base: { color: "#ff0000" } } } },
        ],
      },
      originalData: { classes: [lockedCard] },
      user: author,
      context: {},
    });
    expect(error).toMatchObject({ code: "CONFLICT" });
  });
});

describe("a locked shared style while a breakpoint removal is open", () => {
  /** A locked style holding a value at Mobile beside its base one. */
  const lockedAtMobile = {
    ...lockedCard,
    styles: {
      base: { base: { color: "#111111" }, mobile: { color: "#222222" } },
      hover: { mobile: { color: "#333333" } },
    },
  };
  /** The same style as removing Mobile strips it. */
  const stripped = {
    ...lockedCard,
    styles: { base: { base: { color: "#111111" } } },
  };
  const removingMobile: Removal = {
    ids: new Set(["mobile"]),
    before: {
      viewport: [{ id: "mobile", label: "Mobile", maxWidth: 600 }],
      container: [],
    },
  };
  const open = async (): Promise<Removal | null> => removingMobile;
  const settingsWrite = (
    now: unknown,
    context = SITE_SETTINGS_WRITE_CONTEXT
  ) => ({
    data: { classes: [now] },
    originalData: { classes: [lockedAtMobile] },
    user: author,
    context: { ...context },
  });

  it("accepts the settings write bringing it back exactly stripped", async () => {
    expect(await wiredRefusal(settingsWrite(stripped), open)).toBeUndefined();
  });

  it("refuses the strip with anything else changed", async () => {
    const more = {
      ...stripped,
      styles: { base: { base: { color: "#ff0000" } } },
    };
    expect(await wiredRefusal(settingsWrite(more), open)).toMatchObject({
      code: "CONFLICT",
    });
  });

  it("refuses the strip with no removal open", async () => {
    expect(
      await wiredRefusal(settingsWrite(stripped), async () => null)
    ).toMatchObject({ code: "CONFLICT" });
  });

  it("refuses the strip when the open removal cannot be read", async () => {
    const unreadable = async (): Promise<Removal | null> => {
      throw new Error("the table cannot be read");
    };
    expect(
      await wiredRefusal(settingsWrite(stripped), unreadable)
    ).toMatchObject({ code: "CONFLICT" });
  });

  it("refuses the strip from any write but the settings one", async () => {
    expect(await wiredRefusal(settingsWrite(stripped, {}), open)).toMatchObject(
      { code: "CONFLICT" }
    );
  });
  describe("supplied by the code, not stored", () => {
    // A refusal here is the guard's for a style written already locked: a
    // lock moved outside its route.
    /** The settings write storing the code's class as its stripped override. */
    const overriding = (now: unknown) => ({
      data: { classes: [now] },
      originalData: { classes: [] },
      user: author,
      context: { ...SITE_SETTINGS_WRITE_CONTEXT },
    });

    it("accepts the override that is exactly the code's style stripped", async () => {
      expect(
        await wiredRefusal(overriding(stripped), open, [lockedAtMobile])
      ).toBeUndefined();
    });

    it("refuses an override with anything else changed", async () => {
      const more = {
        ...stripped,
        styles: { base: { base: { color: "#ff0000" } } },
      };
      expect(
        await wiredRefusal(overriding(more), open, [lockedAtMobile])
      ).toMatchObject({ code: "VALIDATION_ERROR" });
    });

    it("refuses the override with no removal open, or for a style the code does not supply", async () => {
      expect(
        await wiredRefusal(overriding(stripped), async () => null, [
          lockedAtMobile,
        ])
      ).toMatchObject({ code: "VALIDATION_ERROR" });
      expect(await wiredRefusal(overriding(stripped), open, [])).toMatchObject({
        code: "VALIDATION_ERROR",
      });
    });
  });
});
