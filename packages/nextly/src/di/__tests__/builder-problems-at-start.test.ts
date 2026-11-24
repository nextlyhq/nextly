/**
 * What a start says of the Builder's definitions it serves: one bounded warning per process, in
 * names and codes alone, judged from the rows the start has already read. Nothing it meets stops
 * the start.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetBuilderWarningsForTest,
  builderProblemsWarning,
  emitHeldBuilderWarning,
  warnOfBuilderProblemsAtStart,
} from "../builder-problems-at-start";

const row = (slug: unknown, fields: unknown[], source = "ui") => ({
  slug,
  tableName: "t",
  fields,
  status: false,
  localized: false,
  source,
});
const twice = [
  { name: "body", type: "text", defaultValue: "s3cret-default" },
  { name: "body", type: "text" },
];
const entities = (collections: unknown[], components: unknown[] = []) =>
  ({ collections, singles: [], components }) as never;

let warned: string[];
const logger = {
  warn: (message: string) => {
    warned.push(message);
  },
};

beforeEach(() => {
  warned = [];
  _resetBuilderWarningsForTest();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("a Builder entity with a problem, served by a start", () => {
  it("is warned of by its kind, its name and the code, and by nothing it holds", () => {
    warnOfBuilderProblemsAtStart({
      entities: entities([row("cases", twice)]),
      code: {},
      logger,
      when: "now",
    });

    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain("collection 'cases'");
    expect(warned[0]).toContain("FIELD_NAME_DUPLICATE");
    expect(warned[0]).not.toContain("s3cret-default");
    // The rules' own sentences quote what a definition holds.
    expect(warned[0]).not.toContain("share");
  });

  it("is warned of once in a process, however many starts it sees", () => {
    for (let start = 0; start < 3; start++) {
      warnOfBuilderProblemsAtStart({
        entities: entities([row("cases", twice)]),
        code: {},
        logger,
        when: "now",
      });
    }

    expect(warned).toHaveLength(1);
  });

  it("is one bounded line among many, saying how many more there are", () => {
    warnOfBuilderProblemsAtStart({
      entities: entities(
        Array.from({ length: 500 }, (_, i) => row(`cases_${i}`, twice))
      ),
      code: {},
      logger,
      when: "now",
    });

    expect(warned).toHaveLength(1);
    expect(warned[0]?.length).toBeLessThan(2_000);
    expect(warned[0]).toContain("490 more");
  });

  it("shows a long or unprintable name cut and escaped", () => {
    const name = `${"x".repeat(5_000)}\u001b[2J\n`;
    warnOfBuilderProblemsAtStart({
      entities: entities([row(name, twice)]),
      code: {},
      logger,
      when: "now",
    });

    expect(warned[0]?.length).toBeLessThan(2_000);
    expect(warned[0]).not.toMatch(/[\u0000-\u001f]/);
  });
});

describe("a row the Schema Builder does not own, with the same problem", () => {
  it.each([
    ["code's own", "code", {}],
    ["a plugin's", "plugin:@acme/seo", {}],
    ["one a code entity shadows", "ui", { collections: [{ slug: "cases" }] }],
  ])("is not judged: %s", (_, source, code) => {
    warnOfBuilderProblemsAtStart({
      entities: entities([row("cases", twice, source)]),
      code,
      logger,
      when: "now",
    });

    expect(warned).toEqual([]);
  });

  it("is not judged where the registry is too old to say who owns it", () => {
    const { source: _source, ...unknown } = row("cases", twice);
    warnOfBuilderProblemsAtStart({
      entities: entities([unknown]),
      code: {},
      logger,
      when: "now",
    });

    expect(warned).toEqual([]);
  });
});

describe("a judgement that fails", () => {
  // A row whose fields throw when read stands for any defect in the judging.
  it("is logged and never thrown, naming nothing the row holds", () => {
    const broken = {
      ...row("cases", []),
      get fields(): never {
        throw new Error("s3cret-in-a-message");
      },
    };

    expect(() =>
      warnOfBuilderProblemsAtStart({
        entities: entities([broken]),
        code: {},
        logger,
        when: "now",
      })
    ).not.toThrow();
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain("could not be checked");
    expect(warned[0]).not.toContain("s3cret-in-a-message");
  });

  it("is not thrown where the logger itself fails", () => {
    expect(() =>
      warnOfBuilderProblemsAtStart({
        entities: entities([row("cases", twice)]),
        code: {},
        logger: {
          warn: () => {
            throw new Error("no log");
          },
        },
        when: "now",
      })
    ).not.toThrow();
  });
});

describe("a start whose own reload is to warn", () => {
  // A development start's reload reads the definition file and warns of it; where that reload
  // does not come, what the start found is said after all.
  it("holds its warning, said only when asked for", () => {
    warnOfBuilderProblemsAtStart({
      entities: entities([row("cases", twice)]),
      code: {},
      logger,
      when: "unless-reloaded",
    });
    expect(warned).toEqual([]);

    emitHeldBuilderWarning();
    emitHeldBuilderWarning();

    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain("collection 'cases'");
  });
});

describe("the warning of no problem", () => {
  it("is none", () => {
    expect(builderProblemsWarning([])).toBeNull();
  });
});
