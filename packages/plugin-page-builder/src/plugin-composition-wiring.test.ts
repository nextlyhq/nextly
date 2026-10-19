/**
 * Whether installing the plugin actually makes its blocks field judge
 * composition.
 *
 * `blocks-composition.test.ts` exercises the judgement directly, so all of it
 * passes with the wiring deleted from `init`. A host would then install the
 * plugin and get no check at all, with nothing anywhere reporting its absence —
 * a judgement that never runs refuses nothing, and a library with no loops in
 * it looks exactly the same either way.
 *
 * So these drive the field type the plugin CONTRIBUTES, after `init`, against a
 * store that closes a loop, and assert the refusal.
 *
 * @module plugin-composition-wiring.test
 */
import {
  clearBlocks,
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
  registerBlocks,
} from "@nextlyhq/blocks-engine";
import type {
  PluginFieldType,
  PluginFieldValidateArgs,
  PluginFieldWrite,
} from "@nextlyhq/plugin-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

import { COMPONENTS_SLUG } from "./collections/components";
import { pageBuilder } from "./plugin";

/** The parts of a plugin context `init` reaches for, and nothing more. */
function initContext(renameMap: Record<string, string> = {}) {
  return {
    self: {
      collections: { ...renameMap },
      singles: {},
      name: "@nextlyhq/plugin-page-builder",
    },
    hooks: {
      on: vi.fn(),
      off: vi.fn(),
      onBeforeOperation: vi.fn(),
      offBeforeOperation: vi.fn(),
    },
    services: {
      collections: { getCollection: vi.fn(async () => ({})) },
      plugins: {},
    },
    config: {},
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  };
}

/** A component document placing the ids given. */
const places = (...ids: string[]) => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "component",
  nodes: ids.map((componentId, i) => ({
    id: `n${String(i)}`,
    type: COMPONENT_INSTANCE_TYPE,
    version: 1,
    props: { componentId },
  })),
});

/** A write of component `a` in `collection`, over a store where `b` places `a`. */
function savingA(collection: string, field: string): PluginFieldValidateArgs {
  const write: PluginFieldWrite = {
    kind: "collection",
    slug: collection,
    id: "a",
    inTransaction: false,
    readStored: async target =>
      target.collection === collection && target.id === "b"
        ? { kind: "value", value: places("a") }
        : { kind: "absent" },
  };
  return {
    data: { [field]: places("b") },
    req: {},
    field: { name: field, type: "blocks", blocks: { kinds: ["component"] } },
    path: field,
    mode: "update",
    write,
  };
}

/** The blocks field type the plugin contributes. */
function blocksType(plugin: ReturnType<typeof pageBuilder>): PluginFieldType {
  const type = plugin.contributes?.fieldTypes?.find(t => t.type === "blocks");
  if (type?.validate === undefined) throw new Error("no blocks field type");
  return type;
}

/** The codes a validation answered with; empty when it accepted. */
async function codesOf(
  type: PluginFieldType,
  args: PluginFieldValidateArgs
): Promise<string[]> {
  const result = await type.validate?.(args.data[args.path], args);
  if (result === true) return [];
  if (typeof result === "string") return ["CUSTOM"];
  return (result ?? []).map(issue => issue.code ?? "CUSTOM");
}

describe("the plugin's blocks field judges composition once installed", () => {
  it("refuses a component save that closes a loop", async () => {
    const plugin = pageBuilder();
    await plugin.init?.(initContext() as never);

    expect(
      await codesOf(blocksType(plugin), savingA(COMPONENTS_SLUG, "content"))
    ).toEqual(["COMPONENT_CYCLE"]);
  });

  it("follows a host's rename of the components collection", async () => {
    // Judged under the declared name, a write to the renamed collection would
    // not be recognised as a component's, and nothing would be refused.
    const plugin = pageBuilder();
    await plugin.init?.(
      initContext({ [COMPONENTS_SLUG]: "host_components" }) as never
    );

    expect(
      await codesOf(blocksType(plugin), savingA("host_components", "content"))
    ).toEqual(["COMPONENT_CYCLE"]);
  });

  it("judges the store a host was told to keep components in", async () => {
    const plugin = pageBuilder({
      componentReadiness: { collection: "site_components", field: "blocks" },
    });
    await plugin.init?.(
      initContext({ [COMPONENTS_SLUG]: "host_components" }) as never
    );

    expect(
      await codesOf(blocksType(plugin), savingA("site_components", "blocks"))
    ).toEqual(["COMPONENT_CYCLE"]);
  });

  afterEach(() => {
    clearBlocks();
  });

  it("does not compose pages against its store when component readiness is off", async () => {
    const base = {
      version: 1,
      description: "A block.",
      example: { props: {} },
      render: () => null,
    };
    registerBlocks(
      [
        { ...base, name: "acme/columns" },
        { ...base, name: "acme/column", parent: ["acme/columns"] },
      ] as never,
      { source: "acme" }
    );
    // Off is the setting for a renderer drawing components from its own
    // source. Composed against the store, this page would be refused: its
    // component's root is a column, which may only sit inside columns.
    const page: PluginFieldValidateArgs = {
      data: {
        content: {
          formatVersion: DOCUMENT_FORMAT_VERSION,
          kind: "page",
          nodes: [
            {
              id: "i1",
              type: COMPONENT_INSTANCE_TYPE,
              version: 1,
              props: { componentId: "cols" },
            },
          ],
        },
      },
      req: {},
      field: { name: "content", type: "blocks" },
      path: "content",
      mode: "update",
      write: {
        kind: "collection",
        slug: "pages",
        id: "p1",
        inTransaction: false,
        readStored: async target =>
          target.id === "cols"
            ? {
                kind: "value",
                value: {
                  formatVersion: DOCUMENT_FORMAT_VERSION,
                  kind: "component",
                  nodes: [
                    { id: "c", type: "acme/column", version: 1, props: {} },
                  ],
                },
              }
            : { kind: "absent" },
      },
    };

    // CONTROL: with readiness on, the same page is refused.
    const judging = pageBuilder();
    await judging.init?.(initContext() as never);
    expect(await codesOf(blocksType(judging), page)).toEqual([
      "restricted-at-root",
    ]);

    const off = pageBuilder({ componentReadiness: false });
    await off.init?.(initContext() as never);
    expect(await codesOf(blocksType(off), page)).toEqual([]);
    // A save to the store itself is still judged for a loop.
    expect(
      await codesOf(blocksType(off), savingA(COMPONENTS_SLUG, "content"))
    ).toEqual(["COMPONENT_CYCLE"]);
  });

  it("judges only the document's own rules before it is installed", async () => {
    // With nothing installed there is no store to name, so composition is not
    // judged — rather than judged against a guess.
    const plugin = pageBuilder();

    expect(
      await codesOf(blocksType(plugin), savingA(COMPONENTS_SLUG, "content"))
    ).toEqual([]);
  });
});
