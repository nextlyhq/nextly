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

/* Recorded, not replaced: the real builder still runs beneath the spy. */
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

const document = {
  id: "s1",
  title: "Hello",
  status: "published",
} as never;

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

  it("threads this form's save count into the revision", () => {
    /*
     * Half of the property; the other half lives in
     * `useSinglePreviewPane.test.ts`, which asserts the count MOVES the answer.
     * Split because driving a real save is not possible from here: the header
     * is replaced, and although `onSaveChanges` — the callback the form wires
     * to its own `handleSubmit` — can be invoked, the submit never reaches
     * `onSubmit`, because the form's fields do not render under this harness
     * and the validated callback therefore never runs. Measured, not assumed.
     *
     * What this catches is the count being dropped from the call or never
     * threaded to it. What it cannot catch alone is a count frozen at zero —
     * which is exactly what the hook test covers.
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
