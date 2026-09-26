/**
 * A hook extending a DECLARED DEPENDENCY's table must compile.
 *
 * `addColumns` permits "a plugin on a declared dependency's tables", and boot
 * accepts such a hook because boot compiles every plugin together. But
 * `migrate:create --plugin` compiled the plugin ALONE, so the target table was
 * simply absent and the hook died on `Table "..." does not exist` — a plugin
 * using a documented feature could run in development and never generate a
 * production migration.
 *
 * The command now compiles the plugin together with the dependencies it
 * declares. These cover the two halves of that: the hook resolves, and the
 * dependency's table still does not ride this plugin's module — a contributed
 * column travels the app's migration stream, with a per-element owner row
 * naming the contributor.
 */
import { describe, expect, it } from "vitest";

import { buildExtensionSchema } from "../build-extension-schema";
import { col, defineTable } from "../dsl";

const orders = defineTable("orders", { id: col.id() });
const mine = defineTable("notes", { id: col.id() });

/** The hook a plugin writes to put a column on its dependency's table. */
const extendsTheDependency = ({
  schema,
}: {
  schema: { extendTable(name: string, ext: unknown): void };
}) => {
  schema.extendTable("dep__orders", {
    columns: { fxRef: col.shortText({ nullable: true }) },
  });
};

/** What `migrate:create --plugin` compiles, with or without the dependency. */
async function compile({ withDependency }: { withDependency: boolean }) {
  return await buildExtensionSchema({
    dialect: "postgresql",
    coreTableNames: ["users", "media"],
    entities: [],
    pluginPrefixes: new Map(
      withDependency
        ? [
            ["@acme/dep", "dep"],
            ["@acme/fx", "fx"],
          ]
        : [["@acme/fx", "fx"]]
    ),
    // What the plugin's own `dependsOn` says, which is what lets `addColumns`
    // treat the contribution as legitimate rather than foreign.
    dependencies: new Map([["@acme/fx", new Set(["@acme/dep"])]]),
    plugins: [
      // Dependencies first: the list arrives topologically sorted, and a hook
      // cannot extend a table the draft has not been told about yet.
      ...(withDependency
        ? [{ owner: { kind: "plugin", id: "@acme/dep" }, tables: [orders] }]
        : []),
      {
        owner: { kind: "plugin", id: "@acme/fx" },
        tables: [mine],
        extend: [extendsTheDependency],
      },
    ] as never,
  });
}

describe("a hook that extends a declared dependency's table", () => {
  it("compiles when the dependency is compiled alongside", async () => {
    const built = await compile({ withDependency: true });

    const target = built.tables.find(t => t.name === "dep__orders");
    expect(target?.columns.map(c => c.name)).toContain("fx_ref");
  });

  it("still emits ONLY this plugin's own tables", async () => {
    // The half that keeps the fix honest. Compiling the dependency must not
    // make its table ride this plugin's migration module — the command filters
    // to the tables this plugin's stream owns, and that filter is what stops a
    // plugin module from claiming to create its dependency's table.
    const built = await compile({ withDependency: true });

    const owned = built.tables
      .filter(t => t.owner.kind === "plugin" && t.owner.id === "@acme/fx")
      .map(t => t.name);
    expect(owned).toEqual(["fx__notes"]);
  });

  it("records the contributed column against the CONTRIBUTOR", async () => {
    // How the column reaches production: as an element owned by this plugin on
    // a table owned by another, which is what a per-element owner row is for.
    const built = await compile({ withDependency: true });

    const elements = built.elementOwners.get("dep__orders") ?? [];
    expect(
      elements.map(e => ({ kind: e.elementKind, name: e.elementName }))
    ).toContainEqual({ kind: "column", name: "fx_ref" });
  });

  it("refuses when the dependency is absent", async () => {
    // The control, and the original failure. Without the dependency there is
    // no table to extend, and compiling must fail rather than quietly drop the
    // column — a module missing it would disagree with the running schema.
    const error = await compile({ withDependency: false }).catch(
      (e: unknown) => e
    );

    // Read where `migrate:create` reads it: a validation refusal carries its
    // detail in `publicData.errors`, and the command turns exactly this
    // message into one that names the plugin and what to do instead.
    const errors = (
      (error as { publicData?: { errors?: { message?: string }[] } })
        .publicData ?? {}
    ).errors;
    // Matched by its opening sentence, which is what `migrate:create`
    // recognises it by; the rest says which tables a hook can see.
    expect(
      errors?.some(e =>
        (e.message ?? "").startsWith(
          'Table "dep__orders" does not exist, so it cannot be extended.'
        )
      )
    ).toBe(true);
  });
});
