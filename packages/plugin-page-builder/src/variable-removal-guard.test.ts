/**
 * The site-style Single's guards over its variables: a write that drops a
 * variable the site added is judged by the remove route's in-use check, and
 * every other write to the tokens section passes without asking it; a write
 * whose shared styles add a reference to a variable the site will not define
 * is refused, as a page adding one is.
 */
import { NextlyError } from "nextly/errors";
import { describe, expect, it, vi } from "vitest";

import type { SiteStyleData } from "./site-style";
import {
  VARIABLE_REMOVE_WRITE_CONTEXT,
  droppedVariables,
  siteStyleSingle,
  suppliedVariableIds,
  type VariablesInUseCheck,
} from "./site-style-storage";

const brand = {
  name: "color.brand",
  label: "Brand",
  kind: "color",
  values: { light: "#123456" },
};
const accent = {
  id: "t-accent",
  name: "color.accent",
  kind: "color",
  values: { light: "#654321" },
};
const author = { id: "user-1" };
const card = {
  id: "c-card",
  slug: "card",
  orderIndex: 0,
  styles: { base: { base: { color: { $token: "t-accent" } } } },
};

/** The code tier: one variable of its own, and one shared style. */
const DEFAULTS: SiteStyleData = {
  tokens: {
    tokens: [
      { name: "color.code", kind: "color", values: { light: "#000000" } },
    ],
  },
  classes: [
    {
      id: "c-code",
      slug: "code",
      orderIndex: 0,
      styles: { base: { base: { color: "#000" } } },
    },
  ],
};

type Hook = {
  data?: Record<string, unknown>;
  originalData?: Record<string, unknown>;
  user?: { id: string };
  context?: Record<string, unknown>;
};

/** Run the Single's own before-validate hooks, as a write would. */
async function written(
  hook: Hook,
  check: VariablesInUseCheck | undefined
): Promise<unknown> {
  const hooks =
    siteStyleSingle({ defaults: DEFAULTS }, undefined, () => check).hooks
      ?.beforeValidate ?? [];
  try {
    for (const run of hooks) await run(hook as never);
  } catch (error) {
    return error;
  }
  return undefined;
}

const stored = (...tokens: unknown[]) => ({ tokens: { tokens } });

describe("a write that drops a variable", () => {
  it("is judged by the in-use check, with the shared styles as merged after it", async () => {
    const check = vi.fn<VariablesInUseCheck>(async () => undefined);

    await written(
      {
        data: { tokens: { tokens: [brand] } },
        originalData: { ...stored(brand, accent), classes: [card] },
        user: author,
        context: {},
      },
      check
    );

    expect(check).toHaveBeenCalledTimes(1);
    const [removable, classes] = check.mock.calls[0] ?? [];
    expect(removable).toEqual([{ id: "t-accent", name: "Accent" }]);
    // The code's shared styles and the stored one, as the compiler merges.
    expect((classes ?? []).map(entry => (entry as { id: string }).id)).toEqual([
      "c-code",
      "c-card",
    ]);
  });

  it("is refused with the check's own refusal", async () => {
    const inUse = NextlyError.validation({
      errors: [{ path: "tokens", code: "IN_USE", message: "Used." }],
    });
    const error = await written(
      {
        data: { tokens: { tokens: [] } },
        originalData: stored(brand),
        user: author,
        context: {},
      },
      async () => {
        throw inUse;
      }
    );

    expect(error).toBe(inUse);
  });

  it("judges the shared styles the same write stores beside the tokens", async () => {
    const check = vi.fn<VariablesInUseCheck>(async () => undefined);

    await written(
      {
        data: { tokens: { tokens: [] }, classes: [] },
        originalData: { ...stored(accent), classes: [card] },
        user: author,
        context: {},
      },
      check
    );

    const classes = check.mock.calls[0]?.[1] ?? [];
    expect(classes.map(entry => (entry as { id: string }).id)).toEqual([
      "c-code",
    ]);
  });
});

describe("a write the check is not asked about", () => {
  const cases: [string, Hook][] = [
    [
      "edits values and labels only",
      {
        data: {
          tokens: {
            tokens: [
              { ...brand, label: "Brand colour", values: { light: "#000" } },
              accent,
            ],
          },
        },
        originalData: stored(brand, accent),
        user: author,
        context: {},
      },
    ],
    [
      "adds a variable",
      {
        data: { tokens: { tokens: [brand, accent] } },
        originalData: stored(brand),
        user: author,
        context: {},
      },
    ],
    [
      "drops the stored override of a variable the code supplies (a reset)",
      {
        data: { tokens: { tokens: [brand] } },
        originalData: stored(brand, {
          name: "color.code",
          kind: "color",
          values: { light: "#ffffff" },
        }),
        user: author,
        context: {},
      },
    ],
    [
      "is the remove route's own write, which has just made the check",
      {
        data: { tokens: { tokens: [] } },
        originalData: stored(brand),
        user: author,
        context: { ...VARIABLE_REMOVE_WRITE_CONTEXT },
      },
    ],
    [
      "is made by server code acting as nobody",
      {
        data: { tokens: { tokens: [] } },
        originalData: stored(brand),
        context: {},
      },
    ],
    [
      "does not write the tokens at all",
      {
        data: { classes: [] },
        originalData: stored(brand),
        user: author,
        context: {},
      },
    ],
  ];

  for (const [what, hook] of cases) {
    it(`passes a write that ${what}`, async () => {
      const check = vi.fn<VariablesInUseCheck>(async () => undefined);
      expect(await written(hook, check)).toBeUndefined();
      expect(check).not.toHaveBeenCalled();
    });
  }
});

describe("which stored variables a write drops", () => {
  it("compares identities, an id over a name, and reads a section stored as text", () => {
    const renamed = { ...accent, name: "color.highlight" };
    expect(
      droppedVariables(
        JSON.stringify(stored(brand, accent).tokens),
        { tokens: [renamed] },
        suppliedVariableIds(DEFAULTS)
      )
    ).toEqual([{ id: "color.brand", name: "Brand" }]);
  });

  it("counts the engine's own variables as supplied, beside the code's", () => {
    const supplied = suppliedVariableIds(DEFAULTS);
    expect([supplied.has("color.code"), supplied.has("color.primary")]).toEqual(
      [true, true]
    );
    expect(supplied.has("color.brand")).toBe(false);
  });
});

describe("a write whose shared styles name variables", () => {
  /** A stored shared style whose own styles name `token`. */
  const naming = (id: string, token: string) => ({
    id,
    slug: id.replace(/^c-/, ""),
    orderIndex: 0,
    styles: { base: { base: { color: { $token: token } } } },
  });
  const check = async () => undefined;

  it("refuses a reference it adds to a variable the site does not define", async () => {
    const refused = await written(
      {
        user: author,
        data: {
          classes: [naming("c-card", "t-accent"), naming("c-x", "t-gone")],
        },
        originalData: {
          ...stored(accent),
          classes: [naming("c-card", "t-accent")],
        },
      },
      check
    );
    expect(refused).toBeInstanceOf(NextlyError);
    expect(refused).toMatchObject({
      code: "VALIDATION_ERROR",
      publicData: {
        errors: [
          {
            path: "classes",
            code: "unknown-token",
            message:
              'Shared styles: "t-gone" is not a variable on this site. Remove it from the shared style, or choose a variable the site has.',
          },
        ],
      },
    });
  });

  it("passes references to variables every tier defines, the code's and the engine's included", async () => {
    expect(
      await written(
        {
          user: author,
          data: {
            classes: [
              naming("c-card", "t-accent"),
              naming("c-code", "color.code"),
              naming("c-engine", "color.primary"),
            ],
          },
          originalData: { ...stored(accent), classes: [] },
        },
        check
      )
    ).toBeUndefined();
  });

  it("passes a reference to a variable the same write adds, and refuses one it removes", async () => {
    expect(
      await written(
        {
          user: author,
          data: {
            ...stored(accent, brand),
            classes: [naming("c-card", "color.brand")],
          },
          originalData: { ...stored(accent), classes: [] },
        },
        check
      )
    ).toBeUndefined();
    // The control: the tokens this write leaves are what it is judged by.
    expect(
      await written(
        {
          user: author,
          data: { ...stored(), classes: [naming("c-card", "t-accent")] },
          originalData: { ...stored(accent), classes: [] },
        },
        check
      )
    ).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("keeps a reference the stored shared styles already held, though the site no longer defines it", async () => {
    expect(
      await written(
        {
          user: author,
          data: {
            classes: [{ ...naming("c-card", "t-gone"), label: "Renamed" }],
          },
          originalData: {
            ...stored(accent),
            classes: [naming("c-card", "t-gone")],
          },
        },
        check
      )
    ).toBeUndefined();
  });

  it("does not judge server code acting as nobody, nor the remove route's own write", async () => {
    const adding = {
      data: { classes: [naming("c-x", "t-gone")] },
      originalData: { ...stored(accent), classes: [] },
    };
    expect(await written(adding, check)).toBeUndefined();
    expect(
      await written(
        {
          ...adding,
          user: author,
          context: { ...VARIABLE_REMOVE_WRITE_CONTEXT },
        },
        check
      )
    ).toBeUndefined();
  });
});
