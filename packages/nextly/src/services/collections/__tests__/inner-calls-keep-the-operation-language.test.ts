/**
 * A call one inner service makes to another, inside an operation, is judged
 * in that operation's languages rather than its own.
 *
 * `CollectionEntryService` sets each operation's languages once, around its
 * call into the services behind it. Those services call one another without
 * setting languages again: a duplicate reads its source entry, a bulk update
 * updates each entry, a bulk delete deletes each one. So each of those is
 * told the languages of the operation it belongs to.
 *
 * The duplicate is the case where that differs from the inner call judged on
 * its own. English falls back to German here, and a duplicate copies what a
 * read of its source shows in English, so it is told `["en", "de"]`; its
 * create is told the same, where a create on its own is told `["en"]`. Each
 * is told at least the languages it involves, so a rule limited to some
 * languages still refuses what reaches beyond them.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  currentRuleLanguage,
  type RuleLanguage,
  writeLanguagesFor,
} from "../../../auth/access/rule-language";
import { CollectionBulkService } from "../../../domains/collections/services/collection-bulk-service";
import { CollectionMutationService } from "../../../domains/collections/services/collection-mutation-service";
import { CollectionQueryService } from "../../../domains/collections/services/collection-query-service";
import type { SanitizedLocalizationConfig } from "../../../domains/i18n/config/types";
import { translatedFilter } from "../../../domains/i18n/services/translation-worklist-service";
import {
  createMockAdapter,
  createMockCollectionService,
  createMockDb,
  createMockFileManager,
  createMockHookRegistry,
  createMockRelationshipService,
  createMockSchema,
  silentLogger,
} from "../../../domains/collections/__tests__/collection-test-helpers";
import { CollectionEntryService } from "../collection-entry-service";

/** English falls back to German, so a read of English alone is told both. */
const LOCALISED: SanitizedLocalizationConfig = {
  locales: [
    { code: "en", label: "en", rtl: false, fallbackLocale: ["de"] },
    { code: "fr", label: "fr", rtl: false, fallbackLocale: [] },
    { code: "de", label: "de", rtl: false, fallbackLocale: [] },
  ],
  defaultLocale: "en",
  fallback: true,
};

const REFUSED = {
  success: false,
  statusCode: 403,
  message: "Refused",
  data: null,
} as const;

function entryService(): CollectionEntryService {
  const schema = createMockSchema();
  return new CollectionEntryService(
    createMockAdapter(createMockDb({ rows: [] })) as never,
    silentLogger as never,
    createMockFileManager(schema) as never,
    createMockCollectionService() as never,
    createMockRelationshipService() as never,
    createMockHookRegistry() as never,
    undefined,
    undefined,
    LOCALISED
  );
}

/** Records the languages each inner call is told, and answers `answer`. */
function recordLanguages<T extends object>(
  prototype: T,
  method: keyof T & string,
  answer: unknown = REFUSED
): RuleLanguage[] {
  const told: RuleLanguage[] = [];
  vi.spyOn(prototype, method as never).mockImplementation((async () => {
    told.push(currentRuleLanguage());
    return answer;
  }) as never);
  return told;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a call between inner services keeps its operation's languages", () => {
  it("judges a duplicate's source read and its create in the default language and each it falls back to", async () => {
    const read = recordLanguages(CollectionQueryService.prototype, "getEntry", {
      success: true,
      statusCode: 200,
      message: "Found",
      data: { id: "source", title: "Source" },
    });
    const created = recordLanguages(
      CollectionMutationService.prototype,
      "createEntry"
    );

    await entryService().duplicateEntry({
      collectionName: "posts",
      entryId: "source",
      overrideAccess: false,
    });

    const duplicate = { locale: "en", locales: ["en", "de"] };
    expect(read).toEqual([duplicate]);
    expect(created).toEqual([duplicate]);
    // What the create would be told on its own: the fixture separates the
    // two, so a create setting its own languages again fails the case above.
    expect(writeLanguagesFor(LOCALISED, undefined)).toEqual({
      locale: "en",
      locales: ["en"],
    });
  });

  it("judges each entry of a bulk update in the default language the bulk update writes", async () => {
    const told = recordLanguages(
      CollectionMutationService.prototype,
      "updateEntry"
    );

    await entryService().bulkUpdateEntries({
      collectionName: "posts",
      ids: ["a", "b"],
      data: { title: "x" },
      overrideAccess: false,
    });

    expect(told).toEqual([
      { locale: "en", locales: ["en"] },
      { locale: "en", locales: ["en"] },
    ]);
  });

  it("judges each entry of a bulk delete in every language, as the bulk delete is", async () => {
    const told = recordLanguages(
      CollectionMutationService.prototype,
      "deleteEntry"
    );

    await entryService().bulkDeleteEntries({
      collectionName: "posts",
      ids: ["a"],
      overrideAccess: false,
    });

    expect(told).toEqual([{ locales: ["en", "fr", "de"] }]);
  });
});

describe("an operation that reaches past the language it names", () => {
  it("judges discarding a working draft in a language the site does not configure in every language", async () => {
    const told = recordLanguages(
      CollectionMutationService.prototype,
      "discardWorkingDraft",
      undefined
    );

    await entryService().discardWorkingDraft({
      collectionName: "posts",
      entryId: "a",
      locale: "xx",
    });

    expect(told).toEqual([{ locales: ["en", "fr", "de"] }]);
  });

  it("judges a bulk update by query in every language, as its filter may read any", async () => {
    const told = recordLanguages(
      CollectionBulkService.prototype,
      "bulkUpdateByQuery"
    );

    await entryService().bulkUpdateByQuery({
      collectionName: "posts",
      // The reserved filter is outside `WhereFilter`'s published shape, as
      // the translation worklist passes it.
      where: translatedFilter("fr", "missing") as never,
      data: { title: "x" },
      overrideAccess: false,
    });

    expect(told).toEqual([{ locales: ["en", "fr", "de"] }]);
  });
});
