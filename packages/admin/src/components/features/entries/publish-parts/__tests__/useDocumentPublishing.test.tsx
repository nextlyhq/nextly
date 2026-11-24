/**
 * Publishing as an editor's page offers it, from the press to what it says afterwards: one click
 * and the notice, or the choice of what goes live and then the notice.
 *
 * The plausible broken pages: one whose one-click publish says nothing of the translations it left
 * out of date, one whose notice follows the one-click publish alone and not the dialog's, one that
 * opens the choice without what the press decided (the shared fields unchosen), and one that
 * counts every field already out of date as newly so where the overview was never read.
 */
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, waitFor, within } from "@admin/__tests__/utils";
import type {
  PartsLanguageOutcome,
  PublishPartsChoice,
} from "@admin/services/publishParts";

import { useDocumentPublishing } from "../useDocumentPublishing";
import type { SmartPublishHost } from "../useSmartPublish";

const api = vi.hoisted(() => ({
  publishParts: vi.fn(),
  findByID: vi.fn(),
}));

vi.mock("@admin/services/entryApi", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@admin/services/entryApi")>();
  return {
    ...actual,
    entryApi: {
      ...actual.entryApi,
      publishParts: api.publishParts,
      findByID: api.findByID,
    },
  };
});
vi.mock("@admin/hooks/useCan", () => ({ useCan: () => true }));
// No workflow holds the document.
vi.mock("@admin/hooks/queries/useReviewState", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/hooks/queries/useReviewState")
  >()),
  useReviewState: () => ({ data: { attached: false } }),
}));

const LOCALES = [
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
];

/** The overview, with Spanish's title made from English, out of date or not. */
const overview = (outOfDate: boolean) => ({
  en: { status: "published" },
  es: {
    status: "published",
    fields: { title: { origin: "person", sourceLocale: "en", outOfDate } },
  },
});

const SPANISH_LIVE: PartsLanguageOutcome = {
  locale: "es",
  outcome: "stays-published",
};
const SPANISH_HOLDS: PartsLanguageOutcome = {
  locale: "es",
  outcome: "goes-live-with-pending-change",
};

/** The route, for a post whose English holds a change and whose Spanish stands as `spanish`. */
function serve(spanish: PartsLanguageOutcome): void {
  api.publishParts.mockImplementation(
    (_s: string, _i: string, _d: string, choice: PublishPartsChoice) =>
      Promise.resolve({
        id: "post-1",
        languages: [
          { locale: "en", outcome: "goes-live-with-pending-change" as const },
          spanish,
        ].filter(
          ({ locale }) =>
            choice.locales === "all" || choice.locales.includes(locale)
        ),
        shared: { changes: false, added: false },
      })
  );
}

const publish = vi.fn<SmartPublishHost["publish"]>();

/** The page around its header: the press, the dialog and the notice. */
function Page({
  document,
  translated = true,
}: {
  document: unknown;
  translated?: boolean;
}): ReactElement {
  const publishing = useDocumentPublishing({
    target: { kind: "collection", slug: "posts", id: "post-1" },
    document,
    lifecycleEnabled: true,
    translated,
    locales: LOCALES,
    currentLocale: undefined,
    defaultLocale: "en",
    editorPath: "/admin/collections/posts/post-1",
    shown: () => undefined,
  });
  return (
    <>
      <button
        type="button"
        disabled={publishing.smartPublish === undefined}
        onClick={() =>
          void publishing.smartPublish?.({
            publish,
            save: undefined,
            unsaved: () => false,
            sharedEdited: () => false,
          })
        }
      >
        Publish
      </button>
      {publishing.notice}
      {publishing.dialog}
    </>
  );
}

const post = (over: Record<string, unknown> = {}) => ({
  id: "post-1",
  status: "published",
  _translations: overview(false),
  ...over,
});

const press = () =>
  userEvent.click(screen.getByRole("button", { name: "Publish" }));

/** The parts moved, rather than described. */
const moves = () =>
  (
    api.publishParts.mock.calls as [
      string,
      string,
      string,
      PublishPartsChoice,
    ][]
  )
    .map(([, , , choice]) => choice)
    .filter(choice => choice.describe !== true)
    .map(({ locales, shared }) => ({ locales, shared }));

/** The reads of the overview made afresh. */
const overviewReads = () =>
  (
    api.findByID.mock.calls as [
      string,
      string,
      { translationStatus?: boolean } | undefined,
    ][]
  ).filter(([, , options]) => options?.translationStatus === true);

beforeEach(() => {
  vi.resetAllMocks();
  publish.mockResolvedValue({ ok: true, item: { id: "post-1" } });
  api.findByID.mockImplementation(
    (_s: string, _i: string, options?: { translationStatus?: boolean }) =>
      Promise.resolve({
        id: "post-1",
        _rev: "7",
        ...(options?.translationStatus === true
          ? { _translations: overview(true) }
          : {}),
      })
  );
});

describe("publishing from an editor's page", () => {
  it("publishes in one click, then names the language left out of date, with a link to translate it", async () => {
    serve(SPANISH_LIVE);
    render(<Page document={post()} />);

    await press();

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Published. 1 Spanish field is now out of date."
    );
    expect(
      screen.getByRole("link", { name: "Translate Spanish" })
    ).toHaveAttribute(
      "href",
      "/admin/collections/posts/post-1?locale=es&translate=en"
    );
    expect(publish).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(moves()).toEqual([]);
  });

  it("opens the choice where another language holds changes, and says what its publish left out of date", async () => {
    serve(SPANISH_HOLDS);
    render(<Page document={post()} />);

    await press();

    const dialog = await screen.findByRole("dialog", {
      name: "Publish changes",
    });
    expect(
      within(dialog).getByRole("checkbox", { name: "English" })
    ).toBeChecked();
    expect(
      within(dialog).getByRole("checkbox", { name: "Spanish" })
    ).not.toBeChecked();
    expect(publish).not.toHaveBeenCalled();

    const confirm = within(dialog).getByRole("button", {
      name: "Publish selected",
    });
    await waitFor(() => expect(confirm).toBeEnabled());
    await userEvent.click(confirm);

    await waitFor(() =>
      expect(moves()).toEqual([{ locales: ["en"], shared: false }])
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Published. 1 Spanish field is now out of date."
    );
  });

  it("opens the choice with the shared fields chosen where they hold changes", async () => {
    serve(SPANISH_LIVE);
    render(<Page document={post({ _sharedChangesPending: true })} />);

    await press();

    const dialog = await screen.findByRole("dialog", {
      name: "Publish changes",
    });
    const shared = within(dialog).getByRole("checkbox", {
      name: "Shared fields",
    });
    expect(shared).toBeChecked();
    expect(
      await within(dialog).findByText("Shared fields change every language.")
    ).toBeInTheDocument();
    expect(publish).not.toHaveBeenCalled();
  });

  it("says nothing of translations to a person who was not read their state", async () => {
    serve(SPANISH_LIVE);
    render(<Page document={post({ _translations: undefined })} />);

    await press();

    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    expect(overviewReads()).toEqual([]);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("leaves Publish as it is for a document that is not translated", () => {
    serve(SPANISH_LIVE);
    render(<Page document={post()} translated={false} />);

    expect(screen.getByRole("button", { name: "Publish" })).toBeDisabled();
  });
});
