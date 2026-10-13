/**
 * What a transform may NOT do to the config it is handed.
 *
 * Both guards were documented and neither held. The mutation guard froze only
 * the outer object, so a transform reaching into `fields` changed the live
 * config in place and returned normally. And a transform could return a
 * different `slug`, which the caller ignored for the map key while passing the
 * renamed definition on — producing two entities claiming one slug, after the
 * collision check that would have caught it had already run.
 */
import { describe, expect, it } from "vitest";

import { runEntityTransforms } from "../entity-transforms";

function entity(slug: string, fields: Record<string, unknown>[]) {
  return {
    kind: "collection" as const,
    slug,
    source: "app",
    definition: { slug, fields },
  };
}

function contribution(transform: (definition: unknown) => unknown) {
  return {
    source: "@acme/fx",
    transforms: [{ target: "posts", kind: "collection" as const, transform }],
  };
}

/** The message a validation refusal carries, which is not its top-level one. */
function refusalOf(run: () => void): string {
  try {
    run();
  } catch (error) {
    const data = (error as { publicData?: { errors?: { message: string }[] } })
      .publicData;
    return data?.errors?.[0]?.message ?? "";
  }
  return "";
}

describe("a transform that mutates instead of returning", () => {
  it("cannot push onto a NESTED array", () => {
    const original = entity("posts", [{ name: "title" }]);

    expect(() =>
      runEntityTransforms([original], [
        contribution(definition => {
          (definition as { fields: Record<string, unknown>[] }).fields.push({
            name: "sneaked",
          });
          return definition;
        }),
      ] as never)
    ).toThrow();

    // The live config is untouched either way: the transform is handed a copy.
    expect(original.definition.fields).toHaveLength(1);
  });

  it("cannot assign into a NESTED object", () => {
    const original = entity("posts", [{ name: "title" }]);

    expect(() =>
      runEntityTransforms([original], [
        contribution(definition => {
          (definition as { fields: { name: string }[] }).fields[0].name =
            "renamed";
          return definition;
        }),
      ] as never)
    ).toThrow();

    expect(original.definition.fields[0].name).toBe("title");
  });

  it("still accepts a transform that RETURNS a new definition", () => {
    // The control. A guard that rejected everything would satisfy both cases
    // above and break the feature.
    const result = runEntityTransforms([entity("posts", [{ name: "title" }])], [
      contribution(definition => ({
        ...(definition as object),
        fields: [
          ...(definition as { fields: unknown[] }).fields,
          { name: "added" },
        ],
      })),
    ] as never);

    expect((result[0].definition as { fields: unknown[] }).fields).toHaveLength(
      2
    );
  });
});

describe("a transform that renames the entity", () => {
  it("is refused, naming the slug it tried to become", () => {
    // Collisions are validated BEFORE transforms run, so renaming `posts` to
    // an existing `users` produced two entities claiming `users` with nothing
    // left to catch it.
    const message = refusalOf(() =>
      runEntityTransforms([entity("posts", []), entity("users", [])], [
        contribution(definition => ({
          ...(definition as object),
          slug: "users",
        })),
      ] as never)
    );

    expect(message).toContain("users");
    expect(message).toMatch(/not rename|remapEntities/i);
  });

  it("allows a definition that keeps its slug", () => {
    // The control: reshaping is the whole point of the hook.
    const result = runEntityTransforms([entity("posts", [])], [
      contribution(definition => ({
        ...(definition as object),
        slug: "posts",
        label: "Posts",
      })),
    ] as never);

    expect((result[0].definition as { label?: string }).label).toBe("Posts");
  });
});

describe("a transform whose result has no usable slug", () => {
  it.each([
    [
      "with the slug removed",
      (definition: unknown) => {
        const { slug: _slug, ...rest } = definition as { slug: string };
        return rest;
      },
    ],
    [
      "with the slug undefined",
      (definition: unknown) => ({
        ...(definition as object),
        slug: undefined,
      }),
    ],
    [
      "with a number for a slug",
      (definition: unknown) => ({
        ...(definition as object),
        slug: 42,
      }),
    ],
  ])("is refused %s", (_label, transform) => {
    // Accepted, the definition went on into the registries and the schema
    // pipeline naming no entity, or the wrong kind of one.
    const message = refusalOf(() =>
      runEntityTransforms([entity("posts", [])], [
        contribution(transform),
      ] as never)
    );

    expect(message).toMatch(/not rename|remapEntities/i);
  });
});

describe("a disabled plugin's transform", () => {
  it("keeps behaviour it replaced with a plain value", () => {
    // A string where an object of components was removes the components as
    // surely as deleting the key, and a disabled plugin contributes no
    // behaviour, so the components stay.
    const Field = () => null;
    const posts = entity("posts", []);
    (posts.definition as Record<string, unknown>).admin = {
      components: { Field },
    };

    const result = runEntityTransforms([posts], [
      {
        ...contribution(definition => ({
          ...(definition as object),
          admin: { components: "none" },
        })),
        disabled: true,
      },
    ] as never);

    expect(
      (result[0].definition as { admin: { components: unknown } }).admin
        .components
    ).toEqual({ Field });
  });

  it("still applies a plain value that replaced a plain value", () => {
    // The control: keeping every replaced value would pass the case above
    // while freezing the storage a disabled plugin is still allowed to shape.
    const posts = entity("posts", []);
    (posts.definition as Record<string, unknown>).admin = { group: "Old" };

    const result = runEntityTransforms([posts], [
      {
        ...contribution(definition => ({
          ...(definition as object),
          admin: { group: "New" },
        })),
        disabled: true,
      },
    ] as never);

    expect(
      (result[0].definition as { admin: { group: string } }).admin.group
    ).toBe("New");
  });
});
