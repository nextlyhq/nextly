/**
 * On PostgreSQL and SQLite a migration that moves fields runs in one transaction, so it stays the one
 * file it was: MySQL's own step for the moves changes nothing of it. The recorded text is the file
 * and its snapshot, byte for byte, the moments they are named for aside, from before MySQL's step.
 *
 * Both roads that write one: the Schema Builder's dialog, and `nextly migrate:create --accept-moves`
 * over a code-first config. One change moves a field into a group, one out of a group into a required
 * column and one between groups, and adds a field; in the Builder it also adds a relationship and a
 * many-to-many, whose key and junction statements the moves' stand around.
 */
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { perLanguageStorageSuite } from "../../../../__tests__/storage-layout";
import { runMigrateCreate } from "../../../../cli/commands/migrate-create";
import type { CommandContext } from "../../../../cli/program";
import { createLogger } from "../../../../cli/utils/logger";
import {
  defineCollection,
  defineConfig,
  group,
  text,
} from "../../../../config";
import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../../services";
import { _resetEnvCache } from "../../../../shared/lib/env";
import type { CollectionService } from "../../../collections/services/collection-service";
import { setNonInteractive } from "../../migrate/can-prompt";

// The layout every installation runs, the moved fields shared: kept on the entry's own row.
perLanguageStorageSuite();

/** The configuration `migrate:create` loads, set before each run. */
const loaded = vi.hoisted(() => ({ config: undefined as unknown }));
vi.mock("../../../../cli/utils/config-loader", async importOriginal => ({
  ...(await importOriginal<
    typeof import("../../../../cli/utils/config-loader")
  >()),
  loadConfig: async () => ({ config: loaded.config, dependencies: [] }),
}));

const SLUG = "mfu_posts";
/** The collection the Builder's relationships point to. */
const OTHER = "mfu_people";
const MOVES = [
  { from: ["summary"], to: ["meta", "summary"] },
  { from: ["meta", "subtitle"], to: ["subtitle"] },
  { from: ["other", "label"], to: ["meta", "label"] },
];

let dir: string;
let instance: TestNextly | undefined;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "nextly-move-file-"));
  mkdirSync(join(dir, "migrations"));
});

afterEach(async () => {
  try {
    await instance?.destroy();
  } finally {
    instance = undefined;
    vi.unstubAllEnvs();
    _resetEnvCache();
    setNonInteractive(false);
    rmSync(dir, { recursive: true, force: true });
  }
});

const migrations = () =>
  readdirSync(join(dir, "migrations"))
    .filter(file => file.endsWith(".sql"))
    .sort();

/** A file and its snapshot as text, the moments they were written at and the hash over them aside. */
function recorded(file: string): string {
  const sql = readFileSync(join(dir, "migrations", file), "utf-8");
  const snapshot = readFileSync(
    join(dir, "migrations", "meta", file.replace(/\.sql$/, ".snapshot.json")),
    "utf-8"
  );
  return `${sql}\n-- snapshot\n${snapshot}`
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, "<moment>")
    .replace(/\d{8}_\d{6}_\d{3}/g, "<stamp>")
    .replace(/"migrationHash": "[^"]*"/, '"migrationHash": "<hash>"');
}

const shared = { localized: false } as const;

/** The collection in code, before the change and after it. */
function posts(after: boolean) {
  const label = text({ name: "label", ...shared });
  return defineConfig({
    collections: [
      defineCollection({
        slug: SLUG,
        fields: [
          text({ name: "title" }),
          after
            ? text({ name: "subtitle", ...shared, required: true })
            : text({ name: "summary", ...shared }),
          ...(after ? [text({ name: "extra", ...shared })] : []),
          group({
            name: "meta",
            fields: after
              ? [
                  text({ name: "note", ...shared }),
                  text({ name: "summary", ...shared }),
                  label,
                ]
              : [
                  text({ name: "note", ...shared }),
                  text({ name: "subtitle", ...shared }),
                ],
          }),
          group({
            name: "other",
            fields: [
              text({ name: "kept", ...shared }),
              ...(after ? [] : [label]),
            ],
          }),
        ],
      }),
    ],
    db: { migrationsDir: "./migrations" },
  });
}

const field = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  type: "text",
  localized: false,
  ...extra,
});

/** The same collection as the Schema Builder holds it. */
const inBuilder = (after: boolean): Record<string, unknown>[] =>
  after
    ? [
        field("subtitle", { required: true }),
        field("extra"),
        { name: "author", type: "relationship", options: { target: OTHER } },
        {
          name: "tags",
          type: "relationship",
          options: { relationType: "manyToMany", target: OTHER },
        },
        {
          name: "meta",
          type: "group",
          fields: [field("note"), field("summary"), field("label")],
        },
        { name: "other", type: "group", fields: [field("kept")] },
      ]
    : [
        field("summary"),
        {
          name: "meta",
          type: "group",
          fields: [field("note"), field("subtitle")],
        },
        {
          name: "other",
          type: "group",
          fields: [field("kept"), field("label")],
        },
      ];

async function create(name: string, config: unknown): Promise<void> {
  loaded.config = config;
  setNonInteractive(true);
  await runMigrateCreate(
    name,
    { cwd: dir, acceptDataLoss: true, acceptMoves: true },
    {
      logger: createLogger({ quiet: true }),
      options: {},
      cwd: dir,
    } as CommandContext
  );
}

const golden = (name: string) => `./__golden__/${name}.txt`;

describe.each(["sqlite", "postgresql"] as const)(
  "a migration that moves fields, on %s",
  dialect => {
    const configured = getConfiguredTestDialects().includes(dialect);

    it.runIf(configured)(
      "migrate:create writes the one file it wrote before MySQL's step",
      async () => {
        vi.stubEnv("DB_DIALECT", dialect);
        vi.stubEnv(
          "DATABASE_URL",
          dialect === "sqlite"
            ? `file:${join(dir, "unused.db")}`
            : (process.env.TEST_POSTGRES_URL ?? "")
        );
        _resetEnvCache();
        await create("create_posts", posts(false));
        const before = migrations();
        await create("move_fields", posts(true));
        const written = migrations().filter(file => !before.includes(file));
        expect(written).toHaveLength(1);
        await expect(recorded(written[0] ?? "")).toMatchFileSnapshot(
          golden(`move-file-code-${dialect}`)
        );
      }
    );

    it.runIf(configured)(
      "the Builder's dialog writes the one file it wrote before MySQL's step",
      async () => {
        vi.stubEnv("NODE_ENV", "development");
        instance = await createTestNextly({
          dialect,
          basePath: dir,
          db: {
            migrationsDir: "./migrations",
            uiSchemaFile: "./ui-schema.json",
          },
        });
        for (const [name, fields] of [
          [OTHER, [field("label")]],
          [SLUG, inBuilder(false)],
        ] as const) {
          await instance
            .getService("collectionService")
            .createCollection(
              { name, label: name, localized: false, fields } as Parameters<
                CollectionService["createCollection"]
              >[0],
              {}
            );
        }
        const before = migrations();
        await dispatchCollections(
          {} as ServiceContainer,
          "applySchemaChanges",
          { collectionName: SLUG },
          {
            fields: inBuilder(true),
            confirmed: true,
            schemaVersion: 1,
            hints: { moves: MOVES },
          }
        );
        const written = migrations().filter(file => !before.includes(file));
        expect(written).toHaveLength(1);
        await expect(recorded(written[0] ?? "")).toMatchFileSnapshot(
          golden(`move-file-builder-${dialect}`)
        );
      }
    );
  }
);
