/**
 * The join between `SingleForm`, its header, and the in-admin preview pane.
 *
 * The pane itself is covered where it lives — `PreviewPanes.test.tsx` pins what
 * it costs closed and what it asks for open — and none of that sees the
 * conjunction this file is about: whether a Single is offered the pane at all,
 * and whether the pane and the shareable link beside it are pointed at the SAME
 * document in the SAME language.
 *
 * That second one is the sharp case. Both surfaces need a locale claim, both
 * are wrong in the same way without one — on a localized Single opened in its
 * default language the editor's active locale is `undefined`, and an absent
 * claim authorizes every translation rather than the default. Two callers
 * resolving that separately would agree the day it was written; these assert
 * they are the same object rather than that each is individually plausible.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import { act, render, screen } from "@admin/__tests__/utils";

const { headerProps, paneProps, mintArgs, revisionArgs, localization } =
  vi.hoisted(() => ({
    headerProps: vi.fn(),
    revisionArgs: vi.fn(),
    paneProps: vi.fn(),
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

/*
 * The pane is replaced by a recorder that still renders its children, because
 * the form below it must keep rendering either way — a stub returning null
 * would make every assertion about the editor pass for the wrong reason.
 */
vi.mock("@admin/components/features/entries/PreviewMode/PreviewPanes", () => ({
  PreviewPanes: ({
    children,
    ...rest
  }: {
    children: React.ReactNode;
  } & Record<string, unknown>) => {
    paneProps(rest);
    return (
      <div data-testid="pane" data-open={String(rest.open)}>
        {children}
      </div>
    );
  },
}));

/*
 * Recorded, not replaced in spirit: the real builder still runs, so a revision
 * asserted below is the one the pane would really receive.
 */
vi.mock(
  "@admin/components/features/entries/PreviewMode/previewRevision",
  async importOriginal => {
    const actual =
      await importOriginal<
        typeof import("@admin/components/features/entries/PreviewMode/previewRevision")
      >();
    return {
      previewRevisionOf: (doc: unknown, count: number) => {
        revisionArgs(doc, count);
        return actual.previewRevisionOf(doc, count);
      },
    };
  }
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
 * preview both available and locale-sensitive.
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

function lastHeaderProps(): Record<string, unknown> {
  const calls = headerProps.mock.calls;
  expect(calls.length, "the header was never rendered").toBeGreaterThan(0);
  return calls[calls.length - 1]?.[0] as Record<string, unknown>;
}

function lastPaneProps(): Record<string, unknown> {
  const calls = paneProps.mock.calls;
  expect(calls.length, "the pane was never rendered").toBeGreaterThan(0);
  return calls[calls.length - 1]?.[0] as Record<string, unknown>;
}

describe("SingleForm offers the preview pane", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localization.current = { defaultLocale: "en" };
  });

  it("hands the header a toggle once the language resolves", () => {
    renderForm();

    // A Single previously got only "copy a link". The toggle is what makes the
    // in-place pane reachable at all, and the header draws its button purely on
    // this prop being present.
    expect(typeof lastHeaderProps().onTogglePreviewPane).toBe("function");
    expect(lastHeaderProps().previewPaneOpen).toBe(false);
  });

  it("withholds the toggle on exactly the terms the shareable link is withheld", () => {
    /*
     * `useLocalization` reports `""` until the config loads, and a preview
     * minted then is either refused or a grant over every translation. Offering
     * a pane toggle there would put a button beside a link the form has already
     * decided not to offer — two answers to one question.
     */
    localization.current = { defaultLocale: "" };
    renderForm();

    expect(lastHeaderProps().isLinkAvailable).toBe(false);
    expect(lastHeaderProps().onTogglePreviewPane).toBeUndefined();
  });

  it("points the pane at the same scope the link mints against", () => {
    renderForm({ locale: "fr" });

    // The property, asserted as an EQUALITY rather than as two independently
    // plausible values: the pane's scope and the link's request are one object,
    // so they cannot drift into previewing different languages.
    const minted = mintArgs.mock.calls[0]?.[0];
    expect(minted).toEqual({ single: "landing-page", locale: "fr" });
    expect(lastPaneProps().scope).toEqual(minted);
  });

  it("keeps the pane closed until someone asks for it", () => {
    renderForm();

    // Closed is not merely invisible: the pane mints no credential and writes
    // no audit row while it is shut, which is only true if `open` is false.
    expect(lastPaneProps().open).toBe(false);
    expect(screen.getByTestId("pane").dataset.open).toBe("false");
  });

  it("builds the revision from the document AND this form's save count", () => {
    /*
     * The seam that carries the defect. A status-less save of a PUBLISHED
     * Single writes the working-draft sidecar and leaves the live row alone, so
     * `updatedAt` and the working-draft flag both stand still while the content
     * changes underneath them — and a revision built from the document alone
     * stops moving from the second such save onward, leaving the pane showing
     * the previous draft with nothing to say so.
     *
     * Asserted on the ARGUMENTS rather than by driving a save: the save button
     * lives inside a `toolbarSlot` on the header this file replaces, so a
     * submit here would exercise the harness rather than the form. What this
     * catches is the count being dropped from the call or never threaded to it,
     * which is the realistic regression. That the count CHANGES the answer is
     * proven where the function lives, in `previewRevision.test.ts`.
     */
    renderForm();

    expect(revisionArgs).toHaveBeenCalledWith(document, expect.any(Number));
  });

  it("closes a pane that is already open when the preview stops being available", () => {
    /*
     * Opening is a user action and availability is not — the language can stop
     * resolving underneath an open pane. Left alone it would keep rendering a
     * credential nothing would re-mint, which is the silent-staleness failure
     * this whole surface is built to avoid; and the toggle is withheld at the
     * same moment, so there would be no control left to close it with.
     */
    const { rerender } = renderForm();

    act(() => {
      (lastHeaderProps().onTogglePreviewPane as () => void)();
    });
    expect(lastPaneProps().open).toBe(true);

    localization.current = { defaultLocale: "" };
    rerender(
      <SingleForm schema={schema} document={document} onSubmit={vi.fn()} />
    );

    expect(lastPaneProps().open).toBe(false);
  });

  it("still renders the editor through the pane wrapper", () => {
    // The control for every assertion above: the form is inside the wrapper, so
    // these are statements about a rendered editor rather than about a subtree
    // that never mounted.
    renderForm();

    expect(screen.getByTestId("pane")).toBeInTheDocument();
    expect(paneProps).toHaveBeenCalled();
  });
});
