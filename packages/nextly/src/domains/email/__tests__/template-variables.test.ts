/**
 * Declared template variables: what a save accepts, what counts as a change
 * to an owner's declarations, and how an owner's presentation reaches a copy.
 */
import { describe, expect, it } from "vitest";

import {
  declarationSubstance,
  pluginDeclarations,
  templateVariablesSchema,
  withOwnerPresentation,
} from "../template-variables";

describe("the declarations a save accepts", () => {
  it("accepts today's declarations as they are", () => {
    const today = [
      { name: "a", description: "One", required: true },
      { name: "b", description: "Two" },
      { name: "c" },
    ];
    expect(templateVariablesSchema.parse(today)).toEqual(today);
  });

  it("accepts a typed declaration, with a list's item fields", () => {
    const typed = [
      {
        name: "order",
        description: "The order",
        type: "object" as const,
        label: "Order",
        fields: [
          { name: "number", type: "text" as const, example: "A-1" },
          {
            name: "lines",
            type: "list" as const,
            fields: [
              { name: "title", type: "text" as const },
              { name: "price", type: "money" as const, example: 12.5 },
            ],
          },
        ],
      },
    ];
    expect(templateVariablesSchema.parse(typed)).toEqual(typed);
  });

  it("accepts no declarations", () => {
    expect(templateVariablesSchema.parse(null)).toBeNull();
  });

  it("drops a key it does not know", () => {
    expect(
      templateVariablesSchema.parse([{ name: "a", colour: "red" }])
    ).toEqual([{ name: "a" }]);
  });

  it.each([
    ["a declaration without a name", [{ description: "No name" }]],
    ["an empty name", [{ name: "  " }]],
    ["a type it does not know", [{ name: "a", type: "colour" }]],
    ["a description that is not text", [{ name: "a", description: 3 }]],
    ["fields on a text variable", [{ name: "a", fields: [{ name: "b" }] }]],
    [
      "a nested field without a name",
      [{ name: "a", type: "list", fields: [{ type: "text" }] }],
    ],
    ["declarations that are not a list", { name: "a" }],
    ["an example that is a bigint", [{ name: "a", example: 10n }]],
    [
      "a cyclic example",
      (() => {
        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;
        return [{ name: "a", example: cyclic }];
      })(),
    ],
  ])("refuses %s", (_, variables) => {
    expect(templateVariablesSchema.safeParse(variables).success).toBe(false);
  });
});

describe("what counts as a change to an owner's declarations", () => {
  it("leaves out a variable's type, label, example and fields", () => {
    expect(
      declarationSubstance([
        {
          name: "a",
          description: "One",
          required: true,
          type: "list",
          label: "A",
          example: ["x"],
          fields: [{ name: "b" }],
        },
      ])
    ).toEqual([{ name: "a", description: "One", required: true }]);
  });

  it("compares anything that is not a list as it is", () => {
    expect(declarationSubstance(null)).toBeNull();
    expect(declarationSubstance(undefined)).toBeNull();
    expect(declarationSubstance("text")).toBe("text");
  });
});

describe("the owner's presentation on a copy", () => {
  const owner = [
    {
      name: "number",
      description: "The order's number",
      type: "text" as const,
      label: "Order number",
      example: "A-1001",
    },
  ];

  it("takes the owner's presentation for a variable the owner declares, and keeps what the site says", () => {
    expect(
      withOwnerPresentation(
        [{ name: "number", description: "Our reference", required: true }],
        owner
      )
    ).toEqual([
      {
        name: "number",
        description: "Our reference",
        required: true,
        type: "text",
        label: "Order number",
        example: "A-1001",
      },
    ]);
  });

  it("leaves a variable the owner does not declare as the site has it", () => {
    const site = [{ name: "extra", description: "Ours", label: "Our own" }];
    expect(withOwnerPresentation(site, owner)).toEqual(site);
  });

  it("keeps the site's presentation where the owner gives none", () => {
    expect(
      withOwnerPresentation(
        [{ name: "number", description: "x", label: "Ours" }],
        [{ name: "number", description: "y" }]
      )
    ).toEqual([{ name: "number", description: "x", label: "Ours" }]);
  });

  it("returns no declarations as none", () => {
    expect(withOwnerPresentation(null, owner)).toBeNull();
  });
});

describe("pluginDeclarations", () => {
  it("keeps valid typed declarations as they are with no problem", () => {
    const valid = [
      {
        name: "user",
        description: "The user",
        type: "object" as const,
        example: { id: "u-1" },
      },
    ];
    expect(pluginDeclarations(valid)).toEqual({
      variables: valid,
      problem: null,
    });
  });

  it("handles null and undefined gracefully", () => {
    expect(pluginDeclarations(null)).toEqual({
      variables: null,
      problem: null,
    });
    expect(pluginDeclarations(undefined)).toEqual({
      variables: null,
      problem: null,
    });
  });

  it("retains substance and reports problem for unparseable presentation", () => {
    const invalid = [
      {
        name: "user",
        description: "The user",
        required: true,
        type: "unknown-type",
      },
    ];
    const result = pluginDeclarations(invalid);
    expect(result.variables).toEqual([
      { name: "user", description: "The user", required: true },
    ]);
    expect(result.problem).toContain("0.type");
  });

  it("drops an entry that declares nothing rather than carrying it to readers", async () => {
    // A null or string entry is not a declaration: kept, it reached the
    // registry's defaults and every reader that dereferences an entry's
    // name (withOwnerPresentation among them) threw on the first row it
    // read — one bad plugin took the whole template list down. Watched
    // failing: the null came back through.
    const { withOwnerPresentation } = await import("../template-variables");
    const result = pluginDeclarations([
      null,
      "total",
      {
        name: "user",
        description: "The user",
      },
    ] as unknown[]);
    expect(result.variables).toEqual([
      { name: "user", description: "The user" },
    ]);
    expect(result.problem).toBeTruthy();
    // The owner defaults so built are safe to read beside a site's row.
    expect(() =>
      withOwnerPresentation(
        [{ name: "user", description: "The site's" }],
        result.variables
      )
    ).not.toThrow();
  });
});
