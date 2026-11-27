/**
 * The refusals that stop Nextly from starting: two operations behind one ID or
 * one set of command words, from core or from a plugin, and declarations that
 * break the list's rules on their own.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { NextlyError } from "../../errors/nextly-error";
import type { OperationDefinition } from "../definition";
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
      'Two operations claim the ID "posts.list": one from core and one from core',
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
      `Two operations claim the ID "posts.list": one from core and one from plugin "${SEO_PLUGIN}"`,
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
