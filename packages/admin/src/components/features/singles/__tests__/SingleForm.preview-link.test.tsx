/**
 * The join between `SingleForm` and its header for the shareable link.
 *
 * The halves are covered elsewhere — `entry-address.test.tsx` pins the locale
 * outcomes and `EntrySystemHeader.preview.test.tsx` pins what the header
 * renders given props — and neither sees the conjunction that consumes them.
 * The collection form has the same seam and the same tests, for the reason
 * recorded there: removing the `unresolved` guard leaves every test around the
 * helper green, because a helper is unchanged when its caller stops consulting
 * it.
 *
 * The Single case is the sharper one. A Single is addressed by slug, so there
 * is no unsaved state to withhold the control for, and the locale is the ONLY
 * thing that can make a link wrong: on a localized Single opened in its default
 * language the editor's active locale is `undefined`, and a token minted with
 * no locale claim covers every translation — including the unpublished ones.
 *
 * So these assert the PROPS the header actually receives and the ARGS the mint
 * hook is actually called with, rather than reconstructing either decision
 * here: a hand-copied condition keeps passing after someone edits the line it
 * exists to watch.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import { render } from "@admin/__tests__/utils";

const { headerProps, mintArgs, localization } = vi.hoisted(() => ({
  headerProps: vi.fn(),
  mintArgs: vi.fn(),
  localization: { current: { defaultLocale: "en" } },
}));

vi.mock(
  "@admin/components/features/entries/EntryForm/EntrySystemHeader",
  () => ({
    EntrySystemHeader: (props: Record<string, unknown>) => {
      headerProps(props);
      return null;
    },
  })
);

vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => ({
    enabled: true,
    locales: [],
    defaultLocale: localization.current.defaultLocale,
    fallback: true,
    getLocale: () => undefined,
  }),
}));

vi.mock("@admin/hooks/usePreviewLink", () => ({
  usePreviewLink: (args: unknown) => {
    mintArgs(args);
    return { mutate: vi.fn(), isPending: false };
  },
}));

import { SingleForm } from "../SingleForm";

/**
 * A localized Single with a publish lifecycle — the combination that makes a
 * preview link both available and locale-sensitive.
 */
const schema = {
  slug: "landing-page",
  label: { singular: "Landing Page" },
  localized: true,
  status: true,
  fields: [{ name: "title", type: "text", label: "Title" }],
} as never;

const document = { id: "s1", title: "Hello" } as never;

function renderForm(props: Record<string, unknown> = {}) {
  return render(
    <SingleForm
      schema={schema}
      document={document}
      onSubmit={vi.fn()}
      {...props}
    />
  );
}

/** The most recent props the header was rendered with. */
function lastHeaderProps(): Record<string, unknown> {
  const calls = headerProps.mock.calls;
  expect(calls.length, "the header was never rendered").toBeGreaterThan(0);
  return calls[calls.length - 1]?.[0] as Record<string, unknown>;
}

describe("SingleForm wires the shareable link into its header", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localization.current = { defaultLocale: "en" };
  });

  it("offers the link once the language resolves", () => {
    renderForm();

    expect(lastHeaderProps().isLinkAvailable).toBe(true);
  });

  // The defect this covers. The editor represents the default language as
  // `undefined`, and an absent locale claim is not "the default language" —
  // it authorizes EVERY locale, so the recipient could open translations that
  // have never been published.
  it("mints against the resolved language, never the editor's sentinel", () => {
    renderForm();

    expect(mintArgs).toHaveBeenCalledWith(
      expect.objectContaining({ single: "landing-page", locale: "en" })
    );
  });

  it("withholds the link while the default locale is still blank", () => {
    // `useLocalization` reports `""` until the config loads. Minting then is a
    // 400, and dropping the claim to avoid that is a token covering every
    // translation — so the control is not offered at all.
    localization.current = { defaultLocale: "" };
    renderForm();

    expect(lastHeaderProps().isLinkAvailable).toBe(false);
  });

  it("scopes to the language being edited, not the default one", () => {
    renderForm({ locale: "fr" });

    expect(mintArgs).toHaveBeenCalledWith(
      expect.objectContaining({ single: "landing-page", locale: "fr" })
    );
  });

  // The negative control for the claim above: absent IS correct here, and a
  // rule that always scoped would refuse a link for every unlocalized Single.
  it("sends no locale claim for a Single that is not localized", () => {
    render(
      <SingleForm
        schema={{ ...(schema as object), localized: false } as never}
        document={document}
        onSubmit={vi.fn()}
      />
    );

    expect(mintArgs).toHaveBeenCalledWith(
      expect.not.objectContaining({ locale: expect.anything() })
    );
  });
});
