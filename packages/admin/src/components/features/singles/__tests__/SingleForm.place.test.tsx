/**
 * The entry form's place in the Single editor: plugins' blocks around the
 * form's own fields, in the order the server sent, each told which Single the
 * form edits; and nothing changed in the editor when nothing is contributed.
 */
import type { AdminContributionsMeta } from "nextly/config";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import {
  HeaderTrail,
  HeaderTrailProvider,
} from "@admin/components/layout/header/HeaderTrail";
import { registerComponent } from "@admin/lib/plugins/component-registry";

const SIGNED_IN = "11111111-1111-4111-8111-111111111111";

// What the admin metadata delivers to the form's place, set per case.
const meta = vi.hoisted(() => ({
  contributions: undefined as AdminContributionsMeta | undefined,
}));

vi.mock("@admin/context/providers/BrandingProvider", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/context/providers/BrandingProvider")
  >()),
  useBranding: () => ({ contributions: meta.contributions }),
}));
vi.mock("@admin/hooks/useDashboardUser", () => ({
  useDashboardUser: () => ({ user: { id: SIGNED_IN } }),
}));

vi.mock("@admin/hooks/queries/useDocumentLock", () => ({
  useDocumentLock: () => ({
    state: { status: "held-by-me" },
    takeOver: vi.fn(),
    requestAccess: vi.fn(),
  }),
}));
vi.mock(
  "@admin/components/features/entries/EntryForm/DocumentLockBanner",
  () => ({ DocumentLockBanner: () => <p>lock banner</p> })
);
vi.mock(
  "@admin/components/features/entries/EntryForm/AutosaveRecoveryBanner",
  () => ({ LiveDocumentRecoveryOffer: () => <p>recovery banner</p> })
);
vi.mock(
  "@admin/components/features/versions/viewed-version-host",
  async importOriginal => ({
    ...(await importOriginal<
      typeof import("@admin/components/features/versions/viewed-version-host")
    >()),
    ViewedVersionBody: ({
      children,
      bannerSlot,
    }: {
      children?: ReactNode;
      bannerSlot?: HTMLElement | null;
    }) => {
      const banner = <p>version banner</p>;
      return (
        <>
          {bannerSlot ? createPortal(banner, bannerSlot) : banner}
          {children}
        </>
      );
    },
  })
);

import {
  SingleForm,
  type SingleDocumentData,
  type SingleSchema,
} from "../SingleForm";

const schema = {
  slug: "homepage",
  label: "Homepage",
  status: true,
  fields: [
    { type: "text", name: "title", label: "Title" },
    { type: "text", name: "heroTitle", label: "Hero Title" },
  ],
} as unknown as SingleSchema;

const document = {
  id: "s1",
  updatedAt: "2026-01-01T00:00:00.000Z",
  title: "Homepage",
  heroTitle: "",
  status: "draft",
} as unknown as SingleDocumentData;

const BLOCK = "@acme/a/admin#FormBlock";
registerComponent(BLOCK, ((props: { context?: unknown }) => (
  <pre data-testid="form-block">{JSON.stringify(props.context)}</pre>
)) as never);

function renderEditor() {
  return render(
    <HeaderTrailProvider>
      <HeaderTrail />
      <SingleForm schema={schema} document={document} onSubmit={vi.fn()} />
    </HeaderTrailProvider>
  );
}

/** The form's own fields, as the editor frames them. */
function fields(): HTMLElement {
  return screen
    .getByLabelText("Hero Title")
    .closest<HTMLElement>("[class~='@4xl/content:p-8']")!;
}

beforeEach(() => {
  meta.contributions = undefined;
  window.localStorage.clear();
});
afterEach(() => {
  window.localStorage.clear();
});

describe("the entry form's place in the Single editor", () => {
  it("with no contributions the editor draws as before", () => {
    renderEditor();

    // The fields stand straight in the editor's column, after the title, as
    // they did before the place: nothing wraps them and nothing is added.
    const column = fields().parentElement!;
    expect(column.children).toHaveLength(2);
    expect(column.lastElementChild).toBe(fields());
    expect(
      column.firstElementChild?.contains(screen.getByLabelText("Title"))
    ).toBe(true);
  });

  it("draws a block before the fields, told which Single the form edits", () => {
    meta.contributions = {
      "entry.form": {
        block: [
          {
            plugin: "@acme/a",
            id: "acme-a.form-block",
            kind: "block",
            component: BLOCK,
          },
          { builtIn: "fields" },
        ],
      },
    } as AdminContributionsMeta;
    renderEditor();

    const drawn = screen.getByTestId("form-block");
    expect(drawn.nextElementSibling).toBe(fields());
    expect(JSON.parse(drawn.textContent ?? "")).toEqual({
      userId: SIGNED_IN,
      kind: "single",
      slug: "homepage",
      entryId: "s1",
    });
  });
});
