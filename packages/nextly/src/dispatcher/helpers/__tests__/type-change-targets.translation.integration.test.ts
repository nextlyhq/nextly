/**
 * A type change the save refuses by a translation rule of its own, whatever the values hold, is
 * unavailable in the Builder's type picker, with the save's own reason: a field that stops being
 * translated, or becomes translated, while how it is stored changes, and a translated field whose
 * translations column would keep its old type. Proved by making each change through the Builder's own
 * save and comparing its answer with the picker's.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { perLanguageStorageSuite } from "../../../__tests__/storage-layout";
import { container } from "../../../di/container";
import type { ServiceContainer } from "../../../services";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";

import { dispatchCollections } from "../../handlers/collection-dispatcher";

import {
  collection,
  DB,
  fieldGroup,
  LOCALIZATION,
  single,
  targetsOf,
  type Field,
} from "./type-change-targets-entities";

// Written for per-language storage as every installation runs it (`storage-layout`): a text-like
// field is translated unless it says `localized: false`.
perLanguageStorageSuite();

let instance: TestNextly | undefined;
/** Every project folder a case made, removed after it. */
let folders: string[] = [];

afterEach(async () => {
  try {
    await instance?.destroy();
  } finally {
    instance = undefined;
    vi.unstubAllEnvs();
    for (const folder of folders) {
      await rm(folder, { recursive: true, force: true });
    }
    folders = [];
  }
});

/** The reasons the save refuses a change by a translation rule of its own, whatever the values. */
const BY_TRANSLATION = new Set([
  "leaves-translation",
  "joins-translation",
  "translations-column",
]);

/**
 * A saved field `v` and the type the picker is asked about. Chosen to reach each translation rule:
 * a translated text becoming a number leaves translation reshaped; one that says it is translated
 * stays so, and its translations column takes the number's type, which only a collection's save
 * file gives it; a checkbox's column is a number's on SQLite alone; a shared field becoming a
 * text-like one joins translation; a text becoming a long text, or a long text becoming code,
 * keeps its translations column.
 */
const CASES: { field: Field; to: string }[] = [
  { field: { name: "v", type: "text" }, to: "number" },
  { field: { name: "v", type: "text", localized: true }, to: "number" },
  { field: { name: "v", type: "text" }, to: "textarea" },
  { field: { name: "v", type: "textarea" }, to: "code" },
  { field: { name: "v", type: "number" }, to: "text" },
  { field: { name: "v", type: "json" }, to: "code" },
  { field: { name: "v", type: "date" }, to: "text" },
  { field: { name: "v", type: "checkbox", localized: true }, to: "number" },
];

describe.each(getConfiguredTestDialects())(
  "the type picker answers as the Builder's save does (%s)",
  dialect => {
    /** A fresh project, so each case's save writes its files from nothing. */
    async function boot(): Promise<TestNextly> {
      await instance?.destroy();
      const basePath = await mkdtemp(join(tmpdir(), "nextly-type-targets-"));
      folders.push(basePath);
      vi.stubEnv("NODE_ENV", "development");
      instance = await createTestNextly({
        dialect: dialect as TestDialect,
        basePath,
        db: DB,
        localization: LOCALIZATION,
      });
      return instance;
    }

    it.each([
      {
        of: collection,
        // A collection's save file retypes a translations column where it changes on this
        // database, which a checkbox's does not on SQLite.
        expected: [
          "joins-translation",
          "leaves-translation",
          ...(dialect === "sqlite" ? ["translations-column"] : []),
        ],
      },
      {
        of: single,
        expected: [
          "joins-translation",
          "leaves-translation",
          "translations-column",
        ],
      },
      {
        of: fieldGroup,
        expected: [
          "joins-translation",
          "leaves-translation",
          "translations-column",
        ],
      },
    ])(
      "$of.name: each change the picker marks unavailable, the save refuses, with the reason it gives",
      async ({ of, expected }) => {
        const seen = new Set<string>();
        for (const { field, to } of CASES) {
          const entity = of(await boot());
          await entity.create(field);
          const label = `${entity.kind} ${String(field.type)} to ${to}`;
          const target = (await entity.targets(field)).find(t => t.type === to);
          expect(target, label).toBeDefined();
          const outcome = await entity.save({ ...field, type: to }).then(
            () => undefined,
            (error: unknown) => error
          );
          if (target?.blocked == null) {
            // No values to judge, so a change open in the picker goes ahead.
            expect(outcome, `${label}: the save goes ahead`).toBeUndefined();
            continue;
          }
          expect(BY_TRANSLATION.has(target.blocked), label).toBe(true);
          seen.add(target.blocked);
          // The same refusal, of the same field, in the same words.
          expect(outcome, `${label}: the save refuses it`).toMatchObject({
            code: "VALIDATION_ERROR",
            publicData: {
              errors: expect.arrayContaining([
                expect.objectContaining({
                  path: "fields.v",
                  code: target.refusal?.code,
                  message: expect.stringContaining(
                    [
                      target.refusal?.reason ?? "no reason given",
                      ...(target.refusal?.steps ?? []),
                    ].join(" ")
                  ),
                }),
              ]),
            },
          });
        }
        // The cases reached the rules this entity has, so the agreement is about something.
        expect([...seen].sort()).toEqual(expect.arrayContaining(expected));
      },
      600_000
    );
  }
);

// Each installation keeps its text per language, and a container's text field by field beside its one
// structure, whatever the entity's own switch says.
describe.each(getConfiguredTestDialects())(
  "a text inside a group, whatever the collection says of translation (%s)",
  dialect => {
    it.each([
      ["off", { localized: false }],
      ["not said", {}],
      ["on", { localized: true }],
    ])(
      "%s: a change that stops translating it is unavailable, and the save of a group's only text is refused",
      async (_said, localized) => {
        const basePath = await mkdtemp(join(tmpdir(), "nextly-type-targets-"));
        folders.push(basePath);
        vi.stubEnv("NODE_ENV", "development");
        instance = await createTestNextly({
          dialect: dialect as TestDialect,
          basePath,
          db: DB,
          localization: LOCALIZATION,
        });
        const text = (name: string) => ({ name, type: "text" });
        const group = (name: string, fields: Field[]) => ({
          name,
          type: "group",
          fields,
        });
        const ONE = group("one", [text("note")]);
        const TWO = group("two", [text("note"), text("subtitle")]);
        await dispatchCollections(
          {} as ServiceContainer,
          "createCollection",
          {},
          {
            name: "tct_inside",
            label: "Post",
            ...localized,
            fields: [ONE, TWO],
          }
        );
        const marked = async (path: string[], to: string) =>
          (await targetsOf("tct_inside", path, "text")).find(
            target => target.type === to
          );
        for (const path of [
          ["one", "note"],
          ["two", "note"],
        ]) {
          expect(await marked(path, "number"), path.join(".")).toMatchObject({
            blocked: "leaves-translation-inside",
            outcome: null,
          });
          expect(await marked(path, "email"), path.join(".")).toMatchObject({
            blocked: "unjudged-inside",
            outcome: null,
          });
          expect(await marked(path, "textarea"), path.join(".")).toMatchObject({
            blocked: null,
            outcome: "keeps",
          });
        }

        // What the picker marks unavailable for a group's only text, the save refuses too.
        const [row] = (await (
          instance.adapter as unknown as {
            executeQuery<R>(statement: string): Promise<R[]>;
          }
        ).executeQuery<{ v: number | string | null }>(
          "SELECT schema_version AS v FROM dynamic_collections WHERE slug = 'tct_inside'"
        )) as { v: number | string | null }[];
        const outcome = await dispatchCollections(
          {} as ServiceContainer,
          "applySchemaChanges",
          { collectionName: "tct_inside" },
          {
            fields: [group("one", [{ name: "note", type: "number" }]), TWO],
            confirmed: true,
            schemaVersion: Number(row?.v ?? 1),
          }
        ).then(
          () => undefined,
          (error: unknown) => error
        );
        expect(outcome).toMatchObject({
          code: "INVALID_INPUT",
          logContext: { reason: "container-overlay-left-behind" },
        });
      },
      300_000
    );
  }
);

// With no migration writer the save is made by the push, which changes no translations column's
// type: the picker offers such a change only where the save would make it.
describe.each(getConfiguredTestDialects().filter(d => d !== "sqlite"))(
  "a collection with no migration writer (%s)",
  dialect => {
    it("marks a translated change of column unavailable, as its save refuses it", async () => {
      const basePath = await mkdtemp(join(tmpdir(), "nextly-type-targets-"));
      folders.push(basePath);
      vi.stubEnv("NODE_ENV", "development");
      instance = await createTestNextly({
        dialect: dialect as TestDialect,
        basePath,
        db: DB,
        localization: LOCALIZATION,
      });
      const field = { name: "v", type: "checkbox", localized: true };
      await collection(instance).create(field);
      const entity = collection(instance);
      const has = container.has.bind(container);
      vi.spyOn(container, "has").mockImplementation(
        name => name !== "builderSaveSetup" && has(name)
      );
      try {
        const target = (await entity.targets(field)).find(
          t => t.type === "number"
        );
        expect(target).toMatchObject({ blocked: "translations-column" });
        const outcome = await entity.save({ ...field, type: "number" }).then(
          () => undefined,
          (error: unknown) => error
        );
        // The push refuses the same field, for the same reason, under an apply's own error.
        expect(outcome).toMatchObject({
          publicData: {
            errors: expect.arrayContaining([
              expect.objectContaining({
                path: "fields.v",
                code: target?.refusal?.code,
              }),
            ]),
          },
        });
      } finally {
        vi.mocked(container.has).mockRestore();
      }
    });
  }
);
