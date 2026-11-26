/**
 * The configuration's load reports every problem in the app's entities, including one that the
 * steps before it would otherwise trip over: an entity with no slug, or a slug that is not a
 * string, reaches the check rather than stopping the load with a TypeError.
 */
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearFieldTypes,
  hasFieldType,
  registerFieldType,
} from "../../../domains/schema/field-types/field-type-registry";
import { clearConfigCache, loadConfig } from "../config-loader";

const exported = vi.hoisted(() => ({ config: {} as unknown }));

vi.mock("../config-bundler", () => ({
  bundleAndRequire: async () => ({
    mod: { default: exported.config },
    dependencies: [],
  }),
}));

const made: string[] = [];

afterEach(() => {
  clearConfigCache();
  for (const dir of made.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function project(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "nextly-config-gate-")));
  made.push(dir);
  writeFileSync(join(dir, "nextly.config.mjs"), "export default {};\n");
  return dir;
}

describe("an entity with no slug, or one that is not a string", () => {
  it.each([
    ["no slug", { fields: [{ name: "title", type: "text" }] }],
    [
      "a number for a slug",
      { slug: 7, fields: [{ name: "title", type: "text" }] },
    ],
  ])("with %s is reported with the rest, not thrown over", async (_, entry) => {
    exported.config = {
      collections: [
        entry,
        { slug: "Blog Posts", fields: [{ name: "title", type: "text" }] },
      ],
      singles: [{ fields: [{ name: "heading", type: "text" }] }],
    };

    const refused = await loadConfig({ cwd: project() }).then(
      () => undefined,
      (error: unknown) => error
    );

    expect(refused).toMatchObject({
      code: "VALIDATION_ERROR",
      logContext: { reason: "config-invalid" },
    });
    const paths = (
      (refused as { publicData?: { errors?: Array<{ path?: string }> } })
        .publicData?.errors ?? []
    ).map(problem => problem.path);
    expect(paths).toContain("collections[0].slug");
    expect(paths).toContain("collections[1].slug");
    expect(paths).toContain("singles[0].slug");
  });
});

describe("a public address its own rule refuses, beside another problem", () => {
  // The address is judged with the entity's other rules, so it is listed with every other
  // problem rather than stopping the load before them.
  it("is reported with the rest", async () => {
    exported.config = {
      collections: [
        {
          slug: "posts",
          fields: [{ name: "title", type: "text" }],
          publicAddress: "/blog",
        },
        { slug: "Blog Posts", fields: [{ name: "title", type: "text" }] },
      ],
    };

    const refused = await loadConfig({ cwd: project() }).then(
      () => undefined,
      (error: unknown) => error
    );

    expect(refused).toMatchObject({
      code: "VALIDATION_ERROR",
      logContext: { reason: "config-invalid" },
    });
    const paths = (
      (refused as { publicData?: { errors?: Array<{ path?: string }> } })
        .publicData?.errors ?? []
    ).map(problem => problem.path);
    expect(paths).toContain("collections[0].publicAddress");
    expect(paths).toContain("collections[1].slug");
  });
});

describe("an app's entity a plugin's setup repairs by renaming it", () => {
  // The commands use the entity the setup returned, so that is the one judged.
  it("loads, judged as the setup left it", async () => {
    exported.config = {
      collections: [
        { slug: "Blog Posts", fields: [{ name: "body", type: "text" }] },
      ],
      plugins: [
        {
          name: "@test/renames",
          version: "1.0.0",
          nextly: "*",
          setup: (config: { collections?: Array<{ slug?: string }> }) => ({
            ...config,
            collections: (config.collections ?? []).map(entity => ({
              ...entity,
              slug: "blog-posts",
            })),
          }),
        },
      ],
    };

    const loaded = await loadConfig({ cwd: project() });

    expect(loaded.config.collections?.map(entity => entity.slug)).toContain(
      "blog-posts"
    );
  });
});

describe("a configuration cached from one project", () => {
  // A long-lived process that loaded one project's configuration is no answer for another
  // project, which a caller that reads the entities would then act on with the first one's.
  it("is not given for another project that has none, where the caller refuses one", async () => {
    exported.config = {
      collections: [
        { slug: "notes", fields: [{ name: "body", type: "text" }] },
      ],
    };
    await loadConfig({ cwd: project() });
    const other = realpathSync(
      mkdtempSync(join(tmpdir(), "nextly-config-gate-other-"))
    );
    made.push(other);

    const refused = await loadConfig({ cwd: other, missing: "refuse" }).then(
      () => undefined,
      (error: unknown) => error
    );

    expect(refused).toMatchObject({
      logContext: { reason: "config-missing" },
    });
  });
});

describe("a rule across entities, broken beside another problem", () => {
  // `defineConfig` judges these across the whole configuration. Each is reported with every other
  // problem, at its place, rather than stopping the load before them.
  const text = (name: string) => ({ name, type: "text" });
  const BAD = { slug: "Blog Posts", fields: [text("title")] };
  it.each([
    [
      "two collections with one slug",
      {
        collections: [
          { slug: "notes", fields: [text("body")] },
          { slug: "notes", fields: [text("body")] },
          BAD,
        ],
      },
      ["collections[1].slug", "collections[2].slug"],
    ],
    [
      "two Singles at one address",
      {
        collections: [BAD],
        singles: [
          { slug: "home", fields: [text("heading")], publicAddress: "/" },
          { slug: "landing", fields: [text("heading")], publicAddress: "/" },
        ],
      },
      ["collections[0].slug", "singles[1].publicAddress"],
    ],
    [
      "two field groups whose slugs make one table",
      {
        collections: [BAD],
        fieldGroups: [
          { slug: "foo-bar", fields: [text("a")] },
          { slug: "foo--bar", fields: [text("a")] },
        ],
      },
      ["collections[0].slug", "fieldGroups[1].slug"],
    ],
    [
      "field groups that place each other in a cycle",
      {
        collections: [BAD],
        fieldGroups: [
          {
            slug: "hero",
            fields: [{ name: "card", type: "component", component: "card" }],
          },
          {
            slug: "card",
            fields: [{ name: "hero", type: "component", component: "hero" }],
          },
        ],
      },
      ["collections[0].slug", "fieldGroups[0].fields"],
    ],
  ])("as %s, is reported with the rest", async (_, config, expected) => {
    exported.config = config;

    const refused = await loadConfig({ cwd: project() }).then(
      () => undefined,
      (error: unknown) => error
    );

    expect(refused).toMatchObject({
      code: "VALIDATION_ERROR",
      logContext: { reason: "config-invalid" },
    });
    const paths = (
      (refused as { publicData?: { errors?: Array<{ path?: string }> } })
        .publicData?.errors ?? []
    ).map(problem => problem.path);
    for (const path of expected)
      expect(paths, paths.join("\n")).toContain(path);
  });
});

describe("a configuration cached from a file named with -c, since removed", () => {
  // The file `-c` names must still be there for its cached configuration to answer a caller that
  // refuses a missing one.
  it("is not given where the caller refuses a missing one", async () => {
    exported.config = {
      collections: [
        { slug: "notes", fields: [{ name: "body", type: "text" }] },
      ],
    };
    const cwd = project();
    writeFileSync(join(cwd, "custom.config.mjs"), "export default {};\n");
    await loadConfig({ cwd, configPath: "custom.config.mjs" });
    rmSync(join(cwd, "custom.config.mjs"));

    const refused = await loadConfig({
      cwd,
      configPath: "custom.config.mjs",
      missing: "refuse",
    }).then(
      () => undefined,
      (error: unknown) => error
    );

    expect(refused).toMatchObject({
      logContext: { reason: "config-not-found" },
    });
  });
});

describe("a configuration cached from one project, asked for by a caller that keeps the default", () => {
  // Another project's configuration is no answer for this one, whether or not the caller refuses
  // a missing one: a blank migration would otherwise be written where the first project puts them.
  it("is not given for another project that has none", async () => {
    exported.config = {
      collections: [
        { slug: "notes", fields: [{ name: "body", type: "text" }] },
      ],
    };
    await loadConfig({ cwd: project() });
    const other = realpathSync(
      mkdtempSync(join(tmpdir(), "nextly-config-gate-other-"))
    );
    made.push(other);

    const loaded = await loadConfig({ cwd: other });

    expect(loaded.configPath).toBeUndefined();
    expect(loaded.config.collections ?? []).toEqual([]);
  });
});

describe("a Builder definition with a problem the same rules refuse", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Judged as the configuration's entities are, at its place in the definition file. A command
  // that reads the entities refuses it with the rest; a running site is told of it and goes on.
  const withDefinitions = () => {
    const cwd = project();
    writeFileSync(
      join(cwd, "ui-schema.json"),
      JSON.stringify({
        collections: [
          {
            slug: "cases",
            fields: [
              { name: "body", type: "text" },
              { name: "body", type: "text" },
            ],
          },
        ],
        singles: [],
        components: [],
      })
    );
    return cwd;
  };

  it("is refused, at its place in the file, by a command that reads the entities", async () => {
    exported.config = {
      collections: [
        { slug: "notes", fields: [{ name: "body", type: "text" }] },
      ],
    };

    const refused = await loadConfig({
      cwd: withDefinitions(),
      missing: "refuse",
    }).then(
      () => undefined,
      (error: unknown) => error
    );

    expect(refused).toMatchObject({
      code: "VALIDATION_ERROR",
      logContext: { reason: "config-invalid" },
    });
    const paths = (
      (refused as { publicData?: { errors?: Array<{ path?: string }> } })
        .publicData?.errors ?? []
    ).map(problem => problem.path);
    expect(paths).toEqual(["ui-schema.json collections[0].fields"]);
  });

  it("is warned of, and the configuration loads, where the caller keeps the default", async () => {
    exported.config = {
      collections: [
        { slug: "notes", fields: [{ name: "body", type: "text" }] },
      ],
    };
    const warned: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((...parts: unknown[]) => {
      warned.push(parts.map(String).join(" "));
    });

    const loaded = await loadConfig({ cwd: withDefinitions() });

    expect(loaded.configPath).toBeDefined();
    expect(
      warned.some(line =>
        line.includes("ui-schema.json collections[0].fields")
      ),
      warned.join("\n")
    ).toBe(true);
  });
});

describe("a Builder definition file the load cannot read", () => {
  // A file with an entry the definition format refuses (here, one with no slug) cannot be read
  // into entities at all; a command that reads the entities says so with the rest.
  it("is refused, naming the file, by a command that reads the entities", async () => {
    exported.config = {
      collections: [
        { slug: "notes", fields: [{ name: "body", type: "text" }] },
      ],
    };
    const cwd = project();
    writeFileSync(
      join(cwd, "ui-schema.json"),
      JSON.stringify({
        collections: [{ fields: [] }],
        singles: [],
        components: [],
      })
    );

    const refused = await loadConfig({ cwd, missing: "refuse" }).then(
      () => undefined,
      (error: unknown) => error
    );

    expect(refused).toMatchObject({
      code: "VALIDATION_ERROR",
      logContext: { reason: "config-invalid" },
    });
    const paths = (
      (refused as { publicData?: { errors?: Array<{ path?: string }> } })
        .publicData?.errors ?? []
    ).map(problem => problem.path);
    expect(paths).toEqual(["ui-schema.json"]);
  });
});

describe("a load that warns of the Builder's problems, then one that refuses them", () => {
  // The cached load warned; a caller that refuses is not answered by it.
  it("refuses on the second load", async () => {
    exported.config = {
      collections: [
        { slug: "notes", fields: [{ name: "body", type: "text" }] },
      ],
    };
    const cwd = project();
    writeFileSync(
      join(cwd, "ui-schema.json"),
      JSON.stringify({
        collections: [
          {
            slug: "cases",
            fields: [
              { name: "body", type: "text" },
              { name: "body", type: "text" },
            ],
          },
        ],
        singles: [],
        components: [],
      })
    );
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await loadConfig({ cwd, builderDefinitions: "warn" });

    const refused = await loadConfig({
      cwd,
      builderDefinitions: "refuse",
    }).then(
      () => undefined,
      (error: unknown) => error
    );
    vi.restoreAllMocks();

    expect(refused).toMatchObject({ logContext: { reason: "config-invalid" } });
  });
});

describe("a Builder definition file the load cannot read, beside a plugin's extend of a Builder entity", () => {
  // The extend's target is in the file that could not be read: the file is the problem named, not
  // a target nothing declares.
  it("is refused at the file", async () => {
    exported.config = {
      collections: [
        { slug: "notes", fields: [{ name: "body", type: "text" }] },
      ],
      plugins: [
        {
          name: "@test/extends",
          version: "1.0.0",
          nextly: "*",
          contributes: {
            extend: [
              { target: "cases", fields: [{ name: "seo", type: "text" }] },
            ],
          },
        },
      ],
    };
    const cwd = project();
    writeFileSync(
      join(cwd, "ui-schema.json"),
      JSON.stringify({
        collections: [{ fields: [] }],
        singles: [],
        components: [],
      })
    );

    const refused = await loadConfig({ cwd, missing: "refuse" }).then(
      () => undefined,
      (error: unknown) => error
    );

    expect(refused).toMatchObject({
      code: "VALIDATION_ERROR",
      logContext: { reason: "config-invalid" },
    });
    const paths = (
      (refused as { publicData?: { errors?: Array<{ path?: string }> } })
        .publicData?.errors ?? []
    ).map(problem => problem.path);
    expect(paths).toEqual(["ui-schema.json"]);
  });
});

describe("a Builder definition with a problem, in a project with no configuration file", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The default configuration is loaded, and the Builder's definitions beside it are judged as
  // they are beside a configuration file.
  const withoutConfig = () => {
    const dir = realpathSync(
      mkdtempSync(join(tmpdir(), "nextly-config-gate-bare-"))
    );
    made.push(dir);
    writeFileSync(
      join(dir, "ui-schema.json"),
      JSON.stringify({
        collections: [
          {
            slug: "cases",
            fields: [
              { name: "body", type: "text" },
              { name: "body", type: "text" },
            ],
          },
        ],
        singles: [],
        components: [],
      })
    );
    return dir;
  };

  it("is refused, at its place in the file, where the caller refuses the Builder's problems", async () => {
    const refused = await loadConfig({
      cwd: withoutConfig(),
      builderDefinitions: "refuse",
    }).then(
      () => undefined,
      (error: unknown) => error
    );

    expect(refused).toMatchObject({
      code: "VALIDATION_ERROR",
      logContext: { reason: "config-invalid" },
    });
    const paths = (
      (refused as { publicData?: { errors?: Array<{ path?: string }> } })
        .publicData?.errors ?? []
    ).map(problem => problem.path);
    expect(paths).toEqual(["ui-schema.json collections[0].fields"]);
  });

  it("is warned of, and the default configuration loads, where the caller keeps the default", async () => {
    const warned: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((...parts: unknown[]) => {
      warned.push(parts.map(String).join(" "));
    });

    const loaded = await loadConfig({ cwd: withoutConfig() });

    expect(loaded.configPath).toBeUndefined();
    expect(
      warned.some(line =>
        line.includes("ui-schema.json collections[0].fields")
      ),
      warned.join("\n")
    ).toBe(true);
  });
});

describe("default configurations of two projects with no configuration file", () => {
  // The cached default is the first project's: the second's definitions are judged, and its root
  // is its own.
  it("judges the second project's definitions, not the first's cached answer", async () => {
    const bare = (prefix: string) => {
      const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
      made.push(dir);
      return dir;
    };
    const first = bare("nextly-config-gate-first-");
    await loadConfig({ cwd: first, builderDefinitions: "refuse" });
    const second = bare("nextly-config-gate-second-");
    writeFileSync(
      join(second, "ui-schema.json"),
      JSON.stringify({
        collections: [
          {
            slug: "cases",
            fields: [
              { name: "body", type: "text" },
              { name: "body", type: "text" },
            ],
          },
        ],
        singles: [],
        components: [],
      })
    );

    const refused = await loadConfig({
      cwd: second,
      builderDefinitions: "refuse",
    }).then(
      () => undefined,
      (error: unknown) => error
    );

    expect(refused).toMatchObject({ logContext: { reason: "config-invalid" } });
  });
});

describe("a default configuration refused for the Builder's definitions", () => {
  afterEach(() => {
    clearFieldTypes();
  });

  // The load installs nothing: the field types the running configuration registered stay.
  it("leaves the registered field types as they were", async () => {
    registerFieldType({ type: "rating", storage: "json" } as Parameters<
      typeof registerFieldType
    >[0]);
    const dir = realpathSync(
      mkdtempSync(join(tmpdir(), "nextly-config-gate-registry-"))
    );
    made.push(dir);
    writeFileSync(
      join(dir, "ui-schema.json"),
      JSON.stringify({
        collections: [
          {
            slug: "cases",
            fields: [
              { name: "body", type: "text" },
              { name: "body", type: "text" },
            ],
          },
        ],
        singles: [],
        components: [],
      })
    );

    const refused = await loadConfig({
      cwd: dir,
      builderDefinitions: "refuse",
    }).then(
      () => undefined,
      (error: unknown) => error
    );

    expect(refused).toMatchObject({ logContext: { reason: "config-invalid" } });
    expect(hasFieldType("rating")).toBe(true);
  });
});

describe("a Builder definition file the load cannot read, beside a code relationship to a Builder entity", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const unreadable = () => {
    exported.config = {
      collections: [
        {
          slug: "notes",
          fields: [
            { name: "about", type: "relationship", relationTo: "cases" },
          ],
        },
      ],
    };
    const cwd = project();
    writeFileSync(
      join(cwd, "ui-schema.json"),
      JSON.stringify({
        collections: [{ fields: [] }],
        singles: [],
        components: [],
      })
    );
    return cwd;
  };

  // The file may declare the target, so the relationship is not judged: a running site is told
  // of the file and goes on, which leaves the Builder reachable to repair it.
  it("is warned of, and the configuration loads, for a running site", async () => {
    const warned: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((...parts: unknown[]) => {
      warned.push(parts.map(String).join(" "));
    });

    const loaded = await loadConfig({
      cwd: unreadable(),
      missing: "refuse",
      builderDefinitions: "warn",
    });

    expect(loaded.config.collections?.map(entity => entity.slug)).toContain(
      "notes"
    );
    expect(
      warned.filter(line => line.includes("ui-schema.json")),
      warned.join("\n")
    ).toHaveLength(1);
  });

  it("is refused at the file by a command that reads the entities", async () => {
    const refused = await loadConfig({
      cwd: unreadable(),
      missing: "refuse",
    }).then(
      () => undefined,
      (error: unknown) => error
    );

    const paths = (
      (refused as { publicData?: { errors?: Array<{ path?: string }> } })
        ?.publicData?.errors ?? []
    ).map(problem => problem.path);
    expect(paths).toEqual(["ui-schema.json"]);
  });
});

describe("a Builder problem a load warns of, loaded again in the same process", () => {
  // A development start loads the configuration more than once, and a save loads it again: the
  // same problems are said once, and changed ones are said anew.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is said once, and again when an edit changes what is wrong", async () => {
    exported.config = {
      collections: [
        { slug: "notes", fields: [{ name: "body", type: "text" }] },
      ],
    };
    const cwd = project();
    const write = (slug: string) =>
      writeFileSync(
        join(cwd, "ui-schema.json"),
        JSON.stringify({
          collections: [
            { slug: "fine", fields: [{ name: "body", type: "text" }] },
            {
              slug,
              fields: [
                { name: slug, type: "text" },
                { name: slug, type: "text" },
              ],
            },
          ],
          singles: [],
          components: [],
        })
      );
    const warned: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((...parts: unknown[]) => {
      const line = parts.map(String).join(" ");
      if (line.includes("ui-schema.json")) warned.push(line);
    });
    const load = async () => {
      clearConfigCache();
      await loadConfig({ cwd, builderDefinitions: "warn" });
    };

    write("cases");
    await load();
    await load();
    expect(warned).toHaveLength(1);

    write("matters");
    await load();
    expect(warned).toHaveLength(2);

    // Back to the first problem: it changed again, so it is said again.
    write("cases");
    await load();
    expect(warned).toHaveLength(3);
  });
});

describe("a Builder definition file a release saved with a repeater translatable as a whole", () => {
  const marked = () => {
    exported.config = {
      collections: [
        { slug: "notes", fields: [{ name: "body", type: "text" }] },
      ],
    };
    const cwd = project();
    writeFileSync(
      join(cwd, "ui-schema.json"),
      JSON.stringify({
        collections: [
          {
            slug: "cases",
            localized: true,
            fields: [
              {
                name: "rows",
                type: "repeater",
                localized: true,
                fields: [{ name: "inner", type: "text" }],
              },
            ],
          },
        ],
        singles: [],
        components: [],
      })
    );
    return cwd;
  };

  it("is refused, at the field, by a command that reads the entities", async () => {
    const refused = await loadConfig({
      cwd: marked(),
      missing: "refuse",
    }).then(
      () => undefined,
      (error: unknown) => error
    );

    const problems =
      (
        refused as {
          publicData?: { errors?: Array<{ path?: string; code?: string }> };
        }
      )?.publicData?.errors ?? [];
    expect(problems.map(({ path, code }) => [path, code])).toEqual([
      [
        "ui-schema.json collections[0].fields[0].localized",
        "FIELD_STRUCTURE_NOT_TRANSLATABLE",
      ],
    ]);
  });

  it("is warned of, and loads, for a running site", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const loaded = await loadConfig({
      cwd: marked(),
      missing: "refuse",
      builderDefinitions: "warn",
    });
    vi.restoreAllMocks();

    expect(loaded.configPath).toBeDefined();
  });
});
