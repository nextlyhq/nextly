/**
 * Plugins modifying another plugin's entities.
 *
 * The gap this closes: `setup(config)` runs before plugin schema
 * contributions are merged, so a plugin never sees another plugin's
 * collections and cannot change them. Transforms run after the merge, which is
 * the only point at which "another plugin's collection" exists.
 */
import { describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../errors/nextly-error";
import {
  runEntityTransforms,
  type TransformableEntity,
} from "../entity-transforms";

const entities: TransformableEntity[] = [
  {
    slug: "posts",
    kind: "collection",
    definition: { slug: "posts", fields: ["title"] },
  },
  {
    slug: "forms",
    kind: "collection",
    definition: { slug: "forms", fields: ["name"] },
  },
  {
    slug: "settings",
    kind: "single",
    definition: { slug: "settings", fields: [] },
  },
];

function refusal(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof NextlyError) {
      const data = error.publicData as
        | { errors?: { message: string }[] }
        | undefined;
      return data?.errors?.[0]?.message ?? "";
    }
    throw error;
  }
  throw new Error("expected a refusal, and the call returned");
}

describe("applying a transform", () => {
  it("replaces the targeted entity's definition", () => {
    const out = runEntityTransforms(entities, [
      {
        source: "plugin:seo",
        transforms: [
          {
            target: "posts",
            transform: entity => ({
              ...entity,
              fields: [...(entity.fields as string[]), "metaTitle"],
            }),
          },
        ],
      },
    ]);
    expect(out.find(e => e.slug === "posts")?.definition.fields).toEqual([
      "title",
      "metaTitle",
    ]);
  });

  it("leaves other entities alone", () => {
    // The control: a transform that rewrote everything would satisfy the
    // assertion above while destroying the rest of the config.
    const out = runEntityTransforms(entities, [
      {
        source: "plugin:seo",
        transforms: [{ target: "posts", transform: e => ({ ...e, x: 1 }) }],
      },
    ]);
    expect(out.find(e => e.slug === "forms")?.definition).toEqual({
      slug: "forms",
      fields: ["name"],
    });
  });

  it("accepts several targets", () => {
    const out = runEntityTransforms(entities, [
      {
        source: "app",
        transforms: [
          {
            target: ["posts", "forms"],
            transform: e => ({ ...e, touched: true }),
          },
        ],
      },
    ]);
    expect(out.filter(e => e.definition.touched === true)).toHaveLength(2);
  });

  it("narrows by kind when one is given", () => {
    const out = runEntityTransforms(
      [
        ...entities,
        { slug: "posts", kind: "single", definition: { slug: "posts" } },
      ],
      [
        {
          source: "app",
          transforms: [
            {
              target: "posts",
              kind: "single",
              transform: e => ({ ...e, hit: true }),
            },
          ],
        },
      ]
    );
    expect(
      out.find(e => e.slug === "posts" && e.kind === "collection")?.definition
        .hit
    ).toBeUndefined();
    expect(
      out.find(e => e.slug === "posts" && e.kind === "single")?.definition.hit
    ).toBe(true);
  });
});

describe("ordering", () => {
  it("runs contributions in the order given, each seeing the last", () => {
    // Topological plugin order with the app last, the same order schema hooks
    // run in: a plugin transforming a dependency's collection must see it as
    // the dependency left it, and the app must see everything.
    const out = runEntityTransforms(entities, [
      {
        source: "plugin:a",
        transforms: [
          { target: "posts", transform: e => ({ ...e, seen: ["a"] }) },
        ],
      },
      {
        source: "plugin:b",
        transforms: [
          {
            target: "posts",
            transform: e => ({ ...e, seen: [...(e.seen as string[]), "b"] }),
          },
        ],
      },
      {
        source: "app",
        transforms: [
          {
            target: "posts",
            transform: e => ({ ...e, seen: [...(e.seen as string[]), "app"] }),
          },
        ],
      },
    ]);
    expect(out.find(e => e.slug === "posts")?.definition.seen).toEqual([
      "a",
      "b",
      "app",
    ]);
  });
});

describe("refusals", () => {
  it("refuses a target no entity declares", () => {
    // Ignoring it means the plugin appears installed and simply has no
    // effect, which is the hardest kind of "working" to diagnose.
    expect(
      refusal(() =>
        runEntityTransforms(entities, [
          {
            source: "plugin:seo",
            transforms: [{ target: "ghost", transform: e => e }],
          },
        ])
      )
    ).toMatch(/which no entity declares/);
  });

  it("refuses a transform that returns nothing", () => {
    expect(
      refusal(() =>
        runEntityTransforms(entities, [
          {
            source: "plugin:seo",
            transforms: [
              { target: "posts", transform: () => undefined as never },
            ],
          },
        ])
      )
    ).toMatch(/must return the new entity definition/);
  });

  it("names the source and index when a transform throws", () => {
    const boom = vi.fn().mockImplementation(() => {
      throw new Error("kaboom");
    });
    try {
      runEntityTransforms(entities, [
        {
          source: "plugin:seo",
          transforms: [
            { target: "forms", transform: e => e },
            { target: "posts", transform: boom },
          ],
        },
      ]);
      throw new Error("expected a refusal");
    } catch (error) {
      expect((error as NextlyError).logContext).toMatchObject({
        source: "plugin:seo",
        target: "posts",
        transformIndex: 1,
      });
    }
  });

  it("gives each transform a FROZEN copy, so mutation fails loudly", () => {
    // Mutation would make the result depend on whether a later transform read
    // a field before or after an earlier one wrote it — an ordering invisible
    // in the config, presenting as a plugin that works until another is
    // installed.
    expect(() =>
      runEntityTransforms(entities, [
        {
          source: "plugin:seo",
          transforms: [
            {
              target: "posts",
              transform: entity => {
                (entity as Record<string, unknown>).slug = "hijacked";
                return entity as Record<string, unknown>;
              },
            },
          ],
        },
      ])
    ).toThrow();
  });
});
