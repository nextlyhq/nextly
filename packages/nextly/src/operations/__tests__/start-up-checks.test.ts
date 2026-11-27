/**
 * The refusals that stop Nextly from starting: two operations behind one ID or
 * one set of command words, from core or from a plugin, and declarations that
 * break the list's rules on their own.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { NextlyError } from "../../errors/nextly-error";
import type { Door, OperationDefinition, OperationRun } from "../definition";
import { levelForRun } from "../levels";
import { assembleOperationList, type OperationListSources } from "../list";

import { readOperation, settingsSetLike, writeOperation } from "./fixtures";

const SEO_PLUGIN = "@nextlyhq/plugin-seo";

/** The problems assembling `sources` is refused with; fails when it is not refused. */
async function refusal(sources: OperationListSources): Promise<string[]> {
  const error = await assembleOperationList(sources).then(
    () => undefined,
    (thrown: unknown) => thrown
  );
  if (!NextlyError.is(error)) throw new Error("the list was not refused");
  const problems = error.logContext?.problems;
  if (!Array.isArray(problems))
    throw new Error("the refusal lists no problems");
  // The message developers read names the same problems.
  for (const problem of problems)
    expect(error.publicMessage).toContain(String(problem));
  return problems.map(String);
}

function fromPlugin(op: OperationDefinition): OperationDefinition {
  return { ...op, source: { kind: "plugin", name: SEO_PLUGIN } };
}

describe("two operations claiming one name", () => {
  it("refuses two core operations with one ID, naming both sources", async () => {
    const problems = await refusal({
      core: [readOperation(), readOperation({ command: ["posts", "find"] })],
    });
    expect(problems).toEqual([
      'Two operations claim the ID "posts.list": one from core ("nextly posts list") and one from core ("nextly posts find")',
    ]);
  });

  it("refuses two core operations with one set of command words, naming both", async () => {
    const problems = await refusal({
      core: [readOperation(), readOperation({ id: "posts.find" })],
    });
    expect(problems).toEqual([
      'Two operations claim the command words "nextly posts list": "posts.list" from core and "posts.find" from core',
    ]);
  });

  it("refuses a plugin's operation whose ID is a core one's, naming the plugin", async () => {
    const problems = await refusal({
      core: [readOperation()],
      plugins: [
        {
          name: SEO_PLUGIN,
          operations: [fromPlugin(readOperation({ command: ["seo", "list"] }))],
        },
      ],
    });
    expect(problems).toEqual([
      `Two operations claim the ID "posts.list": one from core ("nextly posts list") and one from plugin "${SEO_PLUGIN}" ("nextly seo list")`,
    ]);
  });

  it("refuses a plugin's operation whose command words are a core one's", async () => {
    const problems = await refusal({
      core: [readOperation()],
      plugins: [
        {
          name: SEO_PLUGIN,
          operations: [fromPlugin(readOperation({ id: "seo.list" }))],
        },
      ],
    });
    expect(problems).toEqual([
      `Two operations claim the command words "nextly posts list": "posts.list" from core and "seo.list" from plugin "${SEO_PLUGIN}"`,
    ]);
  });

  it("refuses an old name that is another operation's command", async () => {
    const problems = await refusal({
      core: [
        readOperation(),
        writeOperation({
          aliases: [
            {
              command: ["posts", "list"],
              addedIn: "0.0.2-alpha.90",
              removableFrom: "0.1.0",
            },
          ],
        }),
      ],
    });
    expect(problems).toEqual([
      'Two operations claim the command words "nextly posts list": "posts.list" from core and "posts.publish" from core',
    ]);
  });

  it("assembles distinct operations from core and a plugin (control)", async () => {
    const list = await assembleOperationList({
      core: [
        readOperation(),
        writeOperation({
          aliases: [
            {
              command: ["publish"],
              addedIn: "0.0.2-alpha.90",
              removableFrom: "0.1.0",
            },
          ],
        }),
      ],
      plugins: [
        {
          name: SEO_PLUGIN,
          operations: [
            fromPlugin(
              readOperation({ id: "seo.audit", command: ["seo", "audit"] })
            ),
          ],
        },
      ],
    });
    expect(list.operations.map(op => op.id)).toEqual([
      "posts.list",
      "posts.publish",
      "seo.audit",
    ]);
    expect(list.byCommand(["publish"])?.id).toBe("posts.publish");
    expect(list.byId("seo.audit")?.source).toEqual({
      kind: "plugin",
      name: SEO_PLUGIN,
    });
  });
});

describe("an operation that writes", () => {
  it("is refused without a dry run", async () => {
    const problems = await refusal({
      core: [writeOperation({ dryRun: false })],
    });
    expect(problems).toEqual([
      'Operation "posts.publish" from core: it writes but offers no dry run',
    ]);
  });

  it("is refused without a dry run when only an input raises it above read", async () => {
    const problems = await refusal({
      core: [
        readOperation({
          raise: [{ when: "always", level: "draft", applies: () => true }],
        }),
      ],
    });
    expect(problems).toEqual([
      'Operation "posts.list" from core: it writes but offers no dry run',
    ]);
  });

  it("needs no dry run when it changes only project files on this machine", async () => {
    const list = await assembleOperationList({
      core: [
        writeOperation({
          id: "types.generate",
          command: ["types", "generate"],
          level: "draft",
          doors: ["local"],
          permission: {
            kind: "project",
            reason: "Writes the generated types file in the project.",
          },
          dryRun: false,
        }),
      ],
    });
    expect(list.byId("types.generate")?.dryRun).toBe(false);
  });
});

describe("a level an input could lower", () => {
  it("is refused at registration", async () => {
    const problems = await refusal({
      core: [
        {
          ...settingsSetLike,
          raise: [
            {
              when: "the key is the site title",
              level: "draft",
              applies: () => true,
            },
          ],
        },
      ],
    });
    expect(problems).toEqual([
      'Operation "settings.set" from core: its raise rule "the key is the site title" would lower the level from change to draft; an input may only raise it',
    ]);
  });

  it("is not refused when the rule raises (control)", async () => {
    const list = await assembleOperationList({ core: [settingsSetLike] });
    expect(list.byId("settings.set")?.raise).toHaveLength(1);
  });
});

describe("the doors an operation declares", () => {
  it("refuses an operation that changes project files on the site or chat door", async () => {
    const problems = await refusal({
      core: [
        writeOperation({
          doors: ["local", "site"],
          permission: {
            kind: "project",
            reason: "Writes a file in the project.",
          },
        }),
      ],
    });
    expect(problems).toEqual([
      'Operation "posts.publish" from core: a project operation runs only on local, not site',
    ]);
  });

  it("refuses a maintenance operation on the site door", async () => {
    const problems = await refusal({
      core: [
        writeOperation({
          doors: ["local", "site"],
          permission: { kind: "maintenance", reason: "Repairs columns." },
        }),
      ],
    });
    expect(problems).toEqual([
      'Operation "posts.publish" from core: a maintenance operation runs only on local and deploy, not site',
    ]);
  });

  it("refuses a plugin's operation on the deploy door", async () => {
    const problems = await refusal({
      core: [],
      plugins: [
        {
          name: SEO_PLUGIN,
          operations: [
            fromPlugin(
              readOperation({ id: "seo.audit", doors: ["local", "deploy"] })
            ),
          ],
        },
      ],
    });
    expect(problems).toEqual([
      `Operation "seo.audit" from plugin "${SEO_PLUGIN}": a plugin's operation may not run on the deploy door`,
    ]);
  });

  it("refuses a chat mark on an operation that does not run on the chat door", async () => {
    const problems = await refusal({
      core: [readOperation({ chatExposed: true })],
    });
    expect(problems).toEqual([
      'Operation "posts.list" from core: it is marked as seen by chat apps but does not run on the chat door',
    ]);
  });
});

describe("other rules of a declaration", () => {
  it.each([
    [
      "an operation that says it is core but a plugin registered",
      {
        name: SEO_PLUGIN,
        op: readOperation({ id: "seo.audit", command: ["seo", "audit"] }),
      },
      `it says it comes from core, but plugin "${SEO_PLUGIN}" registered it`,
    ],
    [
      "own-data access claimed by core",
      {
        op: readOperation({
          permission: { kind: "own-data", reason: "Reads its own rows." },
        }),
      },
      "only a plugin's operation may read its own data without a permission",
    ],
    [
      '"Always allow" refused below critical',
      { op: writeOperation({ alwaysAllow: false }) },
      'it refuses "Always allow" but its level is change, not critical',
    ],
    [
      "a read that destroys",
      {
        op: readOperation({
          effects: {
            destroys: true,
            idempotent: true,
            outside: false,
            spendsAi: false,
          },
        }),
      },
      "its level is read but it destroys data",
    ],
    [
      "exit code 5 given another meaning",
      {
        op: readOperation({
          exitCodes: [{ code: 5, meaning: "the cache was cold" }],
        }),
      },
      `it gives exit code 5 a meaning of its own; 5 always means "waiting for a person's approval"`,
    ],
    [
      "an example that does not parse",
      {
        op: readOperation({
          examples: [{ summary: "Too many", input: { limit: 500 } }],
        }),
      },
      'its example "Too many" does not parse against its input schema',
    ],
    [
      "a summary of two lines",
      { op: readOperation({ summary: "List posts\nnewest first" }) },
      "its summary is more than one line",
    ],
    [
      "a command word in upper case",
      { op: readOperation({ command: ["Posts", "list"] }) },
      'its command word "Posts" is not lower case letters, digits and inner hyphens',
    ],
  ] satisfies [string, { name?: string; op: OperationDefinition }, string][])(
    "refuses %s",
    async (
      _case,
      declared: { name?: string; op: OperationDefinition },
      expected
    ) => {
      const { name, op } = declared;
      const sources: OperationListSources = name
        ? { core: [], plugins: [{ name, operations: [op] }] }
        : { core: [op] };
      const problems = await refusal(sources);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain(expected);
    }
  );

  it("lets an operation say what its own exit code 2 and 3 mean (control)", async () => {
    const list = await assembleOperationList({
      core: [
        readOperation({
          exitCodes: [
            {
              code: 2,
              meaning: "an applied migration file was edited since it ran",
            },
            { code: 3, meaning: "an applied migration's file is missing" },
          ],
        }),
      ],
    });
    expect(list.byId("posts.list")?.exitCodes.map(entry => entry.code)).toEqual(
      [2, 3]
    );
  });

  it("reports every problem at once, each naming its operation", async () => {
    const problems = await refusal({
      core: [
        writeOperation({ dryRun: false }),
        readOperation({ input: z.object({ limit: z.string() }) }),
      ],
    });
    expect(problems).toEqual([
      'Operation "posts.publish" from core: it writes but offers no dry run',
      expect.stringMatching(
        /^Operation "posts\.list" from core: its example "The first ten posts" does not parse/
      ),
    ]);
  });
});

describe("the deploy door", () => {
  const maintenance = {
    kind: "maintenance",
    reason: "Brings the schema up to the code.",
  } as const;

  it("is refused to a core operation outside its fixed set, naming it", async () => {
    const problems = await refusal({
      core: [
        readOperation({
          id: "content.list",
          command: ["content", "list"],
          doors: ["local", "deploy", "site"],
        }),
      ],
    });
    expect(problems).toEqual([
      'Operation "content.list" from core: it runs on the deploy door, which only migrate, migrations.status, migrations.check, doctor may',
    ]);
  });

  it("is open to an operation in the set (control)", async () => {
    const list = await assembleOperationList({
      core: [
        writeOperation({
          id: "migrate",
          command: ["migrate"],
          doors: ["local", "deploy"],
          permission: maintenance,
        }),
        readOperation({
          id: "migrations.status",
          command: ["migrations", "status"],
          doors: ["local", "deploy"],
          permission: maintenance,
        }),
      ],
    });
    expect(list.operations.map(op => op.id)).toEqual([
      "migrate",
      "migrations.status",
    ]);
  });

  it("is refused to an operation in the set that needs a person's permission", async () => {
    const problems = await refusal({
      core: [
        readOperation({
          id: "migrations.status",
          command: ["migrations", "status"],
          doors: ["local", "deploy"],
        }),
      ],
    });
    expect(problems).toEqual([
      'Operation "migrations.status" from core: it runs on the deploy door but is not a maintenance operation; the deployment holds no stored permission',
    ]);
  });
});

describe("the permission an operation needs", () => {
  it.each(["posts:read", "Read-posts", "readposts", `read-${"x".repeat(100)}`])(
    "is refused when %s is not spelled as permissions are stored",
    async name => {
      const problems = await refusal({
        core: [readOperation({ permission: { kind: "permission", name } })],
      });
      expect(problems).toEqual([
        `Operation "posts.list" from core: its permission ${JSON.stringify(name)} is not spelled as permissions are stored (<action>-<slug>, as read-posts)`,
      ]);
    }
  );

  it.each([
    "read-posts",
    "update-site_settings",
    "publish-without-review-posts",
  ])("is accepted as %s (control)", async name => {
    const list = await assembleOperationList({
      core: [readOperation({ permission: { kind: "permission", name } })],
    });
    expect(list.byId("posts.list")?.permission).toEqual({
      kind: "permission",
      name,
    });
  });
});

describe("who registered an operation", () => {
  it("must be core or a plugin with a name", async () => {
    const problems = await refusal({
      core: [],
      plugins: [
        {
          name: "",
          operations: [
            readOperation({ id: "seo.audit", command: ["seo", "audit"] }),
          ],
        },
      ],
    });
    expect(problems).toEqual([
      'Operations were registered by a plugin with no name: {"kind":"plugin","name":""}',
    ]);
  });
});

describe("a plugin whose operations are not a list", () => {
  it.each([{}, undefined])(
    "is refused by name when they are %j",
    async operations => {
      const problems = await refusal({
        core: [],
        plugins: [
          {
            name: SEO_PLUGIN,
            operations: operations as unknown as OperationDefinition[],
          },
        ],
      });
      expect(problems).toEqual([
        `plugin "${SEO_PLUGIN}" registered operations that are not a list: ${JSON.stringify(operations) ?? "undefined"}`,
      ]);
    }
  );
});

describe("a schema made as a plain object", () => {
  it("is kept as given, even when its marker is not enumerable", async () => {
    const parsed = { "~standard": undefined as unknown };
    Object.defineProperty(parsed, "~standard", {
      enumerable: false,
      value: {
        version: 1,
        vendor: "handmade",
        validate: (value: unknown) => ({ value }),
      },
    });
    const input = parsed as unknown as OperationDefinition["input"];
    const list = await assembleOperationList({
      core: [readOperation({ input })],
    });
    expect(list.byId("posts.list")?.input).toBe(input);
  });
});

describe("a schema that throws instead of answering", () => {
  it("is refused with the operation named", async () => {
    const throwing = {
      "~standard": {
        version: 1 as const,
        vendor: "handmade",
        validate: () => {
          throw new Error("this schema cannot read numbers");
        },
      },
    };
    const problems = await refusal({
      core: [readOperation({ input: throwing })],
    });
    expect(problems).toEqual([
      'Operation "posts.list" from core: its example "The first ten posts" could not be checked: this schema cannot read numbers',
    ]);
  });
});

describe("the list's view of an operation", () => {
  it("does not change when the declarer changes its own object afterwards", async () => {
    const declared = readOperation();
    const list = await assembleOperationList({ core: [declared] });

    (declared.doors as Door[]).push("deploy");
    (declared.effects as { destroys: boolean }).destroys = true;
    (declared.examples[0] as { summary: string }).summary = "changed";

    const listedOp = list.byId("posts.list");
    expect(listedOp?.doors).toEqual(["local", "site"]);
    expect(listedOp?.effects.destroys).toBe(false);
    expect(listedOp?.examples[0].summary).toBe("The first ten posts");
    // The schemas are the declarer's own: the list calls them, never edits.
    expect(listedOp?.input).toBe(declared.input);
  });

  it("cannot be changed through the list either", async () => {
    const list = await assembleOperationList({ core: [readOperation()] });
    const doors = list.byId("posts.list")?.doors as Door[];
    expect(() => doors.push("deploy")).toThrow(TypeError);
    expect(list.byId("posts.list")?.doors).toEqual(["local", "site"]);
  });
});

describe("plain JavaScript that a check could stumble on", () => {
  it("refuses a hole in a list of raise rules", async () => {
    const rule = {
      when: "always",
      level: "critical" as const,
      applies: () => true,
    };
    // A hand-written array literal such as `[, rule]` leaves this hole.
    const sparse: unknown[] = [];
    sparse[1] = rule;
    const problems = await refusal({
      core: [writeOperation({ raise: sparse as OperationDefinition["raise"] })],
    });
    expect(problems).toEqual([
      'Operation "posts.publish" from core: a raise rule is not an object',
    ]);
  });

  it.each([
    [1n, "1n"],
    [
      (() => {
        const loop: Record<string, unknown> = {};
        loop.self = loop;
        return loop;
      })(),
      "[object Object]",
    ],
  ])(
    "quotes a mark JSON can't write (%s) instead of failing",
    async (mark, shown) => {
      const problems = await refusal({
        core: [
          {
            ...writeOperation({ level: "critical" }),
            alwaysAllow: mark as unknown as false,
          },
        ],
      });
      expect(problems).toEqual([
        `Operation "posts.publish" from core: its "Always allow" mark is ${shown}; it may only be false, or left out`,
      ]);
    }
  );

  it.each([
    [{}, "{}"],
    [null, "null"],
  ])(
    "refuses a schema that answers an example with %j",
    async (answer, shown) => {
      const odd = {
        "~standard": {
          version: 1 as const,
          vendor: "handmade",
          validate: () => answer,
        },
      };
      const problems = await refusal({
        core: [
          readOperation({
            input: odd as unknown as OperationDefinition["input"],
          }),
        ],
      });
      expect(problems).toEqual([
        `Operation "posts.list" from core: its input schema answered example "The first ten posts" with ${shown}, which is neither a parsed value nor a list of issues`,
      ]);
    }
  );
});

describe("data shaped like a schema marker", () => {
  it("is copied like any other data, not kept as given", async () => {
    const example = {
      summary: "Marker-shaped",
      input: { "~standard": "value" },
    };
    const declared = readOperation({
      input: z.object({ "~standard": z.string() }),
      examples: [example],
    });
    const list = await assembleOperationList({ core: [declared] });
    example.input["~standard"] = "changed";
    expect(list.byId("posts.list")?.examples[0].input).toEqual({
      "~standard": "value",
    });
  });
});

describe("finding an operation by its command words", () => {
  it("keeps each word a word", async () => {
    const list = await assembleOperationList({ core: [readOperation()] });
    expect(list.byCommand(["posts", "list"])?.id).toBe("posts.list");
    expect(list.byCommand(["posts list"])).toBeUndefined();
  });
});

describe("old names with the colons today's commands use", () => {
  it("are accepted as old names and found by their words", async () => {
    const list = await assembleOperationList({
      core: [
        readOperation({
          id: "migrations.status",
          command: ["migrations", "status"],
          aliases: [
            {
              command: ["migrate:status"],
              addedIn: "0.0.2-alpha.90",
              removableFrom: "0.1.0",
            },
          ],
        }),
      ],
    });
    expect(list.byCommand(["migrate:status"])?.id).toBe("migrations.status");
  });

  it("are still refused as a command's own words", async () => {
    const problems = await refusal({
      core: [
        readOperation({ id: "migrations.status", command: ["migrate:status"] }),
      ],
    });
    expect(problems).toEqual([
      'Operation "migrations.status" from core: its command word "migrate:status" is not lower case letters, digits and inner hyphens',
    ]);
  });
});

describe("a command word that is not text", () => {
  it("is refused by name rather than failing the check", async () => {
    const problems = await refusal({
      core: [
        readOperation({
          command: ["posts", Symbol("list") as unknown as string],
        }),
      ],
    });
    expect(problems).toEqual([
      'Operation "posts.list" from core: its command word Symbol(list) is not lower case letters, digits and inner hyphens',
    ]);
  });
});

describe("a raise rule that answers later", () => {
  it("is refused at registration", async () => {
    const problems = await refusal({
      core: [
        writeOperation({
          raise: [
            {
              when: "looked up",
              level: "critical",
              applies: async () => false,
            },
          ] as unknown as OperationDefinition["raise"],
        }),
      ],
    });
    expect(problems).toEqual([
      'Operation "posts.publish" from core: its raise rule "looked up" answers later; applies() must answer yes or no at once',
    ]);
  });
});

describe('a raise rule that refuses "Always allow"', () => {
  it("is refused below critical", async () => {
    const problems = await refusal({
      core: [
        writeOperation({
          level: "draft",
          raise: [
            {
              when: "many",
              level: "change",
              alwaysAllow: false,
              applies: () => true,
            },
          ],
        }),
      ],
    });
    expect(problems).toEqual([
      'Operation "posts.publish" from core: its raise rule "many" refuses "Always allow" at change, not critical',
    ]);
  });
});

describe("more plain JavaScript a check could stumble on", () => {
  it("refuses plugins that are not a list", async () => {
    const problems = await refusal({
      core: [],
      plugins: {} as unknown as OperationListSources["plugins"],
    });
    expect(problems).toEqual(["The plugins given are not a list"]);
  });

  it("refuses a plugin entry that is not an object", async () => {
    const problems = await refusal({
      core: [],
      plugins: [null] as unknown as OperationListSources["plugins"],
    });
    expect(problems).toEqual(["Plugin entry 1 is not an object"]);
  });

  it("refuses an exit code that is a symbol, with no meaning, by name", async () => {
    const odd = [
      { code: Symbol("two") },
    ] as unknown as OperationDefinition["exitCodes"];
    const problems = await refusal({
      core: [readOperation({ exitCodes: odd })],
    });
    expect(problems).toEqual([
      'Operation "posts.list" from core: its exit code Symbol(two) is not a whole number from 0 to 255',
      'Operation "posts.list" from core: its exit code Symbol(two) has no meaning',
    ]);
  });

  it("refuses a schema with no vendor", async () => {
    const noVendor = {
      "~standard": { version: 1, validate: (value: unknown) => ({ value }) },
    } as unknown as OperationDefinition["input"];
    const problems = await refusal({
      core: [readOperation({ input: noVendor })],
    });
    expect(problems).toEqual([
      'Operation "posts.list" from core: its input schema is not a Standard Schema',
    ]);
  });

  it.each([
    [
      "throws a value with no prototype",
      () => {
        throw Object.create(null);
      },
      'its example "The first ten posts" could not be checked: {}',
    ],
    [
      "gives an issue whose message has no prototype",
      () => ({ issues: [{ message: Object.create(null) }] }),
      'its example "The first ten posts" does not parse against its input schema: {}',
    ],
  ])(
    "names the operation when its schema %s",
    async (_what, validate, refusalText) => {
      const odd = {
        "~standard": { version: 1, vendor: "handmade", validate },
      } as unknown as OperationDefinition["input"];
      const problems = await refusal({ core: [readOperation({ input: odd })] });
      expect(problems).toEqual([
        `Operation "posts.list" from core: ${refusalText}`,
      ]);
    }
  );

  it("refuses a permission with nothing after its action", async () => {
    const problems = await refusal({
      core: [
        readOperation({ permission: { kind: "permission", name: "read-" } }),
      ],
    });
    expect(problems).toEqual([
      'Operation "posts.list" from core: its permission "read-" is not spelled as permissions are stored (<action>-<slug>, as read-posts)',
    ]);
  });

  it.each([
    ["toolName", 42, "its toolName is 42, not text"],
    ["docs", [], "its docs is [], not text"],
  ])("refuses a %s that is not text", async (key, value, refusalText) => {
    const problems = await refusal({
      core: [
        { ...readOperation(), [key]: value } as unknown as OperationDefinition,
      ],
    });
    expect(problems).toEqual([
      `Operation "posts.list" from core: ${refusalText}`,
    ]);
  });
});

describe("what the list copies", () => {
  it("copies a declaration made as a class instance", async () => {
    class Declared {
      readonly doors: string[] = ["local", "site"];
    }
    const declared = Object.assign(new Declared(), readOperation(), {
      doors: ["local", "site"],
    }) as unknown as OperationDefinition;
    const list = await assembleOperationList({ core: [declared] });
    (declared.doors as Door[]).push("deploy");
    expect(list.byId("posts.list")?.doors).toEqual(["local", "site"]);
  });

  it("copies data that carries a schema-like marker, outside the schemas", async () => {
    const effects = {
      destroys: false,
      idempotent: true,
      outside: false,
      spendsAi: false,
      "~standard": { version: 1, vendor: "x", validate: () => ({ value: 1 }) },
    };
    const list = await assembleOperationList({
      core: [readOperation({ effects })],
    });
    effects.destroys = true;
    expect(list.byId("posts.list")?.effects.destroys).toBe(false);
  });

  it("keeps an own __proto__ key in an example as a key", async () => {
    const input: unknown = JSON.parse('{"limit": 10, "__proto__": {"x": 1}}');
    const list = await assembleOperationList({
      core: [readOperation({ examples: [{ summary: "From JSON", input }] })],
    });
    const copied = list.byId("posts.list")?.examples[0].input;
    expect(Object.hasOwn(copied as object, "__proto__")).toBe(true);
  });
});

describe("values plain JavaScript can still slip past a message", () => {
  it("quotes a door that is a symbol on a project operation", async () => {
    const problems = await refusal({
      core: [
        readOperation({
          doors: ["local", Symbol("site") as unknown as Door],
          permission: {
            kind: "project",
            reason: "Writes a file in the project.",
          },
        }),
      ],
    });
    expect(problems).toEqual([
      'Operation "posts.list" from core: its door Symbol(site) is not one of local, deploy, site, chat',
      'Operation "posts.list" from core: a project operation runs only on local, not Symbol(site)',
    ]);
  });
});

describe("a nested fact declared as a class instance", () => {
  it("is listed as frozen plain data, so changing it afterwards changes nothing listed", async () => {
    class Effects {
      destroys = false;
      idempotent = true;
      outside = false;
      spendsAi = false;
    }
    const effects = new Effects();
    const list = await assembleOperationList({
      core: [readOperation({ effects })],
    });
    effects.destroys = true;
    const listed = list.byId("posts.list")?.effects;
    expect(listed).toEqual({
      destroys: false,
      idempotent: true,
      outside: false,
      spendsAi: false,
    });
    // The fact itself, not a stand-in sharing the declarer's class: frozen, and plain.
    expect(Object.isFrozen(listed)).toBe(true);
    expect(Object.getPrototypeOf(listed)).toBe(Object.prototype);
  });
});

/**
 * The values a declaration carries rather than states: examples, which are
 * parsed by the operation's input schema and shown in the reference, and raise
 * rules, whose `applies` the run calls. A copy of an object that keeps its data
 * in internal slots or private fields (a Date, a Map, a Set, a typed array, a
 * class with `#fields`) answers nothing, so these keep such objects as given.
 */
describe("values a declaration carries keep working once listed", () => {
  it("a raise rule holding a Set still answers", async () => {
    // An object literal, so the list copies it; its Set is read through
    // `this`, so the copy must still hold the Set itself.
    const rule = {
      when: "a post in a listed set",
      level: "critical" as const,
      ids: new Set(["1"]),
      applies(run: OperationRun<{ id?: unknown }>): boolean {
        return this.ids.has(String(run.input.id));
      },
    };
    const list = await assembleOperationList({
      core: [writeOperation({ raise: [rule] })],
    });
    const op = list.byId("posts.publish");
    expect(op && levelForRun(op, { input: { id: "1" } }).level).toBe(
      "critical"
    );
  });

  it("a raise rule that is a class with a private field still answers", async () => {
    class OverLimit {
      readonly #limit = 5;
      readonly when = "more than five";
      readonly level = "critical" as const;
      applies(run: { input: { n?: unknown } }): boolean {
        return Number(run.input.n) > this.#limit;
      }
    }
    const list = await assembleOperationList({
      core: [writeOperation({ raise: [new OverLimit()] })],
    });
    const op = list.byId("posts.publish");
    expect(op && levelForRun(op, { input: { n: 9 } }).level).toBe("critical");
  });

  it("an example holding a Date is checked by its schema and shown as a date", async () => {
    const list = await assembleOperationList({
      core: [
        readOperation({
          input: z.object({ since: z.date() }),
          examples: [{ summary: "Since", input: { since: new Date(0) } }],
        }),
      ],
    });
    const examples = list.byId("posts.list")?.examples;
    expect(JSON.stringify(examples)).toBe(
      '[{"summary":"Since","input":{"since":"1970-01-01T00:00:00.000Z"}}]'
    );
  });

  it("an example holding a Map or a typed array is checked by its schema", async () => {
    const list = await assembleOperationList({
      core: [
        readOperation({
          input: z.object({
            counts: z.map(z.string(), z.number()),
            bytes: z.instanceof(Uint8Array),
          }),
          examples: [
            {
              summary: "Counts",
              input: {
                counts: new Map([["a", 1]]),
                bytes: new Uint8Array([1, 2]),
              },
            },
          ],
        }),
      ],
    });
    const input = list.byId("posts.list")?.examples[0].input as {
      counts: Map<string, number>;
      bytes: Uint8Array;
    };
    expect(input.counts.get("a")).toBe(1);
    expect(input.bytes.length).toBe(2);
  });
});
