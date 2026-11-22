/**
 * Every Direct API namespace runs each call on definitions that follow the stored schema version
 * (`withCurrentSchema`), as a collection or Single call does, so no namespace is a door around the
 * check: a release's readiness, a notice, a media folder (a namespace inside a namespace) and a
 * field group are each served inside it. Observed through a real instance, where the service a
 * method reaches records whether it ran inside the check.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { container } from "../../di/container";

import { setupTestNextly } from "./helpers/test-setup";

const schema = vi.hoisted(() => ({ inside: false }));
vi.mock("../../route-handler/schema-version", async original => ({
  ...(await original<typeof import("../../route-handler/schema-version")>()),
  withCurrentSchema: async <T>(operation: () => Promise<T>): Promise<T> => {
    schema.inside = true;
    try {
      return await operation();
    } finally {
      schema.inside = false;
    }
  },
}));

let setup: ReturnType<typeof setupTestNextly>;

beforeEach(() => {
  setup = setupTestNextly();
});

afterEach(() => {
  setup.cleanup();
});

describe("every Direct API namespace and the stored schema version", () => {
  it("runs a release's readiness inside the check", async () => {
    let seen = false;
    container.registerSingleton("releasesService", () => ({
      readiness: async () => {
        seen = schema.inside;
        return { ready: true, members: [] };
      },
    }));
    await setup.nextly.releases.readiness({ releaseId: "r1" });
    expect(seen).toBe(true);
  });

  it("runs a notice count inside the check", async () => {
    let seen = false;
    container.registerSingleton("noticesService", () => ({
      count: async () => {
        seen = schema.inside;
        return 0;
      },
    }));
    await setup.nextly.notices.count({ userId: "u1" });
    expect(seen).toBe(true);
  });

  it("runs a media folder listing, a namespace inside a namespace, inside the check", async () => {
    let seen = false;
    setup.mocks.mediaService.listRootFolders.mockImplementation(async () => {
      seen = schema.inside;
      return [];
    });
    await setup.nextly.media.folders.list();
    expect(seen).toBe(true);
  });

  it("runs a field group's change inside the check, as before", async () => {
    let seen = false;
    container.registerSingleton("fieldGroupMetadataService", () => ({
      createFieldGroup: async () => {
        seen = schema.inside;
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
    expect(seen).toBe(true);
  });
});
