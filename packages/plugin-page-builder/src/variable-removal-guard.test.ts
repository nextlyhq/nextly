/**
 * The site-style Single's guard over its variables: a write that drops a
 * variable the site added is judged by the remove route's in-use check, and
 * every other write to the tokens section passes without asking it.
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
