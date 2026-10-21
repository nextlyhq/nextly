/**
 * A held Single's component values, wherever the component sits, through
 * every operation a held edit goes through.
 *
 * A held draft records each fixed component with its type tag, so a restore
 * after the field is pointed at another component knows which schema the
 * value belonged to. That tag is internal: no ordinary write shows it to a
 * validator, and the live document never stores it. Each cell here places the
 * component somewhere, runs one operation, and checks the three things that
 * must hold together:
 * - the live row's stored JSON carries no tag;
 * - the component's own validators see the public shape (a child validator
 *   here refuses any internal key in its sibling data);
 * - a type the draft already recorded survives.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  defineFieldGroup,
  defineSingle,
  fieldGroup,
  group,
  repeater,
  text,
} from "../../../config";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

type Path = Array<string | number>;

/** Where the component sits, as a field definition and a path to its value. */
type Placement = {
  name: string;
  field: () => ReturnType<typeof text>;
  path: Path;
  /** A virtual field stores nothing, so there is no recorded type to check. */
  virtual?: boolean;
};

const heroComponent = () => fieldGroup({ name: "hero", component: "hero" });

const placements: Placement[] = [
  {
    name: "at the top level",
    field: () => heroComponent() as never,
    path: ["hero"],
  },
  {
    name: "inside a group",
    field: () => group({ name: "layout", fields: [heroComponent()] }) as never,
    path: ["layout", "hero"],
  },
  {
    name: "inside a component inside a group",
    field: () =>
      group({
        name: "layout",
        fields: [fieldGroup({ name: "panel", component: "panel" })],
      }) as never,
    path: ["layout", "panel", "hero"],
  },
  {
    name: "in a repeater row",
    field: () =>
      repeater({ name: "slides", fields: [heroComponent()] }) as never,
    path: ["slides", 0, "hero"],
  },
  {
    name: "in a virtual field",
    field: () =>
      fieldGroup({ name: "hero", component: "hero", virtual: true }) as never,
    path: ["hero"],
    virtual: true,
  },
];

/** A document holding `value` at `path`, building the containers on the way. */
function documentWith(path: Path, value: unknown): Record<string, unknown> {
  let built: unknown = value;
  for (let i = path.length - 1; i >= 0; i--) {
    const key = path[i];
    built = typeof key === "number" ? [built] : { [key]: built };
  }
  return built as Record<string, unknown>;
}

function valueAt(document: unknown, path: Path): unknown {
  return path.reduce<unknown>(
    (node, key) =>
      node !== null && typeof node === "object"
        ? (node as Record<string | number, unknown>)[key]
        : undefined,
    document
  );
}

type Row = {
  id: string;
  scopeSlug: string;
  versionNo: number | null;
  isAutosave: boolean | number;
  snapshot: unknown;
};

function parsed(snapshot: unknown): Record<string, unknown> {
  return (
    typeof snapshot === "string" ? JSON.parse(snapshot) : snapshot
  ) as Record<string, unknown>;
}

async function workingDraft(handle: TestNextly): Promise<Row | undefined> {
  return (await handle.adapter.select<Row>("nextly_versions")).find(
    r => r.scopeSlug === "home" && r.versionNo === null && !r.isAutosave
  );
}

/**
 * The component's child validator: refuses an internal key in the component
 * value it is part of, and refuses `code: "forbidden"`, so that a run in which
 * it is never called cannot pass for one in which it saw the public shape.
 */
const siblingsPublicOnly = (value: unknown, args: { data?: unknown }) => {
  if (value === "forbidden") return "code cannot be forbidden";
  return (
    !Object.keys((args?.data as Record<string, unknown>) ?? {}).some(key =>
      key.startsWith("_")
    ) || "the component value carried an internal key"
  );
};

async function boot(dialect: TestDialect, placement: Placement) {
  current = await createTestNextly({
    dialect,
    fieldGroups: [
      defineFieldGroup({
        slug: "hero",
        fields: [
          text({ name: "heading" }),
          text({ name: "code", validate: siblingsPublicOnly as never }),
        ],
      }),
      defineFieldGroup({ slug: "panel", fields: [heroComponent()] }),
    ],
    singles: [
      defineSingle({
        slug: "home",
        status: true,
        versions: true,
        fields: [text({ name: "title" }), placement.field()],
      }),
    ],
  });
  const singles = current.getService("singleEntryService");
  const first = await singles.update(
    "home",
    {
      title: "T",
      ...(placement.virtual
        ? {}
        : documentWith(placement.path, { heading: "Live", code: "ok" })),
      status: "published",
    },
    { overrideAccess: true }
  );
  expect(first.success, JSON.stringify(first)).not.toBe(false);
  return singles;
}

type Singles = Awaited<ReturnType<typeof boot>>;

async function hold(singles: Singles, data: Record<string, unknown>) {
  const result = await singles.update("home", data, { overrideAccess: true });
  expect(result.success, JSON.stringify(result)).not.toBe(false);
}

/** The live row as stored: no type tag anywhere in it. */
async function expectNoStoredTag(handle: TestNextly) {
  const rows =
    await handle.adapter.select<Record<string, unknown>>("single_home");
  expect(JSON.stringify(rows)).not.toContain("_componentType");
}

const held = (placement: Placement, heading: string, code = "ok") =>
  documentWith(placement.path, { heading, code });

describe.each(getConfiguredTestDialects())(
  "a held Single's component, wherever it sits (integration, %s)",
  dialect => {
    describe.each(placements)("$name", placement => {
      it("is recorded with its type by a held save, and stores no tag", async () => {
        const singles = await boot(dialect, placement);

        await hold(singles, held(placement, "Held"));

        if (!placement.virtual) {
          const draft = parsed((await workingDraft(current!))?.snapshot);
          expect(valueAt(draft, placement.path)).toMatchObject({
            heading: "Held",
            _componentType: "hero",
          });
        }
        await expectNoStoredTag(current!);
      });

      it("takes a second held patch onto the first", async () => {
        const singles = await boot(dialect, placement);
        await hold(singles, held(placement, "Held"));

        await hold(singles, held(placement, "Held", "two"));

        if (!placement.virtual) {
          const draft = parsed((await workingDraft(current!))?.snapshot);
          expect(valueAt(draft, placement.path)).toMatchObject({
            heading: "Held",
            code: "two",
            _componentType: "hero",
          });
        }
        await expectNoStoredTag(current!);
      });

      it.each([
        [
          "published by an update",
          (s: Singles) =>
            s.update("home", { status: "published" }, { overrideAccess: true }),
        ],
        [
          "promoted directly by a publish of every language",
          (s: Singles) => s.publishAllLocales("home", { overrideAccess: true }),
        ],
      ])(
        "is %s with no tag, its validators seeing the public value",
        async (_label, publish) => {
          const singles = await boot(dialect, placement);
          await hold(singles, held(placement, "Held"));

          const result = (await publish(singles)) as { success?: boolean };

          expect(result.success, JSON.stringify(result)).not.toBe(false);
          if (!placement.virtual) {
            const live = (await singles.get("home", { overrideAccess: true }))
              .data as Record<string, unknown>;
            const value = valueAt(live, placement.path) as Record<
              string,
              unknown
            >;
            expect(value).toMatchObject({ heading: "Held" });
            expect(value).not.toHaveProperty("_componentType");
          }
          await expectNoStoredTag(current!);
        }
      );

      it("records the type of a component a first held save leaves alone", async () => {
        if (placement.virtual) return;
        const singles = await boot(dialect, placement);

        await hold(singles, { title: "Other" });

        const draft = parsed((await workingDraft(current!))?.snapshot);
        expect(valueAt(draft, placement.path)).toMatchObject({
          heading: "Live",
          _componentType: "hero",
        });
      });

      it("runs the component's validators, refusing a value they refuse", async () => {
        if (placement.virtual) return;
        const singles = await boot(dialect, placement);
        const invalid = held(placement, "Held", "forbidden");

        for (const data of [invalid, { ...invalid, status: "published" }]) {
          const result = (await singles
            .update("home", data, { overrideAccess: true })
            .catch((error: unknown) => error)) as {
            success?: boolean;
            errors?: Array<{ field?: string; message: string }>;
            publicData?: { errors?: Array<{ path: string; message: string }> };
          };
          const messages = [
            ...(result.errors ?? []).map(e => e.message),
            ...(result.publicData?.errors ?? []).map(e => e.message),
          ].join(" ");
          expect(result.success, JSON.stringify(result)).not.toBe(true);
          expect(messages).toContain("code cannot be forbidden");
        }
        expect(await workingDraft(current!)).toBeUndefined();
      });

      it("keeps a type the draft recorded through a later save", async () => {
        if (placement.virtual) return;
        const singles = await boot(dialect, placement);
        await hold(singles, held(placement, "Held"));
        // As if the field had since been pointed at another component: the
        // draft recorded the value under a type the schema no longer names.
        const draftRow = (await workingDraft(current!))!;
        const recorded = parsed(draftRow.snapshot);
        (
          valueAt(recorded, placement.path) as Record<string, unknown>
        )._componentType = "retired";
        await current!.adapter.update(
          "nextly_versions",
          { snapshot: JSON.stringify(recorded) },
          { and: [{ column: "id", op: "=", value: draftRow.id }] }
        );

        await hold(singles, { title: "Later" });

        const draft = parsed((await workingDraft(current!))?.snapshot);
        expect(draft.title).toBe("Later");
        expect(valueAt(draft, placement.path)).toMatchObject({
          _componentType: "retired",
        });
      });
    });
  }
);
