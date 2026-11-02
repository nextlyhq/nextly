/**
 * The sibling-field rule as the migrate commands apply it: the latest snapshot
 * is the definition each entity last had, so a pair it records already exists
 * (warned about, never refused) and any other pair is new (refused). They read
 * files only, never the database.
 */
import { describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import { resolveCollectionTableName } from "../../utils/resolve-table-name";
import type { LatestSnapshot } from "../addresses";
import {
  assertMigrationSiblingFields,
  judgeMigrationSiblingFields,
  type MigrationEntities,
  reportMigrationSiblingFields,
} from "../sibling-fields";

const text = (name: string) => ({ name, type: "text" });
const group = (name: string, fields: unknown[]) => ({
  name,
  type: "group",
  fields,
});

/** `posts` holding a new-or-existing pair in group `seo`, plus an unrelated field. */
const WITH_PAIR = [
  text("title"),
  group("seo", [text("fooBar"), text("foo_bar")]),
];
const WITHOUT_PAIR = [text("title"), group("seo", [text("fooBar")])];

const posts = (fields: unknown[]) => ({
  slug: "posts",
  tableName: resolveCollectionTableName("posts"),
  fields,
});

const merged = (fields: unknown[]): MigrationEntities => ({
  collections: [posts(fields)],
  singles: [],
  components: [],
});

/** A snapshot that records entities, holding `recorded` by slug with its declared fields. */
const withEntities = (recorded: Record<string, unknown[]>): LatestSnapshot => ({
  data: {
    snapshot: {
      tables: Object.keys(recorded).map(slug => ({
        name: resolveCollectionTableName(slug),
      })),
    },
    entities: {
      collections: Object.fromEntries(
        Object.entries(recorded).map(([slug, fields]) => [
          slug,
          { source: "code", settings: { slug, fields } },
        ])
      ),
      singles: {},
      fieldGroups: {},
    },
  },
});

/** A snapshot written before entities were recorded: only its tables say what exists. */
const older = (tables: string[]): LatestSnapshot => ({
  data: { snapshot: { tables: tables.map(name => ({ name })) } },
});

const describePairs = (
  list: Readonly<ReturnType<typeof judgeMigrationSiblingFields>["refused"]>
) =>
  list.map(
    ({ entity, clash }) =>
      `${entity.kind}:${entity.slug} ${clash.container} ${clash.first}/${clash.second}`
  );

describe("judgeMigrationSiblingFields: the migrate commands' decision table", () => {
  const PAIR = "collection:posts group 'seo' fooBar/foo_bar";

  it.each([
    ["no snapshot: everything is new", null, [PAIR], []],
    [
      "the entities record holds the entity with the pair: existing",
      withEntities({ posts: WITH_PAIR }),
      [],
      [PAIR],
    ],
    [
      "the entities record holds the entity without the pair: new",
      withEntities({ posts: WITHOUT_PAIR }),
      [PAIR],
      [],
    ],
    [
      "the entities record does not hold the entity: new",
      withEntities({ pages: WITH_PAIR }),
      [PAIR],
      [],
    ],
    [
      "an older snapshot without entities holds the entity's table: existing",
      older(["dc_posts"]),
      [],
      [PAIR],
    ],
    [
      "an older snapshot without entities does not hold the table: new",
      older(["dc_pages"]),
      [PAIR],
      [],
    ],
  ] as const)("%s", (_label, latest, refused, warned) => {
    const judged = judgeMigrationSiblingFields(merged(WITH_PAIR), latest);
    expect({
      refused: describePairs(judged.refused),
      warned: describePairs(judged.existing),
    }).toEqual({ refused: [...refused], warned: [...warned] });
  });
});

describe("reportMigrationSiblingFields", () => {
  it("warns once per existing pair, naming the entity, the container, both fields and what they share", () => {
    const fields = [
      text("fooBar"),
      text("foo_bar"),
      group("seo", [text("headline"), text("headline")]),
      group("meta", [text("fooBar"), text("foo_bar")]),
    ];
    const logger = { warn: vi.fn(), error: vi.fn() };

    const refused = reportMigrationSiblingFields(
      merged(fields),
      withEntities({ posts: fields }),
      logger
    );

    expect(refused).toEqual([]);
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn.mock.calls.map(([line]) => line)).toEqual([
      "Collection 'posts': fields 'fooBar' and 'foo_bar' at the top level already share the column 'foo_bar'. They keep working; rename one of them so each keeps its own value.",
      "Collection 'posts': fields 'headline' and 'headline' in group 'seo' already share the key 'headline'. They keep working; rename one of them so each keeps its own value.",
      "Collection 'posts': fields 'fooBar' and 'foo_bar' in group 'meta' would both become the column 'foo_bar'. They keep working; rename one of them.",
    ]);
  });

  it("logs a new pair as an error and answers it, warning about nothing", () => {
    const logger = { warn: vi.fn(), error: vi.fn() };

    const refused = reportMigrationSiblingFields(
      merged(WITH_PAIR),
      withEntities({ posts: WITHOUT_PAIR }),
      logger
    );

    expect(describePairs(refused)).toEqual([
      "collection:posts group 'seo' fooBar/foo_bar",
    ]);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error.mock.calls.map(([line]) => line)).toEqual([
      "Collection 'posts': fields 'fooBar' and 'foo_bar' in group 'seo' would both become the column 'foo_bar'. Rename one of them.",
    ]);
  });

  it("answers nothing with no entities to judge", () => {
    const logger = { warn: vi.fn(), error: vi.fn() };
    expect(reportMigrationSiblingFields(undefined, null, logger)).toEqual([]);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe("assertMigrationSiblingFields", () => {
  it("logs each new pair and throws the FIELD_NAME_DUPLICATE refusal naming it", () => {
    const logger = { error: vi.fn() };
    let thrown: unknown;
    try {
      assertMigrationSiblingFields(merged(WITH_PAIR), null, logger);
    } catch (error) {
      thrown = error;
    }

    const message =
      "Collection 'posts': fields 'fooBar' and 'foo_bar' in group 'seo' would both become the column 'foo_bar'. Rename one of them.";
    expect(logger.error.mock.calls.map(([line]) => line)).toEqual([message]);
    expect(thrown).toBeInstanceOf(NextlyError);
    expect(thrown).toMatchObject({
      publicData: {
        errors: [{ path: "fields", code: "FIELD_NAME_DUPLICATE", message }],
      },
    });
  });

  it("neither logs nor throws for a pair the latest snapshot records", () => {
    const logger = { error: vi.fn() };
    expect(() =>
      assertMigrationSiblingFields(
        merged(WITH_PAIR),
        withEntities({ posts: WITH_PAIR }),
        logger
      )
    ).not.toThrow();
    expect(logger.error).not.toHaveBeenCalled();
  });
});
