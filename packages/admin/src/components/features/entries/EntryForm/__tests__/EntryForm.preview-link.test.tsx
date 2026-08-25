/**
 * The join between `EntryForm` and its header for the shareable link.
 *
 * The two halves are covered separately — `entry-address.test.tsx` pins the
 * locale outcomes, `EntrySystemHeader.preview.test.tsx` pins what the header
 * renders given props — and neither sees the conjunction that consumes them.
 * Measured: removing the `unresolved` guard from `EntryForm` leaves all 126
 * tests in this directory green, because the helper is unchanged when its
 * caller stops consulting it. That is the same shape as the defect this whole
 * change repairs, where every layer was built and nothing joined them.
 *
 * So these assert the PROPS the header actually receives, rather than
 * reconstructing the decision here: a hand-copied condition keeps passing
 * after someone edits the line it exists to watch.
 */
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { render } from "@admin/__tests__/utils";

const { headerProps, mintArgs, localization, settings } = vi.hoisted(() => ({
  headerProps: vi.fn(),
  mintArgs: vi.fn(),
  localization: { current: { defaultLocale: "en" } },
  settings: { current: { siteUrl: "https://site.example" } },
}));

vi.mock("../EntrySystemHeader", () => ({
  EntrySystemHeader: (props: Record<string, unknown>) => {
    headerProps(props);
    return null;
  },
}));

vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => ({
    enabled: true,
    locales: [],
    defaultLocale: localization.current.defaultLocale,
    fallback: true,
    getLocale: () => undefined,
  }),
}));

vi.mock("@admin/hooks/queries/useGeneralSettings", () => ({
  useGeneralSettings: () => ({ data: settings.current }),
}));

vi.mock("@admin/hooks/usePreviewLink", () => ({
  DEFAULT_PREVIEW_ROUTE: "/api/preview",
  buildPreviewUrl: () => "https://site.example/api/preview?token=t",
  usePreviewLink: (args: unknown) => {
    mintArgs(args);
    return { mutate: vi.fn(), isPending: false };
  },
}));

import { EntryForm } from "../EntryForm";

/** A localized collection with one text field, the minimum this form needs. */
const collection = {
  name: "posts",
  label: "Posts",
  localized: true,
  fields: [{ name: "title", type: "text", label: "Title" }],
} as never;

const entry = { id: "e1", title: "Hello" } as never;

function renderForm(children?: ReactNode) {
  return render(
    <>
      <EntryForm collection={collection} entry={entry} mode="edit" />
      {children}
    </>
  );
}

/** The most recent props the header was rendered with. */
function lastHeaderProps(): Record<string, unknown> {
  const calls = headerProps.mock.calls;
  expect(calls.length, "the header was never rendered").toBeGreaterThan(0);
  return calls[calls.length - 1]?.[0] as Record<string, unknown>;
}

describe("EntryForm wires the shareable link into its header", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localization.current = { defaultLocale: "en" };
    settings.current = { siteUrl: "https://site.example" };
  });

  it("offers the link once the language resolves", () => {
    renderForm();

    expect(lastHeaderProps().isLinkAvailable).toBe(true);
  });

  it("withholds the link while the default locale is still blank", () => {
    // `useLocalization` reports `""` until the config loads. Minting then is a
    // 400, and dropping the claim to avoid that is a token covering every
    // translation — so the control is not offered at all.
    localization.current = { defaultLocale: "" };
    renderForm();

    expect(lastHeaderProps().isLinkAvailable).toBe(false);
  });

  it("mints against the resolved language, never the editor's sentinel", () => {
    // The default language is `locale === undefined` in the editor, and an
    // absent locale claim authorizes every locale.
    renderForm();

    expect(mintArgs).toHaveBeenCalledWith(
      expect.objectContaining({
        collection: "posts",
        entryId: "e1",
        locale: "en",
      })
    );
  });

  it("passes no site url, because the browser is not where one is known", () => {
    // Asserted as an ABSENCE rather than left implicit. `settings` is a system
    // resource the sharing roles cannot read, so a site URL reaching the hook
    // from here would either be missing for exactly those roles or be the
    // admin's own origin standing in for the site's.
    renderForm();

    expect(mintArgs).toHaveBeenCalledWith(
      expect.not.objectContaining({ siteUrl: expect.anything() })
    );
    expect(mintArgs).toHaveBeenCalledWith(
      expect.not.objectContaining({ previewRoute: expect.anything() })
    );
  });

  it("hands the header a handler rather than only a flag", () => {
    // `PreviewActions` requires both; a flag with no handler renders nothing,
    // which would look exactly like the feature being unavailable.
    renderForm();

    expect(typeof lastHeaderProps().onCopyLink).toBe("function");
  });
});

/*
 * The OTHER half of the same control, and the one that was missing entirely.
 *
 * `useEntryPreview` answers both of these and was called by nothing, so
 * `isPreviewAvailable` and `onPreview` arrived at the header as their defaults
 * and `PreviewActions` could only ever draw its copy-link shape. Every layer
 * existed — the hook, its 24 tests, the control's four shapes, the server
 * resolver — and nothing joined them, which is the defect this file's own
 * docblock describes for the link half.
 *
 * So these assert the PROPS the header receives, for the same reason the link
 * tests do: reconstructing the condition here would keep passing after someone
 * edits the line that decides it.
 */
describe("EntryForm wires the preview action into its header", () => {
  /** A collection that declares a preview, which the one above does not. */
  const previewable = {
    ...(collection as unknown as Record<string, unknown>),
    admin: { preview: { hasPreview: true, label: "View page" } },
  } as never;

  beforeEach(() => {
    vi.clearAllMocks();
    localization.current = { defaultLocale: "en" };
    settings.current = { siteUrl: "https://site.example" };
  });

  function renderPreviewable(mode: "edit" | "create" = "edit"): void {
    render(
      <EntryForm
        collection={previewable}
        {...(mode === "create" ? {} : { entry })}
        mode={mode}
      />
    );
  }

  it("offers the preview action when the collection declares one", () => {
    renderPreviewable();

    expect(lastHeaderProps().isPreviewAvailable).toBe(true);
  });

  it("hands the header a handler rather than only a flag", () => {
    // The same trap as the link half: `PreviewActions` draws nothing without
    // both, so a flag alone is indistinguishable from no preview at all — and
    // that is exactly the state this change repairs.
    renderPreviewable();

    expect(typeof lastHeaderProps().onPreview).toBe("function");
  });

  it("carries the collection's own label through", () => {
    // Proves the props come from the hook reading this collection rather than
    // from a default that would look identical on a collection labelled
    // "Preview".
    renderPreviewable();

    expect(lastHeaderProps().previewLabel).toBe("View page");
  });

  it("offers nothing for a collection that declares no preview", () => {
    // The negative control. Without it, a wiring that hardcoded `true` would
    // satisfy every assertion above.
    renderForm();

    expect(lastHeaderProps().isPreviewAvailable).toBe(false);
    expect(lastHeaderProps().onPreview).toBeUndefined();
  });

  it("withholds the preview while the language is still unknown", () => {
    // The token's scope is what the preview route redirects from, so opening
    // without a resolved language sends the editor to the default translation
    // rather than the one on screen. The link half withholds here too, for a
    // different reason — an unscoped token grants every translation — and both
    // reasons bite.
    localization.current = { defaultLocale: "" };
    renderPreviewable();

    expect(lastHeaderProps().isPreviewAvailable).toBe(false);
    expect(lastHeaderProps().onPreview).toBeUndefined();
  });

  it("withholds the preview while the entry is unsaved", () => {
    // What opens renders the SAVED row, so on a create form the address names
    // nothing yet. Offering it would open a 404 the author cannot act on.
    renderPreviewable("create");

    expect(lastHeaderProps().isPreviewAvailable).toBe(false);
    expect(lastHeaderProps().onPreview).toBeUndefined();
  });
});
