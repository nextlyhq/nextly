/**
 * A definition action on a component store whose document field is
 * translated: the component is read, planned and written in the language the
 * request names, and in none where the store is not translated.
 */
import {
  createBlockRegistry,
  DOCUMENT_FORMAT_VERSION,
  type ComponentDocument,
} from "@nextlyhq/blocks-engine";
import type { PluginRouteContext } from "@nextlyhq/plugin-sdk";
import { describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({
  findByID: vi.fn(),
}));
vi.mock("@nextlyhq/plugin-sdk", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/plugin-sdk")>()),
  getCachedNextly: async () => ({ findByID: reads.findByID }),
}));

import { runDefinitionAction } from "./definition-actions-route";

const CARD: ComponentDocument = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "component",
  nodes: [
    {
      id: "k",
      type: "core/heading",
      version: 1,
      props: { text: "Neu", level: "h2" },
    },
  ],
  exposed: [],
};

function contextOver(localized: boolean) {
  reads.findByID.mockReset();
  reads.findByID.mockResolvedValue({ id: "card", document: CARD });
  const collections = {
    getCollection: vi.fn(async () => ({ localized })),
    withTransaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) =>
      work({})
    ),
    updateEntryInTransaction: vi.fn(async () => ({
      id: "card",
      document: CARD,
    })),
    updateEntry: vi.fn(async () => ({ item: { id: "card", document: CARD } })),
    warmLocalizedReadiness: async () => undefined,
  };
  const ctx = {
    self: { collections: {} },
    user: { id: "u1", email: "u1@example.test" },
    authenticatedScope: undefined,
    params: {},
    caller: {
      authMethod: "session",
      identity: async () => ({ user: { id: "u1" } }),
      can: async () => true,
    },
    services: { collections },
  } as unknown as PluginRouteContext;
  return { ctx, collections };
}

// An edit no block's declaration decides, so the registry may hold none.
const EXPOSE = {
  action: { kind: "add-variant", label: "Hell" },
  locale: "de",
};

const setup = {
  store: { collection: "components", field: "document" },
  blocks: createBlockRegistry(),
};

describe("a definition action in a language", () => {
  it("reads and writes a translated component in the language named", async () => {
    const { ctx, collections } = contextOver(true);
    await runDefinitionAction(ctx, "card", EXPOSE, setup, "ask-update");
    expect(reads.findByID).toHaveBeenCalledWith(
      expect.objectContaining({ id: "card", locale: "de", draft: true })
    );
    expect(collections.updateEntryInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      "components",
      "card",
      expect.anything(),
      expect.objectContaining({ locale: "de" })
    );
  });

  it("names no language for a store that is not translated", async () => {
    const { ctx, collections } = contextOver(false);
    await runDefinitionAction(ctx, "card", EXPOSE, setup, "ask-update");
    expect(reads.findByID).toHaveBeenCalledWith(
      expect.not.objectContaining({ locale: expect.anything() })
    );
    expect(collections.updateEntryInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      "components",
      "card",
      expect.anything(),
      expect.not.objectContaining({ locale: expect.anything() })
    );
  });
});
