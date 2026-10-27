/**
 * The entry list reads with no language, so the server judges that read in
 * the default language. The list asks every language's translation state, and
 * shows the Languages column, only where the default-language answer allows
 * it, whatever language the page's address names.
 *
 * The two translation-status hooks are stubbed to disagree, so each case shows
 * which one the list follows; the table is stubbed to record the collection it
 * is handed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render } from "@admin/__tests__/utils";

import { EntryList } from "../EntryList";

const { useEntries, tableCollection, answers } = vi.hoisted(() => ({
  useEntries: vi.fn((_options: { params: Record<string, unknown> }) => ({
    data: undefined,
    isLoading: false,
  })),
  tableCollection: vi.fn((_collection: { localized?: boolean }) => undefined),
  answers: { onScreen: false, defaultLanguage: false },
}));

vi.mock("@admin/hooks/queries", () => ({
  useEntries,
  useBulkDeleteEntries: () => ({ mutate: vi.fn(), isPending: false }),
  useBulkUpdateEntries: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@admin/hooks/queries/useCollections", () => ({
  useCollection: () => ({
    data: { name: "posts", label: "Posts", localized: true, fields: [] },
    isLoading: false,
  }),
}));
vi.mock("@admin/hooks/useCanRequest", () => ({
  useAsksTranslationStatus: () => answers.onScreen,
  useDefaultLanguageAsksTranslationStatus: () => answers.defaultLanguage,
}));
vi.mock("@admin/hooks/useCan", () => ({ useCan: () => false }));
vi.mock("@admin/hooks/usePluginAutoRegistration", () => ({
  usePluginAutoRegistration: () => undefined,
}));
vi.mock("../EntryTable", () => ({
  EntryTable: (props: { collection: { localized?: boolean } }) => {
    tableCollection(props.collection);
    return null;
  },
}));

/** The params of the list's latest read. */
const lastRead = (): Record<string, unknown> =>
  useEntries.mock.calls.at(-1)?.[0].params ?? {};

describe("the entry list's translation state", () => {
  beforeEach(() => {
    useEntries.mockClear();
    tableCollection.mockClear();
  });

  it("is not asked where only the language on screen allows it", () => {
    answers.onScreen = true;
    answers.defaultLanguage = false;
    render(<EntryList collectionSlug="posts" />);

    expect(lastRead().translationStatus).toBeUndefined();
    expect(tableCollection.mock.calls.at(-1)?.[0].localized).toBe(false);
  });

  it("is asked where the default language allows it", () => {
    answers.onScreen = false;
    answers.defaultLanguage = true;
    render(<EntryList collectionSlug="posts" />);

    expect(lastRead().translationStatus).toBe(true);
    expect(tableCollection.mock.calls.at(-1)?.[0].localized).toBe(true);
  });
});
