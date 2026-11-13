/**
 * A Direct API call brings this process's definitions up to the stored schema version before it
 * runs, as a request's start does, and a call made inside a request or another call does not: it
 * keeps the definitions that one started with, never reloaded under it. Observed at the one check
 * both doors share (`servedSchemaVersion`), for a collection or Single call (`runAsCaller`) and for
 * a pinned namespace's method (`withLanguagesPinned`), and through a real instance, whose principal
 * boundary opens a memo of its own before either door runs.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { runWithAccessMemo } from "../../auth/access/request-memo";
import { container } from "../../di/container";
import { runAsCaller, withLanguagesPinned } from "../namespaces/helpers";

import { setupTestNextly } from "./helpers/test-setup";

const served = vi.hoisted(() => vi.fn(async () => 1));
vi.mock("../../route-handler/schema-version", () => ({
  servedSchemaVersion: served,
}));

afterEach(() => {
  served.mockClear();
});

describe("a Direct API call and the stored schema version", () => {
  it("checks it before a collection or Single call made on its own", async () => {
    let checkedBefore = false;
    await runAsCaller({}, {}, async () => {
      checkedBefore = served.mock.calls.length === 1;
      return null;
    });
    expect(checkedBefore).toBe(true);
  });

  it("checks it before a pinned namespace's method made on its own", async () => {
    const forms = withLanguagesPinned({
      find: async () => served.mock.calls.length,
    });
    expect(await forms.find()).toBe(1);
  });

  it("checks it for a call made on its own through the instance, past the boundary's own memo", async () => {
    const setup = setupTestNextly();
    try {
      let checkedBefore = false;
      container.registerSingleton("fieldGroupMetadataService", () => ({
        createFieldGroup: async () => {
          checkedBefore = served.mock.calls.length === 1;
          return {
            record: {
              id: "fg-1",
              slug: "hero",
              label: "Hero",
              tableName: "comp_hero",
              fields: [],
              source: "ui",
              locked: false,
              schemaHash: "h",
              schemaVersion: 1,
              migrationStatus: "applied",
            },
            migrationStatus: "applied",
          };
        },
      }));
      await setup.nextly.fieldGroups.create({
        slug: "hero",
        label: "Hero",
        fields: [{ name: "heading", type: "text" }],
      });
      expect(checkedBefore).toBe(true);
    } finally {
      setup.cleanup();
    }
  });

  it("checks it once for a call and any call made inside it", async () => {
    await runAsCaller({}, {}, async () => {
      await runAsCaller({}, {}, async () => null);
      return null;
    });
    expect(served).toHaveBeenCalledTimes(1);
  });

  it("does not check it for a call made inside a request or another call", async () => {
    const forms = withLanguagesPinned({ find: async () => "found" });
    await runWithAccessMemo(async () => {
      await runAsCaller({}, {}, async () => null);
      await forms.find();
    });
    expect(served).not.toHaveBeenCalled();
  });
});
