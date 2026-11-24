/**
 * The `define*` functions record a problem rather than throw at import, so a configuration with
 * problems in several entities reaches the one check that names them all.
 */
import { describe, expect, it } from "vitest";

import { systemFieldsBeside } from "../../../collections/config/declared-config";
import { defineCollection } from "../../../collections/config/define-collection";
import { systemColumnsForFields } from "../../../domains/schema/services/field-column-descriptor";
import { defineFieldGroup } from "../../../field-groups/config/define-field-group";
import { setupTransformerInput } from "../../../plugins/plugin-consent";
import { defineSingle } from "../../../singles/config/define-single";
import { configurationProblems } from "../config-problems";

describe("a bad Single and a bad collection, each through its define function", () => {
  it("are both reported, neither stopping the import", () => {
    const declare = () => ({
      collections: [
        defineCollection({
          slug: "Blog Posts",
          fields: [{ name: "title", type: "text" }],
        }),
      ],
      singles: [
        defineSingle({
          slug: "home page",
          fields: [{ name: "heading", type: "text" }],
        }),
      ],
    });

    expect(declare).not.toThrow();
    const problems = configurationProblems(declare());
    expect(problems.map(problem => problem.path)).toEqual([
      "collections[0].slug",
      "singles[0].slug",
    ]);
    expect(problems.map(problem => problem.code)).toEqual([
      "SLUG_INVALID_FORMAT",
      "SLUG_INVALID_FORMAT",
    ]);
  });
});

describe("a relationship to a collection Nextly provides", () => {
  // `users` and `media` are relationship targets without the configuration declaring them; a
  // relationship's target is judged with every target known (the plugins' and the Schema
  // Builder's too) where the load and the start resolve them, not here.
  it("is no problem", () => {
    expect(
      configurationProblems({
        collections: [
          {
            slug: "posts",
            fields: [
              { name: "author", type: "relationship", relationTo: "users" },
              { name: "cover", type: "upload", relationTo: "media" },
            ],
          },
        ],
      })
    ).toEqual([]);
  });
});

describe("an app's entity a plugin's setup changed", () => {
  // The entity is judged as the commands will use it, after the plugins' setups, and placed
  // where the app declared it.
  it("is judged in its changed form, at the place the app declared it", () => {
    const declared = {
      collections: [
        { slug: "notes", fields: [{ name: "body", type: "text" }] },
      ],
    };
    const effective = {
      collections: [
        {
          slug: "notes",
          fields: [
            { name: "body", type: "text" },
            { name: "body", type: "text" },
          ],
        },
      ],
    };

    expect(configurationProblems(declared)).toEqual([]);
    expect(
      configurationProblems(declared, effective).map(problem => problem.path)
    ).toEqual(["collections[0].fields"]);
  });
});

describe("a collection defineCollection finds a problem in", () => {
  // It is normalized all the same: a plugin's setup may repair the problem, and the collection
  // it leaves must be the one an equivalent valid declaration gives, system fields and all.
  it("is returned normalized, with its system fields", () => {
    const declared = defineCollection({ slug: "notes", fields: [] });

    expect(
      declared.fields.map(field => (field as { name?: string }).name)
    ).toEqual(["title", "slug"]);
    expect(declared.labels).toMatchObject({ singular: "Notes" });
  });
});

describe("an entity declared with no fields, through its define function", () => {
  // The system fields its function adds are not the author's: judged without them, a collection
  // breaks the rule that it declare a field, as it did when `defineCollection` threw.
  it("is reported for a collection, its system fields still added", () => {
    const declared = {
      collections: [defineCollection({ slug: "notes", fields: [] })],
    };

    expect(configurationProblems(declared)).toContainEqual(
      expect.objectContaining({
        path: "collections[0].fields",
        code: "FIELDS_EMPTY",
      })
    );
    expect(
      declared.collections[0].fields.map(
        field => (field as { name?: string }).name
      )
    ).toEqual(["title", "slug"]);
  });

  // A Single may declare no fields of its own (its rules never refused one, and `defineSingle`
  // never threw on it), so judging it without its system fields finds nothing.
  it("is accepted for a Single, as it always was", () => {
    const declared = {
      singles: [defineSingle({ slug: "home", fields: [] })],
    };

    expect(configurationProblems(declared)).toEqual([]);
    expect(
      declared.singles[0].fields.map(field => (field as { name?: string }).name)
    ).toEqual(["title", "slug"]);
  });

  it("is not reported once a plugin's setup gives it a field", () => {
    const declared = {
      collections: [defineCollection({ slug: "notes", fields: [] })],
    };
    const [notes] = declared.collections;
    const effective = {
      collections: [
        { ...notes, fields: [...notes.fields, { name: "body", type: "text" }] },
      ],
    };

    expect(configurationProblems(declared, effective)).toEqual([]);
  });
});

describe("an app's entity a plugin's setup renamed", () => {
  // Followed from the copy a setup is handed to the entity it returns, rather than by its slug,
  // which the setup may change: the renamed entity is the one the commands use.
  it("is judged as the setup left it, at the place the app declared it", () => {
    const declared = {
      collections: [
        { slug: "Blog Posts", fields: [{ name: "body", type: "text" }] },
      ],
    };
    const handed = setupTransformerInput(declared, []);
    const effective = {
      collections: handed.collections.map(entity => ({
        ...entity,
        slug: "blog-posts",
      })),
    };

    expect(
      configurationProblems(declared).map(problem => problem.path)
    ).toEqual(["collections[0].slug"]);
    expect(configurationProblems(declared, effective)).toEqual([]);
  });
});

describe("a field with no type", () => {
  // The entity's own rules name it (`FIELD_TYPE_REQUIRED`); the field-type check, which asks only
  // whether something offers a type that was given, leaves it to them, so it is counted once.
  it.each([
    ["no type", { name: "score" }],
    ["an empty type", { name: "score", type: "" }],
  ])("with %s is reported once", (_, field) => {
    const problems = configurationProblems({
      collections: [
        { slug: "notes", fields: [{ name: "body", type: "text" }, field] },
      ],
    });

    expect(problems.map(problem => `${problem.path} ${problem.code}`)).toEqual([
      "collections[0].fields[1].type FIELD_TYPE_REQUIRED",
    ]);
  });
});

describe("a define* collection a plugin's setup gives a field of a system field's name", () => {
  // The setup's own `title` stands beside the one `defineCollection` added, so the collection
  // declares that column twice; the system field is known by what it is, not by its name.
  it("is reported as declaring the field twice", () => {
    const declared = {
      collections: [
        defineCollection({
          slug: "notes",
          fields: [{ name: "body", type: "text" }],
        }),
      ],
    };
    const [notes] = setupTransformerInput(declared, []).collections;
    const effective = {
      collections: [
        {
          ...notes,
          fields: [{ name: "title", type: "text" }, ...notes.fields],
        },
      ],
    };

    expect(
      configurationProblems(declared, effective).map(problem => problem.path)
    ).toEqual(["collections[0].fields"]);
  });
});

describe("a define* collection with no fields, copied for the plugins' setups", () => {
  // The copy a setup is handed keeps which of its fields are the system ones.
  it("is still reported as declaring no field of its own", () => {
    const declared = {
      collections: [defineCollection({ slug: "notes", fields: [] })],
    };
    const effective = setupTransformerInput(declared, []);

    expect(configurationProblems(declared, effective)).toContainEqual(
      expect.objectContaining({
        path: "collections[0].fields",
        code: "FIELDS_EMPTY",
      })
    );
  });
});

describe("a define* collection with no fields, whose fields a plugin's setup copies", () => {
  // A setup that rebuilds each field (`{ ...field }`) still hands back the system ones.
  it("is still reported as declaring no field of its own", () => {
    const declared = {
      collections: [defineCollection({ slug: "notes", fields: [] })],
    };
    const [notes] = setupTransformerInput(declared, []).collections;
    const effective = {
      collections: [
        { ...notes, fields: notes.fields.map(field => ({ ...field })) },
      ],
    };

    expect(configurationProblems(declared, effective)).toContainEqual(
      expect.objectContaining({
        path: "collections[0].fields",
        code: "FIELDS_EMPTY",
      })
    );
  });
});

describe("a define* collection with no fields of its own, whose address is its system slug", () => {
  // The address rule wraps the system `slug` it names; the wrapped field is still the one the
  // call added, so the collection still declares no field of its own.
  it("is still reported as declaring no field of its own", () => {
    const declared = {
      collections: [
        defineCollection({
          slug: "posts",
          fields: [],
          publicAddressField: "slug",
        }),
      ],
    };

    expect(configurationProblems(declared)).toContainEqual(
      expect.objectContaining({
        path: "collections[0].fields",
        code: "FIELDS_EMPTY",
      })
    );
  });
});

describe("two collections with one slug, judged where nothing transformed them", () => {
  // Each is judged as itself: the second's own problem is reported beside the duplicate slug.
  it("reports the second one's own problem too", () => {
    const declared = {
      collections: [
        { slug: "notes", fields: [{ name: "body", type: "text" }] },
        { slug: "notes", fields: [{ name: "select", type: "text" }] },
      ],
    };

    const paths = configurationProblems(declared, declared).map(
      problem => problem.path
    );

    expect(paths).toContain("collections[1].fields[0].name");
    expect(paths).toContain("collections[1].slug");
  });
});

describe("a define* collection whose own field of a system field's name takes no column", () => {
  // A column-less `Title` leaves the `title` column free, so `defineCollection` adds its system
  // `title` beside it: the two do not declare one column twice, and the collection is valid.
  it("has no problem", () => {
    const declared = {
      collections: [
        defineCollection({
          slug: "posts",
          fields: [
            { name: "headline", type: "text" },
            { name: "Title", type: "text", virtual: true } as never,
          ],
        }),
      ],
    };

    expect(configurationProblems(declared)).toEqual([]);
  });
});

describe("a define* collection given a second copy of its system title by a plugin's setup", () => {
  // One copy is the system field; the other declares the same column again.
  it("is reported as declaring the column twice", () => {
    const declared = {
      collections: [
        defineCollection({
          slug: "notes",
          fields: [{ name: "body", type: "text" }],
        }),
      ],
    };
    const [notes] = setupTransformerInput(declared, []).collections;
    const effective = {
      collections: [
        { ...notes, fields: [...notes.fields, { ...notes.fields[0] }] },
      ],
    };

    expect(configurationProblems(declared, effective)).toContainEqual(
      expect.objectContaining({
        path: "collections[0].fields",
        code: "FIELD_NAME_DUPLICATE",
      })
    );
  });
});

describe("a define* collection whose index names its system slug", () => {
  // The index resolves its fields among those the collection has, the system ones included.
  it("has no problem", () => {
    const declared = {
      collections: [
        defineCollection({
          slug: "posts",
          fields: [{ name: "locale", type: "text" }],
          indexes: [{ fields: ["slug", "locale"] }],
        } as never),
      ],
    };

    expect(configurationProblems(declared)).toEqual([]);
  });
});

describe("a define* entity whose own top-level field takes a system field's exact name but no column", () => {
  // Such a field leaves the column free, so `define*` adds its own text field of the same name
  // beside it, and both answer to that name. Each column-less kind is refused, naming the field
  // and saying to rename it.
  const columnLess: ReadonlyArray<[string, Record<string, unknown>]> = [
    ["a component", { type: "component", component: "seo" }],
    [
      "a many-to-many",
      {
        type: "relationship",
        relationTo: "tags",
        options: { relationType: "manyToMany" },
      },
    ],
    ["a virtual field", { type: "text", virtual: true }],
  ];

  for (const [kind, shape] of columnLess) {
    for (const name of ["title", "slug"]) {
      it(`is refused for ${kind} named '${name}' on a collection`, () => {
        const declared = {
          collections: [
            defineCollection({
              slug: "posts",
              fields: [
                { name: "body", type: "text" },
                { name, ...shape } as never,
              ],
            }),
          ],
        };

        const problems = configurationProblems(declared);
        expect(problems).toEqual([
          expect.objectContaining({
            path: "collections[0].fields[3].name",
            code: "FIELD_NAME_RESERVED",
            declaredByDefine: true,
          }),
        ]);
        expect(problems[0].message).toContain(`Field '${name}'`);
        expect(problems[0].message).toContain("Rename it");
      });

      it(`is refused for ${kind} named '${name}' on a Single`, () => {
        const declared = {
          singles: [
            defineSingle({
              slug: "home",
              fields: [{ name, ...shape } as never],
            }),
          ],
        };

        expect(configurationProblems(declared)).toEqual([
          expect.objectContaining({
            path: "singles[0].fields[2].name",
            code: "FIELD_NAME_RESERVED",
            declaredByDefine: true,
          }),
        ]);
      });
    }
  }

  it("is refused when a plugin's setup adds it", () => {
    const declared = {
      collections: [
        defineCollection({
          slug: "notes",
          fields: [{ name: "body", type: "text" }],
        }),
      ],
    };
    const [notes] = setupTransformerInput(declared, []).collections;
    const effective = {
      collections: [
        {
          ...notes,
          fields: [
            ...notes.fields,
            { name: "slug", type: "component", component: "seo" },
          ],
        },
      ],
    };

    expect(configurationProblems(declared, effective)).toEqual([
      expect.objectContaining({
        path: "collections[0].fields[3].name",
        code: "FIELD_NAME_RESERVED",
      }),
    ]);
  });

  // A group with no name only lays fields out: the fields inside it are stored at the top level
  // under their own names (`fieldsStoredOnRow`, the view `define*` decides by), so one there
  // shares the system field's key as one beside it would.
  it("is refused inside a group with no name", () => {
    const declared = {
      collections: [
        defineCollection({
          slug: "posts",
          fields: [
            {
              type: "group",
              fields: [{ name: "slug", type: "component", component: "seo" }],
            },
          ] as never,
        }),
      ],
    };

    expect(configurationProblems(declared)).toContainEqual(
      expect.objectContaining({
        path: "collections[0].fields[2].fields[0].name",
        code: "FIELD_NAME_RESERVED",
      })
    );
  });

  // An entry that is not a field is the entity validators' to report; this check passes it by.
  it("passes by an entry that is not a field, which a plugin's setup adds", () => {
    const declared = {
      collections: [
        defineCollection({
          slug: "notes",
          fields: [{ name: "body", type: "text" }],
        }),
      ],
    };
    const [notes] = setupTransformerInput(declared, []).collections;
    const effective = {
      collections: [{ ...notes, fields: [...notes.fields, null] }],
    };

    expect(
      configurationProblems(declared, effective as never).map(
        problem => problem.code
      )
    ).not.toContain("FIELD_NAME_RESERVED");
  });

  // A name of another letter case is another document key, and a field inside a named group
  // lives under the group's key: neither shares one with the system field.
  it("is accepted when the name differs in case or the field is in a named group", () => {
    const declared = {
      collections: [
        defineCollection({
          slug: "posts",
          fields: [
            { name: "Slug", type: "component", component: "seo" },
            {
              name: "meta",
              type: "group",
              fields: [{ name: "slug", type: "component", component: "seo" }],
            },
          ] as never,
        }),
      ],
    };

    expect(configurationProblems(declared)).toEqual([]);
  });
});

/** `declared` as a plugin's setup leaves it, the setup changing the fields of its one entity. */
function afterSetup<E extends { fields: unknown }>(
  kind: "collections" | "singles" | "fieldGroups",
  entity: E,
  change: (fields: Array<Record<string, unknown>>) => unknown[],
  settings: Record<string, unknown> = {}
) {
  const declared = { [kind]: [entity] } as Record<string, E[]>;
  const [copy] = setupTransformerInput(declared, [])[kind];
  return {
    declared,
    effective: {
      [kind]: [
        {
          ...copy,
          ...settings,
          fields: change(copy.fields as Array<Record<string, unknown>>),
        },
      ],
    },
  };
}

const componentNamed = (name: string) => ({
  name,
  type: "component",
  component: "seo",
});

const manyToManyNamed = (name: string) => ({
  name,
  type: "relationship",
  relationTo: "tags",
  options: { relationType: "manyToMany" },
});

const without = (fields: Array<Record<string, unknown>>, name: string) =>
  fields.filter(field => field.name !== name);

const FROM_SETUP = "A plugin's setup left the field this way";

describe("a define* entity a plugin's setup leaves with a column-less field of a system column's name", () => {
  // The table carries the system column wherever no field left holds it, whatever became of the
  // field `define*` added, so the names are those the fields left would be given.
  const posts = () =>
    defineCollection({
      slug: "posts",
      fields: [{ name: "body", type: "text" }],
    });

  const reserved = (path: string) => [
    expect.objectContaining({
      path,
      code: "FIELD_NAME_RESERVED",
      declaredByDefine: true,
    }),
  ];

  for (const [kind, named] of [
    ["a component", componentNamed],
    ["a many-to-many", manyToManyNamed],
  ] as const) {
    it(`is refused where the setup removed the system slug and added ${kind}`, () => {
      const { declared, effective } = afterSetup(
        "collections",
        posts(),
        fields => [...without(fields, "slug"), named("slug")]
      );
      const problems = configurationProblems(declared, effective);
      expect(problems).toEqual(reserved("collections[0].fields[2].name"));
      expect(problems[0].message).toContain("Field 'slug'");
      expect(problems[0].message).toContain("no entry could be created");
      expect(problems[0].message).toContain(FROM_SETUP);
    });

    it(`is refused where the setup removed both system fields and added ${kind}`, () => {
      const { declared, effective } = afterSetup(
        "collections",
        posts(),
        fields => [
          ...without(without(fields, "slug"), "title"),
          named("slug"),
          named("title"),
        ]
      );
      expect(
        configurationProblems(declared, effective).map(
          problem => `${problem.path} ${problem.code}`
        )
      ).toEqual([
        "collections[0].fields[1].name FIELD_NAME_RESERVED",
        "collections[0].fields[2].name FIELD_NAME_RESERVED",
      ]);
    });

    it(`is refused on a Single where the setup swapped the system title for ${kind}`, () => {
      const { declared, effective } = afterSetup(
        "singles",
        defineSingle({
          slug: "home",
          fields: [{ name: "body", type: "text" }],
        }),
        fields => [...without(fields, "title"), named("title")]
      );
      const problems = configurationProblems(declared, effective);
      expect(problems).toEqual(reserved("singles[0].fields[2].name"));
      expect(problems[0].message).toContain("hidden");
    });
  }

  it("is refused where the author's own text slug was swapped for a component", () => {
    const { declared, effective } = afterSetup(
      "collections",
      defineCollection({
        slug: "posts",
        fields: [
          { name: "title", type: "text" },
          { name: "slug", type: "text" },
        ],
      }),
      fields => [...without(fields, "slug"), componentNamed("slug")]
    );
    expect(configurationProblems(declared, effective)).toEqual(
      reserved("collections[0].fields[1].name")
    );
  });

  it("is refused where the author declared the component and the setup removed the system slug, with no word of a setup", () => {
    const { declared, effective } = afterSetup(
      "collections",
      defineCollection({
        slug: "posts",
        fields: [
          { name: "body", type: "text" },
          componentNamed("slug") as never,
        ],
      }),
      fields => fields.filter(f => !(f.name === "slug" && f.type === "text"))
    );
    const problems = configurationProblems(declared, effective);
    expect(problems).toEqual(reserved("collections[0].fields[2].name"));
    expect(problems[0].message).not.toContain(FROM_SETUP);
  });

  // A virtual field keeps no column, and its type is applied to the value of the system column of
  // its name on a write, so every type is refused.
  it.each(["text", "number", "date", "json"])(
    "is refused where the setup made the system slug or title virtual in place (%s)",
    type => {
      for (const name of ["slug", "title"]) {
        const collection = afterSetup("collections", posts(), fields =>
          fields.map(field =>
            field.name === name ? { ...field, type, virtual: true } : field
          )
        );
        const problems = configurationProblems(
          collection.declared,
          collection.effective
        );
        expect(problems).toEqual(
          reserved(`collections[0].fields[${name === "title" ? 0 : 1}].name`)
        );
        expect(problems[0].message).toContain("its type would be applied");
        expect(problems[0].message).not.toContain("no entry could be created");
        expect(problems[0].message).toContain(FROM_SETUP);

        const single = afterSetup(
          "singles",
          defineSingle({
            slug: "home",
            fields: [{ name: "body", type: "text" }],
          }),
          fields =>
            fields.map(field =>
              field.name === name ? { ...field, type, virtual: true } : field
            )
        );
        expect(
          configurationProblems(single.declared, single.effective)
        ).toEqual(
          reserved(`singles[0].fields[${name === "title" ? 0 : 1}].name`)
        );
      }
    }
  );

  it("is accepted where the setup removed the system slug and added nothing, or replaced it with a text one", () => {
    for (const change of [
      (fields: Array<Record<string, unknown>>) => without(fields, "slug"),
      (fields: Array<Record<string, unknown>>) => [
        ...without(fields, "slug"),
        { name: "slug", type: "text", label: "Address" },
      ],
    ]) {
      const { declared, effective } = afterSetup(
        "collections",
        posts(),
        change
      );
      expect(configurationProblems(declared, effective)).toEqual([]);
    }
  });

  it("is accepted on a field group, which has no system title or slug", () => {
    const group = defineFieldGroup({
      slug: "card",
      fields: [
        { name: "body", type: "text" },
        componentNamed("title") as never,
      ],
    });
    const { declared, effective } = afterSetup("fieldGroups", group, fields => [
      ...fields,
      { name: "slug", type: "text", virtual: true },
    ]);
    expect(configurationProblems({ fieldGroups: [group] })).toEqual([]);
    expect(configurationProblems(declared, effective)).toEqual([]);
  });

  it("leaves an entity no define* function declared to its own checks, as a Builder definition is judged", () => {
    const entity = {
      slug: "posts",
      fields: [{ name: "body", type: "text" }, componentNamed("slug")],
    };
    expect(
      configurationProblems({ collections: [entity], singles: [entity] }).map(
        problem => problem.code
      )
    ).not.toContain("FIELD_NAME_RESERVED");
  });
});

describe("the names a define* entity's fields may not take without a column", () => {
  // The check asks `systemFieldsBeside`; the migrations and the runtime schema ask
  // `systemColumnsForFields`. Two answers would let a name through or refuse one for nothing.
  const lists: Array<[string, Array<Record<string, unknown>>]> = [
    ["neither", [{ name: "body", type: "text" }]],
    ["a text slug", [{ name: "slug", type: "text" }]],
    ["a text Title", [{ name: "Title", type: "text" }]],
    ["a component slug", [componentNamed("slug")]],
    ["a many-to-many title", [manyToManyNamed("title")]],
    ["a virtual slug", [{ name: "slug", type: "text", virtual: true }]],
    [
      "a slug inside a group with no name",
      [{ type: "group", fields: [{ name: "slug", type: "text" }] }],
    ],
    [
      "a slug inside a named group",
      [
        {
          name: "meta",
          type: "group",
          fields: [{ name: "slug", type: "text" }],
        },
      ],
    ],
  ];

  for (const dialect of ["sqlite", "postgresql", "mysql"] as const) {
    it.each(lists)(
      `are the system columns %s leaves on ${dialect}`,
      (_, fields) => {
        const columns = systemColumnsForFields(fields as never, dialect, {
          hasStatus: false,
          isSingle: false,
          builtBy: "codeFirst",
        } as never)
          .map(column => column.name)
          .filter(name => name === "title" || name === "slug");
        expect(
          systemFieldsBeside(fields as never).map(field => field.name)
        ).toEqual(columns);
      }
    );
  }
});

describe("a define* collection of files whose file field takes no column", () => {
  const docs = (fields: unknown[] = [{ name: "body", type: "text" }]) =>
    defineCollection({
      slug: "docs",
      files: {
        visibility: "private",
        accept: ["application/pdf"],
        maxSize: 1000,
      },
      fields: fields as never,
    });

  const refused = (path: string) => [
    expect.objectContaining({
      path,
      code: "FIELD_NAME_RESERVED",
      message: expect.stringMatching(
        /^Field 'storageKey' .*a collection of files keeps .*Rename it\./
      ),
    }),
  ];

  // The same answer whether or not a plugin's setup was handed a copy of the collection.
  it.each([false, true])(
    "is refused for one beside Nextly's own, saying to rename it (a setup ran: %s)",
    ran => {
      const entity = docs([
        { name: "body", type: "text" },
        componentNamed("storageKey"),
      ]);
      const { declared, effective } = afterSetup(
        "collections",
        entity,
        fields => fields
      );
      const problems = configurationProblems(
        declared,
        ran ? effective : undefined
      );
      expect(problems).toEqual(refused("collections[0].fields[13].name"));
      expect(problems[0].message).not.toContain("to replace Nextly's");
      expect(problems[0].message).not.toContain(FROM_SETUP);
    }
  );

  it.each([
    ["swapped for a component", () => componentNamed("storageKey")],
    [
      "made virtual",
      (field: Record<string, unknown>) => ({ ...field, virtual: true }),
    ],
  ])("is refused where a setup's field was %s", (_, left) => {
    const { declared, effective } = afterSetup("collections", docs(), fields =>
      fields.map(field =>
        field.name === "storageKey"
          ? (left as (f: typeof field) => unknown)(field)
          : field
      )
    );
    const problems = configurationProblems(declared, effective);
    expect(problems).toEqual(refused("collections[0].fields[6].name"));
    expect(problems[0].message).toContain(FROM_SETUP);
  });

  it("is accepted as declared, with and without a setup's copy", () => {
    const { declared, effective } = afterSetup(
      "collections",
      docs(),
      fields => fields
    );
    expect(configurationProblems(declared)).toEqual([]);
    expect(configurationProblems(declared, effective)).toEqual([]);
  });

  it("is accepted for the same name on a collection with no files", () => {
    const entity = defineCollection({
      slug: "posts",
      fields: [
        { name: "body", type: "text" },
        componentNamed("storageKey") as never,
      ],
    });
    expect(configurationProblems({ collections: [entity] })).toEqual([]);
  });
});
