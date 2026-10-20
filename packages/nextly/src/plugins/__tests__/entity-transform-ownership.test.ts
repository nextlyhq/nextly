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

  it("is refused without the owner in dependsOn when the owner is named `code`", () => {
    // A plugin's name is any string; the app's entities are not told apart
    // from a plugin's by one.
    const refused = refusalOf(() =>
      fold([
        plugin("code", { collections: [ordersCollection()] }),
        changing(
          "reviews",
          entity => ({
            ...entity,
            fields: replacing(fieldsOf(entity), "total", () => undefined),
          }),
          {}
        ),
      ])
    );

    expect(refused?.code).toBe("TRANSFORM_DEPENDENCY_MISSING");
    expect(refused?.message).toContain('"code"');
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

describe("what a transform of another plugin's entity may not change, besides its fields", () => {
  it("may not retype an owner's field of a plugin type to a built-in one", () => {
    // Plugin field types register after the fold, so a plugin type cannot be
    // resolved to its column while transforms run: it is compared by name.
    const refused = refusalOf(() =>
      fold([
        plugin("shop", {
          collections: [
            ordersCollection({
              fields: [
                { name: "title", type: "text" },
                { name: "stars", type: "rating-stars" },
              ],
            }),
          ],
        }),
        changing("reviews", entity => ({
          ...entity,
          fields: replacing(fieldsOf(entity), "stars", f => ({
            ...f,
            type: "text",
          })),
        })),
      ])
    );

    expect(refused?.code).toBe("TRANSFORM_FIELD_PROTECTED");
    expect(refused?.message).toContain('"stars"');
  });

  it("may not turn off the owner's Draft/Published status column", () => {
    const refused = refusalOf(() =>
      fold([
        plugin("shop", { collections: [ordersCollection({ status: true })] }),
        changing("reviews", entity => ({ ...entity, status: false })),
      ])
    );

    expect(refused?.code).toBe("TRANSFORM_TABLE_CHANGED");
    expect(refused?.message).toContain('"status"');
  });

  it("may not turn off the owner's localization", () => {
    const refused = refusalOf(() =>
      fold([
        plugin("shop", {
          collections: [ordersCollection({ localized: true })],
        }),
        changing("reviews", entity => ({ ...entity, localized: false })),
      ])
    );

    expect(refused?.code).toBe("TRANSFORM_TABLE_CHANGED");
  });
});

describe("an owner's table settings a transform restates in an equivalent form", () => {
  it("accept an explicit status: false where the owner left it unset", () => {
    const orders = ordersOf([
      shop(),
      changing("reviews", entity => ({ ...entity, status: false })),
    ]);

    expect(orders.status).toBe(false);
  });

  it("accept an explicit localized: false where the owner left it unset", () => {
    const orders = ordersOf([
      shop(),
      changing("reviews", entity => ({ ...entity, localized: false })),
    ]);

    expect(orders.localized).toBe(false);
  });

  it("accept a dbName naming the collection's default table", () => {
    // `orders` is stored in `dc_orders` while `dbName` is unset.
    const orders = ordersOf([
      shop(),
      changing("reviews", entity => ({ ...entity, dbName: "dc_orders" })),
    ]);

    expect(orders.dbName).toBe("dc_orders");
  });

  it("accept dropping a dbName that names the default table", () => {
    const orders = ordersOf([
      plugin("shop", {
        collections: [ordersCollection({ dbName: "dc_orders" })],
      }),
      changing("reviews", ({ dbName: _dropped, ...entity }) => entity),
    ]);

    expect(orders.dbName).toBeUndefined();
  });

  it("leave a Single with a blank slug to the validation that refuses it", () => {
    // A blank slug names no default table, so there is none to resolve: the
    // comparison must not throw where the slug's own validation would.
    const blank = {
      slug: " ",
      fields: [{ name: "currency", type: "text" }],
    } as unknown as SingleConfig;

    expect(() =>
      fold([
        plugin("shop", { singles: [blank] }),
        plugin("reviews", {
          dependsOn: ["shop"],
          transforms: [{ target: " ", transform: entity => entity }],
        }),
      ])
    ).not.toThrow();
  });

  it("still refuse another spelling of the default table, which not every reader resolves", () => {
    // The schema pipeline resolves each of these to the default table, but
    // `i18n:restore` reads a `dbName` as written, and would look for
    // `orders_locales` rather than `dc_orders_locales`.
    const collection = refusalOf(() =>
      fold([
        shop(),
        changing("reviews", entity => ({ ...entity, dbName: "orders" })),
      ])
    );
    const single = refusalOf(() =>
      fold([
        plugin("shop", {
          singles: [
            {
              slug: "store-settings",
              fields: [{ name: "currency", type: "text" }],
            } as unknown as SingleConfig,
          ],
        }),
        plugin("reviews", {
          dependsOn: ["shop"],
          transforms: [
            {
              target: "store-settings",
              transform: entity => ({ ...entity, dbName: "store_settings" }),
            },
          ],
        }),
      ])
    );

    expect(collection?.code).toBe("TRANSFORM_TABLE_CHANGED");
    expect(single?.code).toBe("TRANSFORM_TABLE_CHANGED");
  });

  it("accept a dbName that resolves to a Single's default table", () => {
    const settings = {
      slug: "store-settings",
      fields: [{ name: "currency", type: "text" }],
    } as unknown as SingleConfig;
    const result = fold([
      plugin("shop", { singles: [settings] }),
      plugin("reviews", {
        dependsOn: ["shop"],
        transforms: [
          {
            target: "store-settings",
            transform: entity => ({
              ...entity,
              dbName: "single_store_settings",
            }),
          },
        ],
      }),
    ]);

    expect(result.singles?.[0]).toMatchObject({
      dbName: "single_store_settings",
    });
  });

  it("still refuse turning on a status column the owner left unset", () => {
    // The control: comparing as the pipeline reads them must not accept a
    // setting the pipeline reads differently.
    const refused = refusalOf(() =>
      fold([
        shop(),
        changing("reviews", entity => ({ ...entity, status: true })),
      ])
    );

    expect(refused?.code).toBe("TRANSFORM_TABLE_CHANGED");
    expect(refused?.message).toContain('"status"');
  });

  it("still refuse a dbName that resolves to another table", () => {
    // `orders_v2` resolves to `dc_orders_v2`, not `dc_orders`.
    const refused = refusalOf(() =>
      fold([
        shop(),
        changing("reviews", entity => ({ ...entity, dbName: "orders_v2" })),
      ])
    );

    expect(refused?.code).toBe("TRANSFORM_TABLE_CHANGED");
    expect(refused?.message).toContain('"dbName"');
  });
});

describe("the order of hooks a third plugin contributed", () => {
  const first = (): void => undefined;
  const second = (): void => undefined;

  /** `reviews` adds two hooks after the owner's. */
  const reviews = () =>
    changing("reviews", entity => ({
      ...entity,
      hooks: { beforeChange: [ownersHook, first, second] },
    }));

  it("may not be changed without a dependency on their contributor", () => {
    // Each hook is handed what the one before returned, so swapping two
    // changes what both do.
    const refused = refusalOf(() =>
      fold([
        shop(),
        reviews(),
        changing("badges", entity => ({
          ...entity,
          hooks: { beforeChange: [ownersHook, second, first] },
        })),
      ])
    );

    expect(refused?.code).toBe("TRANSFORM_BEHAVIOUR_PROTECTED");
    expect(refused?.message).toContain("moves");
  });

  it("may not have one of them repeated", () => {
    const refused = refusalOf(() =>
      fold([
        shop(),
        reviews(),
        changing("badges", entity => ({
          ...entity,
          hooks: { beforeChange: [ownersHook, first, second, first] },
        })),
      ])
    );

    expect(refused?.code).toBe("TRANSFORM_BEHAVIOUR_PROTECTED");
    expect(refused?.message).toContain("repeats");
  });

  it("leaves the owner's hook free to move around them, and a later transform reads the new order", () => {
    // The control: the owner's hook is the transforming plugin's to replace,
    // so it may move it too. A third transform keeping the list as it now
    // runs is accepted, which it is only if the ledger followed the move.
    const badgesHook = (): void => undefined;
    const orders = ordersOf([
      shop(),
      reviews(),
      changing("badges", entity => ({
        ...entity,
        hooks: { beforeChange: [badgesHook, first, second, ownersHook] },
      })),
      changing("labels", entity => ({ ...entity }), {
        dependsOn: ["shop"],
      }),
    ]);

    expect((orders.hooks as { beforeChange: unknown[] }).beforeChange).toEqual([
      badgesHook,
      first,
      second,
      ownersHook,
    ]);
  });
});

describe("the indexes on an owner's field", () => {
  const indexedOrders = () =>
    plugin("shop", {
      collections: [
        ordersCollection({
          fields: [
            { name: "title", type: "text" },
            { name: "reference", type: "text", unique: true },
            { name: "total", type: "number", index: true },
          ],
        }),
      ],
    });

  it("keep its uniqueness: the owner's rows rely on it", () => {
    const refused = refusalOf(() =>
      fold([
        indexedOrders(),
        changing("reviews", entity => ({
          ...entity,
          fields: replacing(fieldsOf(entity), "reference", f => ({
            ...f,
            unique: false,
          })),
        })),
      ])
    );

    expect(refused?.code).toBe("TRANSFORM_FIELD_PROTECTED");
    expect(refused?.message).toContain('"reference"');
  });

  it("may lose a plain index, which a plugin may change", () => {
    // The control: an index changes no value, and modifying another plugin's
    // indexes is what a transform may do.
    const orders = ordersOf([
      indexedOrders(),
      changing("reviews", entity => ({
        ...entity,
        fields: replacing(fieldsOf(entity), "total", f => ({
          ...f,
          index: false,
        })),
      })),
    ]);

    expect(fieldsOf(orders)[2]).toMatchObject({ name: "total", index: false });
  });
});

describe("a field whose type decides the shape of what it stores", () => {
  it("may not turn an owner's group into a repeater", () => {
    // One JSON column holds either, so only the type tells an object from an
    // array.
    const refused = refusalOf(() =>
      fold([
        shop(),
        changing("reviews", entity => ({
          ...entity,
          fields: replacing(fieldsOf(entity), "shipping", f => ({
            ...f,
            type: "repeater",
          })),
        })),
      ])
    );

    expect(refused?.code).toBe("TRANSFORM_FIELD_PROTECTED");
    expect(refused?.message).toContain('"shipping"');
  });

  it("may turn an owner's text field into an email field", () => {
    // The control: both store the same string in the same column.
    const orders = ordersOf([
      shop(),
      changing("reviews", entity => ({
        ...entity,
        fields: replacing(fieldsOf(entity), "title", f => ({
          ...f,
          type: "email",
        })),
      })),
    ]);

    expect(fieldsOf(orders)[0]).toMatchObject({ name: "title", type: "email" });
  });
});

describe("a function default a third plugin contributed", () => {
  it("may not be replaced without a dependency on its contributor", () => {
    const today = (): string => "today";
    const refused = refusalOf(() =>
      fold([
        shop(),
        plugin("reviews", {
          dependsOn: ["shop"],
          extend: [
            {
              target: "orders",
              fields: [
                { name: "reviewedOn", type: "text", defaultValue: today },
              ],
            },
          ],
        }),
        changing("badges", entity => ({
          ...entity,
          fields: replacing(fieldsOf(entity), "reviewedOn", f => ({
            ...f,
            defaultValue: "never",
          })),
        })),
      ])
    );

    expect(refused?.code).toBe("TRANSFORM_BEHAVIOUR_PROTECTED");
    expect(refused?.message).toContain("fields.reviewedOn.defaultValue");
  });
});

describe("a field of a plugin type a transform adds", () => {
  it("is not refused while plugin types are not yet registered", () => {
    // Plugin field types register after the fold; the definition's own
    // validator defers a type it does not know, and boot asks again once
    // they are registered.
    const orders = ordersOf([
      shop(),
      changing("reviews", entity => ({
        ...entity,
        fields: [...fieldsOf(entity), { name: "stars", type: "rating-stars" }],
      })),
    ]);

    expect(fieldsOf(orders).map(f => f.name)).toContain("stars");
  });
});

describe("the compound indexes of another plugin's collection", () => {
  const indexed = () =>
    plugin("shop", {
      collections: [
        ordersCollection({
          indexes: [
            { fields: ["title", "total"], unique: true },
            { fields: ["total", "title"] },
          ],
        }),
      ],
    });

  it("keep a unique one", () => {
    const refused = refusalOf(() =>
      fold([
        indexed(),
        changing("reviews", entity => ({
          ...entity,
          indexes: [{ fields: ["total", "title"] }],
        })),
      ])
    );

    expect(refused?.code).toBe("TRANSFORM_TABLE_CHANGED");
    expect(refused?.message).toContain("unique index");
  });

  it("may lose a plain one", () => {
    // The control: a plain index changes no value.
    const orders = ordersOf([
      indexed(),
      changing("reviews", entity => ({
        ...entity,
        indexes: [{ fields: ["title", "total"], unique: true }],
      })),
    ]);

    expect(orders.indexes).toEqual([
      { fields: ["title", "total"], unique: true },
    ]);
  });
});

describe("a function nested in a setting a third plugin contributed", () => {
  it("may not be replaced without a dependency on its contributor", () => {
    const previewUrl = (): string => "/preview";
    const refused = refusalOf(() =>
      fold([
        shop(),
        changing("reviews", entity => ({
          ...entity,
          preview: { url: previewUrl },
        })),
        changing("badges", entity => ({
          ...entity,
          preview: { url: (): string => "/elsewhere" },
        })),
      ])
    );

    expect(refused?.code).toBe("TRANSFORM_BEHAVIOUR_PROTECTED");
    expect(refused?.message).toContain('"preview.url"');
  });
});

describe("an owner's password field", () => {
  it("may not become a text field, which would serve its stored hashes", () => {
    const refused = refusalOf(() =>
      fold([
        plugin("shop", {
          collections: [
            ordersCollection({
              fields: [
                { name: "title", type: "text" },
                { name: "pin", type: "password" },
              ],
            }),
          ],
        }),
        changing("reviews", entity => ({
          ...entity,
          fields: replacing(fieldsOf(entity), "pin", f => ({
            ...f,
            type: "text",
          })),
        })),
      ])
    );

    expect(refused?.code).toBe("TRANSFORM_FIELD_PROTECTED");
    expect(refused?.message).toContain('"pin"');
  });
});

describe("free-form settings that loop back on themselves", () => {
  it("do not stop a transform from running", () => {
    // `custom` is the author's own metadata, and may share or loop back to an
    // object; the ledger walks it for functions without following a loop.
    const custom: Record<string, unknown> = { label: "orders" };
    custom.self = custom;
    const orders = ordersOf([
      plugin("shop", { collections: [ordersCollection({ custom })] }),
      changing("reviews", entity => ({ ...entity, admin: { group: "Sales" } })),
    ]);

    expect(orders.admin).toEqual({ group: "Sales" });
  });
});

describe("a field another plugin nested in a container", () => {
  it("keeps its container's type, even against the container's declarer", () => {
    // `badges` declares the group with `extend`, `reviews` nests a field in
    // it, and `badges`' own transform, running after, turns the group into a
    // repeater: every stored object would be read as an array.
    const refused = refusalOf(() =>
      fold([
        shop(),
        changing("reviews", entity => ({
          ...entity,
          fields: replacing(fieldsOf(entity), "extras", f => ({
            ...f,
            fields: [...(f.fields as Fields), { name: "note", type: "text" }],
          })),
        })),
        plugin("badges", {
          dependsOn: ["shop"],
          extend: [
            {
              target: "orders",
              fields: [
                {
                  name: "extras",
                  type: "group",
                  fields: [{ name: "colour", type: "text" }],
                },
              ],
            },
          ],
          transforms: [
            {
              target: "orders",
              transform: entity => ({
                ...entity,
                fields: replacing(fieldsOf(entity), "extras", f => ({
                  ...f,
                  type: "repeater",
                })),
              }),
            },
          ],
        }),
      ])
    );

    expect(refused?.code).toBe("TRANSFORM_FIELD_PROTECTED");
    expect(refused?.message).toContain('"extras.note"');
  });
});

describe("a refusal the entity already carried", () => {
  /** `shop`'s raw orders, whose `status` select has no options. */
  const invalidOrders = () =>
    plugin("shop", {
      collections: [
        ordersCollection({
          fields: [
            { name: "title", type: "text" },
            { name: "state", type: "select" },
          ],
        }),
      ],
    });

  it("is not laid at the door of a transform that inserts a field before it", () => {
    const orders = ordersOf([
      invalidOrders(),
      changing("reviews", entity => ({
        ...entity,
        fields: [{ name: "rating", type: "number" }, ...fieldsOf(entity)],
      })),
    ]);

    expect(fieldsOf(orders).map(f => f.name)).toEqual([
      "rating",
      "title",
      "state",
    ]);
  });

  it("is laid at its door when the transform moves it onto another field", () => {
    // Repairing `state` while adding `stage` with the same refusal: the code
    // and message are the same, the field is not.
    const refused = refusalOf(() =>
      fold([
        invalidOrders(),
        changing("reviews", entity => ({
          ...entity,
          fields: [
            ...replacing(fieldsOf(entity), "state", f => ({
              ...f,
              options: [{ label: "Open", value: "open" }],
            })),
            { name: "stage", type: "select" },
          ],
        })),
      ])
    );

    expect(refused?.message).toContain(
      'Plugin "reviews" makes "orders" invalid'
    );
  });
});

describe("how many values a field another plugin declared holds", () => {
  it("may not turn an owner's text field into a list", () => {
    // A `hasMany` text field keeps a JSON array in the same column a single
    // value uses.
    const refused = refusalOf(() =>
      fold([
        shop(),
        changing("reviews", entity => ({
          ...entity,
          fields: replacing(fieldsOf(entity), "title", f => ({
            ...f,
            hasMany: true,
          })),
        })),
      ])
    );

    expect(refused?.code).toBe("TRANSFORM_FIELD_PROTECTED");
    expect(refused?.message).toContain('"title"');
  });

  it("may not make an owner's field group repeatable", () => {
    // One object or an array of them, and no column to show which.
    const refused = refusalOf(() =>
      fold([
        plugin("shop", {
          collections: [
            ordersCollection({
              fields: [
                { name: "title", type: "text" },
                { name: "seo", type: "component", component: "seo-fields" },
              ],
            }),
          ],
        }),
        changing("reviews", entity => ({
          ...entity,
          fields: replacing(fieldsOf(entity), "seo", f => ({
            ...f,
            repeatable: true,
          })),
        })),
      ])
    );

    expect(refused?.code).toBe("TRANSFORM_FIELD_PROTECTED");
    expect(refused?.message).toContain('"seo"');
  });
});

describe("the table of an entity another plugin keeps a field on", () => {
  /** `reviews` adds `rating` to `orders` with `extend`. */
  const reviews = () =>
    plugin("reviews", {
      dependsOn: ["shop"],
      extend: [
        { target: "orders", fields: [{ name: "rating", type: "number" }] },
      ],
    });

  /** `shop` moving its own `orders` to another table. */
  const movingShop = () =>
    plugin("shop", {
      collections: [ordersCollection()],
      transforms: [
        {
          target: "orders",
          transform: entity => ({ ...entity, dbName: "legacy_orders" }),
        },
      ],
    });

  it("may not be moved, even by the entity's owner", () => {
    const refused = refusalOf(() => fold([movingShop(), reviews()]));

    expect(refused?.code).toBe("TRANSFORM_TABLE_CHANGED");
    expect(refused?.message).toContain('"reviews"');
  });

  it("may be moved by its owner while no other plugin keeps data there", () => {
    // The control: the owner's own data is the owner's to move.
    const orders = ordersOf([movingShop()]);

    expect(orders.dbName).toBe("legacy_orders");
  });
});

describe("a function in a setting two settings share", () => {
  it("is protected under each of them", () => {
    // `primary` and `fallback` hold one object; replacing the function under
    // `fallback` alone must still be seen.
    const run = (): string => "run";
    const shared = { run };
    const refused = refusalOf(() =>
      fold([
        shop(),
        changing("reviews", entity => ({
          ...entity,
          custom: { primary: shared, fallback: shared },
        })),
        changing("badges", entity => {
          const custom = entity.custom as Record<string, unknown>;
          return {
            ...entity,
            custom: {
              primary: custom.primary,
              fallback: { run: () => "other" },
            },
          };
        }),
      ])
    );

    expect(refused?.code).toBe("TRANSFORM_BEHAVIOUR_PROTECTED");
    expect(refused?.message).toContain('"custom.fallback.run"');
  });
});

describe("a refusal the entity already carried on one of its indexes", () => {
  it("is not laid at the door of a transform that inserts a field", () => {
    // `indexes[0].fields[0]` numbers the index's own list, not a field, so
    // inserting a field moves nothing there.
    const orders = ordersOf([
      plugin("shop", {
        collections: [ordersCollection({ indexes: [{ fields: [42] }] })],
      }),
      changing("reviews", entity => ({
        ...entity,
        fields: [{ name: "rating", type: "number" }, ...fieldsOf(entity)],
      })),
    ]);

    expect(fieldsOf(orders)[0]).toMatchObject({ name: "rating" });
  });
});
