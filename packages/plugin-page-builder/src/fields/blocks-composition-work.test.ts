/**
 * Every composition a save runs is charged to that save's one work allowance.
 *
 * Watched through the resolver itself, because the allowance is what the
 * resolver spends: a call made without it composes for free, and a save made of
 * enough such calls is unbounded however small its allowance.
 */
import * as engine from "@nextlyhq/blocks-engine";
import {
  clearBlocks,
  COMPONENT_INSTANCE_TYPE,
  DEFAULT_LIMITS,
  DOCUMENT_FORMAT_VERSION,
  registerBlocks,
} from "@nextlyhq/blocks-engine";
import type { PluginFieldWrite } from "@nextlyhq/plugin-sdk";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { compositionIssues, type HostFinder } from "./blocks-composition";

vi.mock("@nextlyhq/blocks-engine", async original => {
  const actual = await original<typeof engine>();
  return {
    ...actual,
    resolveComponentInstances: vi.fn(actual.resolveComponentInstances),
  };
});

const COMPONENTS = "nx_pb_components";

beforeEach(() => {
  registerBlocks(
    [
      {
        version: 1,
        description: "A block.",
        example: { props: {} },
        render: () => null,
        name: "acme/box",
      },
    ] as never,
    { source: "acme" }
  );
});

afterEach(() => {
  clearBlocks();
  vi.mocked(engine.resolveComponentInstances).mockClear();
});

type Node = Record<string, unknown>;

const box = (id: string, children: Node[] = []): Node => ({
  id,
  type: "acme/box",
  version: 1,
  props: {},
  slots: { children },
});

const component = (nodes: Node[], envelope: Node = {}) => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "component",
  nodes,
  ...envelope,
});

it("charges the depth probes of each selection to the save's allowance", async () => {
  const stored: Record<string, unknown> = {
    deep: component([box("d1")]),
    home: {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [
        {
          id: "i1",
          type: COMPONENT_INSTANCE_TYPE,
          version: 1,
          props: { componentId: "deep" },
        },
      ],
    },
  };
  const write: PluginFieldWrite = {
    kind: "collection",
    slug: COMPONENTS,
    id: "deep",
    inTransaction: false,
    readStored: async target =>
      target.id in stored
        ? { kind: "value", value: stored[target.id] }
        : { kind: "absent" },
  };
  const hostsOf: HostFinder = {
    whole: async () => true,
    placing: async () => ({
      hosts: [
        { slug: "pages", id: "home", field: "content", localized: false },
      ],
      complete: true,
    }),
  };
  // Deeper, with a variant, so the footprint probes two selections.
  const deeper = component([box("d1", [box("d2")])], {
    variants: { tall: { label: "Tall", overrides: {} } },
  });

  await compositionIssues(
    deeper,
    {
      path: "content",
      data: { content: deeper, status: "published" },
      write,
    },
    {
      store: { collection: COMPONENTS, field: "content" },
      limits: DEFAULT_LIMITS,
      hostsOf,
      composesDocuments: true,
    }
  );

  const calls = vi.mocked(engine.resolveComponentInstances).mock.calls;
  const probes = calls.filter(([, , options]) =>
    Number.isFinite(options?.maxComposedDepth)
  );
  // The footprint asked for each selection's component depth, before and after.
  expect(probes.length).toBeGreaterThan(0);
  const allowances = new Set(calls.map(([, , options]) => options?.work));
  expect(allowances.size).toBe(1);
  expect([...allowances][0]).toEqual({ left: expect.any(Number) });
});
