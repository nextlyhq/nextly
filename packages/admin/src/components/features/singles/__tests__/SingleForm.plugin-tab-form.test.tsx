/**
 * A plugin's tab on a Single's edit page, handed the Single's form as a
 * collection entry's tab is: the form's own `control` and the lock, so what
 * it writes is kept across tabs, shown by the field column when it comes
 * back, and submitted by the editor's form from whichever tab is open.
 */
import userEvent from "@testing-library/user-event";
import type { AdminContributionsMeta } from "nextly/config";
import type { JSX } from "react";
import { useController } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, waitFor } from "@admin/__tests__/utils";

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
  useDashboardUser: () => ({
    user: { id: "11111111-1111-4111-8111-111111111111" },
  }),
}));
vi.mock("@admin/hooks/queries/useDocumentLock", () => ({
  useDocumentLock: () => ({
    state: { status: "held-by-me" },
    takeOver: vi.fn(),
    requestAccess: vi.fn(),
  }),
}));
vi.mock("@admin/hooks/useDocumentAutosave", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/hooks/useDocumentAutosave")
  >()),
  useDocumentAutosave: () => ({ status: "idle", lastSavedAt: null }),
}));

import {
  registerComponent,
  unregisterComponent,
  type DocumentTabProps,
} from "@admin/lib/plugins/component-registry";

import {
  SingleForm,
  type SingleDocumentData,
  type SingleSchema,
} from "../SingleForm";

const SEO = "@acme/seo/admin#SingleSeoTab";

/** What the tab was last handed. */
let handed: DocumentTabProps | undefined;

/** Writes the Single's tagline through the form's own control. */
function SeoTab(props: DocumentTabProps): JSX.Element {
  handed = props;
  const { field } = useController({ control: props.control, name: "tagline" });
  return (
    <label>
      Search description
      <input
        value={(field.value as string | undefined) ?? ""}
        onChange={field.onChange}
      />
    </label>
  );
}

const schema = {
  slug: "homepage",
  label: "Homepage",
  fields: [
    { type: "text", name: "title", label: "Title" },
    { type: "text", name: "heroTitle", label: "Hero Title" },
    { type: "text", name: "tagline", label: "Tagline" },
  ],
} as unknown as SingleSchema;

const single = {
  id: "s1",
  updatedAt: "2026-01-01T00:00:00.000Z",
  title: "Homepage",
  heroTitle: "",
  tagline: "",
} as unknown as SingleDocumentData;

beforeEach(() => {
  vi.clearAllMocks();
  meta.contributions = {
    "single.edit": {
      tab: [
        {
          plugin: "@acme/seo",
          id: "acme-seo.seo",
          kind: "tab",
          label: "SEO",
          component: SEO,
        },
      ],
    },
  } as AdminContributionsMeta;
  window.history.replaceState(null, "", "/admin/singles/homepage");
  registerComponent(SEO, SeoTab as never);
  handed = undefined;
});
afterEach(() => {
  unregisterComponent(SEO);
  window.history.replaceState(null, "", "/");
});

describe("a plugin's tab on a Single", () => {
  it("is handed the Single's form and lock, besides the place's context", () => {
    render(<SingleForm schema={schema} document={single} onSubmit={vi.fn()} />);
    expect(handed).toMatchObject({
      context: { single: "homepage" },
      documentLock: { readOnly: false, actionsDisabled: false },
    });
    expect(handed?.control).toBeDefined();
  });

  it("keeps what each tab wrote, shows the tab's in the fields, and submits all of it from the tab", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(
      <SingleForm schema={schema} document={single} onSubmit={onSubmit} />
    );
    await user.type(screen.getByLabelText("Hero Title"), "Welcome");
    await user.click(screen.getByRole("tab", { name: "SEO" }));
    await user.type(
      screen.getByRole("textbox", { name: "Search description" }),
      "From the tab"
    );

    const form = globalThis.document.querySelector("form");
    expect(form, "the editor renders a form to submit").not.toBeNull();
    form!.requestSubmit();
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]![0]).toMatchObject({
      heroTitle: "Welcome",
      tagline: "From the tab",
    });

    await user.click(screen.getByRole("tab", { name: "Content" }));
    expect(screen.getByLabelText("Hero Title")).toHaveValue("Welcome");
    expect(screen.getByLabelText("Tagline")).toHaveValue("From the tab");
  });
});
