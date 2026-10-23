/**
 * Every door into content outside a REST request runs its call with one language list: the list
 * as it is when the call starts, brought up to date first (so a worker or script that serves no
 * requests still sees a language added in Settings elsewhere), and unchanged for the rest of the
 * call however the list changes meanwhile. One case per door, each observed where the door hands
 * the call to the service that does the work.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { container } from "../../di/container";
import type { CollectionService } from "../../domains/collections/services/collection-service";
import { wrapCollectionsForPlugin } from "../../plugins/service-opts";
import type { Nextly } from "../nextly";

import { registeredLanguages } from "./helpers/registered-languages";
import { setupTestNextly, type TestMocks } from "./helpers/test-setup";

type Languages = ReturnType<typeof registeredLanguages>;

/** What the service saw: the list when it was reached, and again after a change made meanwhile. */
async function observe(languages: Languages) {
  const reached = languages.codes();
  languages.store(["en", "de", "fr"]);
  await languages.registry.refresh({ force: true });
  return { reached, after: languages.codes() };
}

interface Door {
  name: string;
  /** Makes the call, with `seen` run where the door hands it to the service doing the work. */
  call(
    setup: { nextly: Nextly; mocks: TestMocks },
    seen: () => Promise<unknown>
  ): Promise<unknown>;
}

const PUBLISHED_FORM = {
  success: true,
  statusCode: 200,
  message: "OK",
  data: {
    docs: [
      { id: "form-1", slug: "contact", status: "published", settings: {} },
    ],
    totalDocs: 1,
  },
};

const FIELD_GROUP_RECORD = {
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
};

const DOORS: Door[] = [
  {
    name: "a Direct API collection write",
    call: async ({ nextly, mocks }, seen) => {
      mocks.collectionsHandler.createEntry.mockImplementation(async () => {
        await seen();
        return {
          success: true,
          statusCode: 201,
          message: "Created",
          data: { id: "p1" },
        };
      });
      return nextly.create({ collection: "posts", data: { title: "Hi" } });
    },
  },
  {
    name: "a form submission",
    call: async ({ nextly, mocks }, seen) => {
      mocks.collectionsHandler.listEntries.mockResolvedValueOnce(
        PUBLISHED_FORM
      );
      mocks.collectionsHandler.createEntry.mockImplementation(async () => {
        await seen();
        return {
          success: true,
          statusCode: 201,
          message: "Created",
          data: { id: "s1" },
        };
      });
      return nextly.forms.submit({ form: "contact", data: { name: "Ann" } });
    },
  },
  {
    name: "creating a field group",
    call: async ({ nextly }, seen) => {
      container.registerSingleton("fieldGroupMetadataService", () => ({
        createFieldGroup: async () => {
          await seen();
          return { record: FIELD_GROUP_RECORD, migrationStatus: "applied" };
        },
      }));
      return nextly.fieldGroups.create({
        slug: "hero",
        label: "Hero",
        fields: [{ name: "heading", type: "text" }],
      });
    },
  },
  {
    name: "updating a field group",
    call: async ({ nextly }, seen) => {
      container.registerSingleton("fieldGroupMetadataService", () => ({
        updateFieldGroup: async () => {
          await seen();
          return { record: FIELD_GROUP_RECORD };
        },
      }));
      return nextly.fieldGroups.update({
        slug: "hero",
        data: { label: "Hero banner" },
      });
    },
  },
  {
    name: "a plugin's collection write",
    call: async (_setup, seen) => {
      const collections = {
        createEntry: async () => {
          await seen();
          return { id: "p1" };
        },
      } as unknown as CollectionService;
      return wrapCollectionsForPlugin(collections, {
        listRoleSlugs: async () => [],
      }).createEntry("posts", { title: "Hi" });
    },
  },
];

describe("the languages a call made outside a request sees", () => {
  let setup: ReturnType<typeof setupTestNextly>;

  beforeEach(() => {
    setup = setupTestNextly();
  });

  afterEach(() => {
    setup.cleanup();
  });

  it.each(DOORS)(
    "are one list, current when the call starts, through $name",
    async door => {
      const languages = registeredLanguages(["en"]);
      await languages.registry.refresh();
      // Added on another instance since this one last read the list.
      languages.store(["en", "de"]);

      let seen: unknown;
      await door.call(setup, async () => {
        seen = await observe(languages);
      });

      expect(seen).toEqual({ reached: ["en", "de"], after: ["en", "de"] });
      expect(languages.codes()).toEqual(["en", "de", "fr"]);
    }
  );
});
