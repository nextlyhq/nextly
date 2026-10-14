/**
 * What a transform may change on an entity it does not own.
 *
 * Through the fold, the one point every runtime and CLI path reaches, so the
 * ownership each test relies on — the entity's owner and who added each field
 * with `extend` — is the fold's own, not a fixture's.
 */
import { describe, expect, it } from "vitest";

import type { CollectionConfig } from "../../collections/config/define-collection";
import type { NextlyServiceConfig } from "../../di/register";
import type { SingleConfig } from "../../singles/config/types";
import type { EntityTransform } from "../entity-transforms";
import type { PluginDefinition } from "../plugin-context";
import { applyPluginSchemaContributions } from "../schema/apply-contributions";

type Definition = Record<string, unknown>;
type Fields = Record<string, unknown>[];

const cfg = (partial: Partial<NextlyServiceConfig> = {}): NextlyServiceConfig =>
  ({ imageProcessor: {}, ...partial }) as unknown as NextlyServiceConfig;

const ownersHook = (): void => undefined;
const ownersRead = (): boolean => true;

/** `orders`, owned by `shop`, with a hook, an access rule and a group. */
const ordersCollection = (extra: Definition = {}): CollectionConfig =>
  ({
    slug: "orders",
    fields: [
      { name: "title", type: "text" },
      { name: "total", type: "number" },
      {
        name: "shipping",
        type: "group",
        fields: [
          { name: "street", type: "text" },
          { name: "city", type: "text" },
        ],
      },
    ],
    hooks: { beforeChange: [ownersHook] },
    access: { read: ownersRead },
    ...extra,
  }) as unknown as CollectionConfig;

interface PluginOptions {
  dependsOn?: string[];
  optionalDependsOn?: string[];
  collections?: CollectionConfig[];
  singles?: SingleConfig[];
  extend?: { target: string; fields: Fields }[];
  transforms?: EntityTransform[];
  enabled?: boolean;
}

const ranges = (names: string[] | undefined) =>
  names === undefined
    ? undefined
    : Object.fromEntries(names.map(name => [name, "*"]));

const plugin = (name: string, options: PluginOptions): PluginDefinition =>
  ({
    name,
    version: "1.0.0",
    nextly: ">=0.0.0",
    enabled: options.enabled ?? true,
    dependsOn: ranges(options.dependsOn),
    optionalDependsOn: ranges(options.optionalDependsOn),
    contributes: {
      collections: options.collections,
      singles: options.singles,
      extend: options.extend,
      transforms: options.transforms,
    },
  }) as unknown as PluginDefinition;

const shop = () => plugin("shop", { collections: [ordersCollection()] });

/** A plugin transforming `orders` with `change`. */
const changing = (
  name: string,
  change: (entity: Definition) => Definition,
  options: PluginOptions = { dependsOn: ["shop"] }
) =>
  plugin(name, {
    ...options,
    transforms: [{ target: "orders", transform: entity => change(entity) }],
  });

const fieldsOf = (entity: Definition): Fields => entity.fields as Fields;

/** `fields` with the one named `name` replaced by `make(it)`. */
const replacing = (
  fields: Fields,
  name: string,
  make: (field: Definition) => Definition | undefined
): Fields =>
  fields.flatMap(field => {
    if (field.name !== name) return [field];
    const next = make(field);
    return next === undefined ? [] : [next];
  });

const fold = (plugins: PluginDefinition[], config = cfg()) =>
  applyPluginSchemaContributions(config, plugins);

const ordersOf = (plugins: PluginDefinition[]): Definition =>
  fold(plugins).collections?.find(
    c => c.slug === "orders"
  ) as unknown as Definition;

/** The first refusal's code and message, or `undefined` when nothing threw. */
function refusalOf(
  run: () => unknown
): { code: string; message: string } | undefined {
  try {
    run();
  } catch (error) {
    const errors = (
      error as {
        publicData?: { errors?: { code: string; message: string }[] };
      }
    ).publicData?.errors;
    return errors?.[0] ?? { code: "", message: String(error) };
  }
  return undefined;
}

describe("a plugin transforming another plugin's collection", () => {
  it("runs in dependency order down a chain, each seeing the last's change", () => {
    // `reviews` depends on `shop`, `badges` on both: `badges` must see the
    // field `reviews` added, which it can only do if it runs after it.
    let seenByBadges: string[] = [];
    const orders = ordersOf([
      shop(),
      changing("reviews", entity => ({
        ...entity,
        fields: [...fieldsOf(entity), { name: "rating", type: "number" }],
      })),
      changing(
        "badges",
        entity => {
          seenByBadges = fieldsOf(entity).map(f => String(f.name));
          return {
            ...entity,
            fields: [...fieldsOf(entity), { name: "badge", type: "text" }],
          };
        },
        { dependsOn: ["shop", "reviews"] }
      ),
    ]);

    expect(seenByBadges).toContain("rating");
    expect(fieldsOf(orders).map(f => f.name)).toEqual([
      "title",
      "total",
      "shipping",
      "rating",
      "badge",
    ]);
  });

  it("is refused without the owner in dependsOn, naming both plugins", () => {
    const refused = refusalOf(() =>
      fold([shop(), changing("reviews", entity => entity, {})])
    );

    expect(refused?.code).toBe("TRANSFORM_DEPENDENCY_MISSING");
    expect(refused?.message).toContain('"reviews"');
    expect(refused?.message).toContain('"shop"');
  });

  it("is refused with the owner only in optionalDependsOn", () => {
    // An optional dependency may be absent; the entity's owner may not.
    const refused = refusalOf(() =>
      fold([
        shop(),
        changing("reviews", entity => entity, { optionalDependsOn: ["shop"] }),
      ])
    );

    expect(refused?.code).toBe("TRANSFORM_DEPENDENCY_MISSING");
  });

  it("is refused before the transform runs", () => {
    // A precondition: the plugin runs no code over the entity at all.
    let ran = false;
    refusalOf(() =>
      fold([
        shop(),
        changing(
          "reviews",
          entity => {
            ran = true;
            return entity;
          },
          {}
        ),
      ])
    );

    expect(ran).toBe(false);
  });

  it("needs no dependency to transform the app's own collection", () => {
    // The control: the app cannot be declared as a dependency, and a plugin
    // reshaping the app's collections is what transforms are for.
    const result = fold(
      [
        changing(
          "reviews",
          entity => ({
            ...entity,
            fields: replacing(fieldsOf(entity), "total", () => undefined),
          }),
          {}
        ),
      ],
      cfg({ collections: [ordersCollection()] })
    );

    const orders = result.collections?.[0] as unknown as Definition;
    expect(fieldsOf(orders).map(f => f.name)).not.toContain("total");
  });
});

describe("a transform of another plugin's entity", () => {
  it("may not remove a field the owner declared", () => {
    const refused = refusalOf(() =>
      fold([
        shop(),
        changing("reviews", entity => ({
          ...entity,
          fields: replacing(fieldsOf(entity), "total", () => undefined),
        })),
      ])
    );

    expect(refused?.code).toBe("TRANSFORM_FIELD_PROTECTED");
    expect(refused?.message).toContain('"total"');
    expect(refused?.message).toContain('"shop"');
  });

  it("may not retype a field the owner declared", () => {
    const refused = refusalOf(() =>
      fold([
        shop(),
        changing("reviews", entity => ({
          ...entity,
          fields: replacing(fieldsOf(entity), "total", f => ({
            ...f,
            type: "text",
          })),
        })),
      ])
    );

    expect(refused?.code).toBe("TRANSFORM_FIELD_PROTECTED");
  });

  it("may not make an owner's column required", () => {
    // NOT NULL is part of the column: the migration would alter it.
    const refused = refusalOf(() =>
      fold([
        shop(),
        changing("reviews", entity => ({
          ...entity,
          fields: replacing(fieldsOf(entity), "total", f => ({
            ...f,
            required: true,
          })),
        })),
      ])
    );

    expect(refused?.code).toBe("TRANSFORM_FIELD_PROTECTED");
  });

  it("may not remove a field nested in the owner's group", () => {
    // The group is one JSON column, so no column changes, but every stored
    // street would no longer be read.
    const refused = refusalOf(() =>
      fold([
        shop(),
        changing("reviews", entity => ({
          ...entity,
          fields: replacing(fieldsOf(entity), "shipping", f => ({
            ...f,
            fields: replacing(f.fields as Fields, "street", () => undefined),
          })),
        })),
      ])
    );

    expect(refused?.code).toBe("TRANSFORM_FIELD_PROTECTED");
    expect(refused?.message).toContain('"shipping.street"');
  });

  it("may relabel an owner's field and require a nested one", () => {
    // The control for the three above: what changes no storage stands. A
    // nested field's value sits in its parent's JSON, where nothing is
    // NOT NULL, so requiring it alters no column.
    const orders = ordersOf([
      shop(),
      changing("reviews", entity => ({
        ...entity,
        fields: replacing(
          replacing(fieldsOf(entity), "total", f => ({
            ...f,
            label: "Total due",
          })),
          "shipping",
          f => ({
            ...f,
            fields: replacing(f.fields as Fields, "city", c => ({
              ...c,
              required: true,
            })),
          })
        ),
      })),
    ]);

    expect(fieldsOf(orders)[1]).toMatchObject({
      name: "total",
      label: "Total due",
    });
  });

  it("may not move the entity to another table", () => {
    const refused = refusalOf(() =>
      fold([
        shop(),
        changing("reviews", entity => ({ ...entity, dbName: "legacy_orders" })),
      ])
    );

    expect(refused?.code).toBe("TRANSFORM_TABLE_CHANGED");
  });

  it("may not delete the entity", () => {
    const refused = refusalOf(() =>
      fold([shop(), changing("reviews", () => null as unknown as Definition)])
    );

    expect(refused?.message).toContain("returned null");
  });

  it("may not change its slug", () => {
    const refused = refusalOf(() =>
      fold([
        shop(),
        changing("reviews", entity => ({ ...entity, slug: "sales" })),
      ])
    );

    expect(refused?.message).toContain('slug "sales"');
  });

  it("protects a Single a plugin owns the same way", () => {
    const settings = {
      slug: "store-settings",
      fields: [{ name: "currency", type: "text" }],
    } as unknown as SingleConfig;
    const refused = refusalOf(() =>
      fold([
        plugin("shop", { singles: [settings] }),
        plugin("reviews", {
          dependsOn: ["shop"],
          transforms: [
            {
              target: "store-settings",
              transform: entity => ({ ...entity, fields: [] }),
            },
          ],
        }),
      ])
    );

    expect(refused?.code).toBe("TRANSFORM_FIELD_PROTECTED");
  });

  it("lets the owner change its own fields", () => {
    // The control: the protection is of a field from everyone but its
    // declarer.
    const orders = ordersOf([
      plugin("shop", {
        collections: [ordersCollection()],
        transforms: [
          {
            target: "orders",
            transform: entity => ({
              ...entity,
              fields: replacing(fieldsOf(entity), "total", () => undefined),
            }),
          },
        ],
      }),
    ]);

    expect(fieldsOf(orders).map(f => f.name)).not.toContain("total");
  });
});

describe("a field a third plugin contributed", () => {
  /** `reviews` adds `rating` to `orders` with `extend`. */
  const reviews = () =>
    plugin("reviews", {
      dependsOn: ["shop"],
      extend: [
        { target: "orders", fields: [{ name: "rating", type: "number" }] },
      ],
    });

  it("may not be removed, even by a plugin that depends on its contributor", () => {
    const refused = refusalOf(() =>
      fold([
        shop(),
        reviews(),
        changing(
          "badges",
          entity => ({
            ...entity,
            fields: replacing(fieldsOf(entity), "rating", () => undefined),
          }),
          { dependsOn: ["shop", "reviews"] }
        ),
      ])
    );

    expect(refused?.code).toBe("TRANSFORM_FIELD_PROTECTED");
    expect(refused?.message).toContain('"reviews"');
  });

  it("may not be retyped, even by the entity's owner", () => {
    const refused = refusalOf(() =>
      fold([
        plugin("shop", {
          collections: [ordersCollection()],
          transforms: [
            {
              target: "orders",
              transform: entity => ({
                ...entity,
                fields: replacing(fieldsOf(entity), "rating", f => ({
                  ...f,
                  type: "text",
                })),
              }),
            },
          ],
        }),
        reviews(),
      ])
    );

    expect(refused?.code).toBe("TRANSFORM_FIELD_PROTECTED");
  });

  it("is protected on the app's own collection too", () => {
    // The harm is to the contributor, whoever owns the table.
    const refused = refusalOf(() =>
      fold(
        [
          plugin("reviews", {
            extend: [
              {
                target: "orders",
                fields: [{ name: "rating", type: "number" }],
              },
            ],
          }),
          changing(
            "badges",
            entity => ({
              ...entity,
              fields: replacing(fieldsOf(entity), "rating", () => undefined),
            }),
            { dependsOn: ["reviews"] }
          ),
        ],
        cfg({ collections: [ordersCollection()] })
      )
    );

    expect(refused?.code).toBe("TRANSFORM_FIELD_PROTECTED");
  });
});

describe("rules and hooks a third plugin contributed", () => {
  const reviewsHook = (): void => undefined;

  /** `reviews` adds a hook beside the owner's and an admin group. */
  const reviews = () =>
    changing("reviews", entity => ({
      ...entity,
      hooks: { beforeChange: [ownersHook, reviewsHook] },
      admin: { group: "Reviews" },
    }));

  const replacingHooks = (dependsOn: string[]) =>
    changing(
      "badges",
      entity => ({ ...entity, hooks: { beforeChange: [ownersHook] } }),
      { dependsOn }
    );

  it("may not be removed by a plugin that does not depend on their contributor", () => {
    const refused = refusalOf(() =>
      fold([shop(), reviews(), replacingHooks(["shop"])])
    );

    expect(refused?.code).toBe("TRANSFORM_BEHAVIOUR_PROTECTED");
    expect(refused?.message).toContain('"badges"');
    expect(refused?.message).toContain('"reviews"');
  });

  it("may be removed by a plugin that depends on their contributor", () => {
    const orders = ordersOf([
      shop(),
      reviews(),
      replacingHooks(["shop", "reviews"]),
    ]);

    expect((orders.hooks as { beforeChange: unknown[] }).beforeChange).toEqual([
      ownersHook,
    ]);
  });

  it("may not have an admin setting replaced without the dependency", () => {
    const refused = refusalOf(() =>
      fold([
        shop(),
        reviews(),
        changing("badges", entity => ({
          ...entity,
          admin: { group: "Badges" },
        })),
      ])
    );

    expect(refused?.code).toBe("TRANSFORM_BEHAVIOUR_PROTECTED");
  });

  it("leave the owner's own rules to any plugin allowed to transform the entity", () => {
    // The control: replacing the owner's access rule and hook needs only the
    // owner as a dependency, which the transform already declares.
    const replacement = (): boolean => false;
    const orders = ordersOf([
      shop(),
      changing("badges", entity => ({
        ...entity,
        access: { read: replacement },
        hooks: {},
      })),
    ]);

    expect((orders.access as { read: unknown }).read).toBe(replacement);
  });

  it("include a validator on a field the third plugin contributed", () => {
    const validate = (): true => true;
    const refused = refusalOf(() =>
      fold([
        shop(),
        plugin("reviews", {
          dependsOn: ["shop"],
          extend: [
            {
              target: "orders",
              fields: [{ name: "rating", type: "number", validate }],
            },
          ],
        }),
        changing("badges", entity => ({
          ...entity,
          fields: replacing(fieldsOf(entity), "rating", f => ({
            ...f,
            validate: undefined,
          })),
        })),
      ])
    );

    expect(refused?.code).toBe("TRANSFORM_BEHAVIOUR_PROTECTED");
    expect(refused?.message).toContain("fields.rating.validate");
  });
});

describe("a transformed entity is validated as its definition would be", () => {
  it("refuses a collection set to db.idType serial, naming the plugin", () => {
    const refused = refusalOf(() =>
      fold([
        shop(),
        changing("reviews", entity => ({
          ...entity,
          db: { idType: "serial" },
        })),
      ])
    );

    expect(refused?.code).toBe("DB_ID_TYPE_INVALID");
    expect(refused?.message).toContain('Plugin "reviews"');
    expect(refused?.message).toContain("col.serial()");
  });

  it("refuses a field the transform adds that a definition would refuse", () => {
    const refused = refusalOf(() =>
      fold([
        shop(),
        changing("reviews", entity => ({
          ...entity,
          fields: [
            ...fieldsOf(entity),
            { name: "rating", type: "number" },
            { name: "rating", type: "number" },
          ],
        })),
      ])
    );

    expect(refused?.message).toContain(
      'Plugin "reviews" makes "orders" invalid'
    );
  });

  it("accepts db.idType uuidv7", () => {
    // The control: the check is the definition's, not a refusal of `db`.
    const orders = ordersOf([
      shop(),
      changing("reviews", entity => ({ ...entity, db: { idType: "uuidv7" } })),
    ]);

    expect(orders.db).toEqual({ idType: "uuidv7" });
  });

  it("does not lay a refusal the entity already carried at the transform's door", () => {
    // An entity assembled without `defineCollection` may carry a refusal
    // already; that one is not the transforming plugin's doing.
    const orders = ordersOf([
      plugin("shop", {
        collections: [ordersCollection({ db: { idType: "serial" } })],
      }),
      changing("reviews", entity => ({ ...entity, admin: { group: "Sales" } })),
    ]);

    expect(orders.admin).toEqual({ group: "Sales" });
  });
});
