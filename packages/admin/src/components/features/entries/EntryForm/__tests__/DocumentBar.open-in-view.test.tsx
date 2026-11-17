/**
 * A document open as its form offers each view it may be opened in, beside
 * History, in the view's own words: "Open in builder" on a page or a post with
 * a blocks field, at the address the admin's one rule gives that view, and
 * nothing on a document no view applies to.
 */
import userEvent from "@testing-library/user-event";
import type { FieldConfig } from "nextly/config";
import type { ReactNode } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import { navigateTo } from "@admin/lib/navigation";

import {
  EntryLocaleProvider,
  type EntryLocaleContextValue,
} from "../../EntryLocaleContext";

const title = { name: "title", type: "text" };
const excerpt = { name: "excerpt", type: "textarea" };

const COLLECTIONS = [
  { name: "pages", fields: [title, { name: "content", type: "blocks" }] },
  {
    name: "posts",
    fields: [title, excerpt, { name: "sections", type: "blocks" }],
  },
  { name: "authors", fields: [title, excerpt] },
];

const access = vi.hoisted(() => ({ mayUpdate: true }));

vi.mock("@admin/lib/navigation", async importOriginal => ({
  ...(await importOriginal<object>()),
  navigateTo: vi.fn(),
}));
vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => ({
    enabled: true,
    locales: [],
    defaultLocale: "en",
    fallback: true,
    getLocale: (code: string) =>
      ({ en: { label: "English" }, fr: { label: "French" } })[code],
  }),
}));

vi.mock("@admin/hooks/queries/useCollections", async importOriginal => ({
  ...(await importOriginal<object>()),
  useEveryNavCollection: () => ({ data: COLLECTIONS }),
}));
vi.mock("@admin/hooks/useCurrentUserPermissions", async importOriginal => {
  const original = await importOriginal<{
    useCurrentUserPermissions: () => Record<string, unknown>;
  }>();
  return {
    ...original,
    useCurrentUserPermissions: () => ({
      ...original.useCurrentUserPermissions(),
      canAccessCollection: (_slug: string, action: string) =>
        action === "updateInDefaultLanguage" ? access.mayUpdate : true,
    }),
  };
});
vi.mock("@admin/context/providers/BrandingProvider", async importOriginal => {
  const original = await importOriginal<{
    useBranding: () => Record<string, unknown>;
  }>();
  return {
    ...original,
    useBranding: () => ({
      ...original.useBranding(),
      plugins: [
        {
          name: "@acme/builder",
          documentViews: [
            {
              fieldType: "blocks",
              path: "builder",
              component: "@acme/builder#View",
              label: "Page Builder",
              openLabel: "Open in builder",
              opensFirst: "mainField",
            },
          ],
        },
      ],
    }),
  };
});

import { BarUnderTest as DocumentBar } from "./bar-under-test";

function WithForm({ children }: { children: ReactNode }) {
  const form = useForm();
  return <FormProvider {...form}>{children}</FormProvider>;
}

const fields = [{ name: "title", type: "text" }] as FieldConfig[];

/** The language the form is edited in, as the entry editor provides it. */
function editedIn(locale: string, isNonDefaultLocale: boolean) {
  return {
    locale,
    rtl: false,
    collectionLocalized: true,
    isNonDefaultLocale,
  } satisfies EntryLocaleContextValue;
}

function renderBar(
  collectionSlug: string,
  overrides: object = {},
  locale?: EntryLocaleContextValue
) {
  const bar = (
    <DocumentBar
      mode="edit"
      hasStatus={false}
      collectionSlug={collectionSlug}
      entry={{ id: "e1" } as never}
      historyFields={fields}
      isSubmitting={false}
      isDirty={false}
      {...overrides}
    />
  );
  return render(
    <WithForm>
      {locale ? (
        <EntryLocaleProvider value={locale}>{bar}</EntryLocaleProvider>
      ) : (
        bar
      )}
    </WithForm>
  );
}

const openInBuilder = () =>
  screen.queryByRole("link", { name: "Open in builder" });

beforeEach(() => {
  access.mayUpdate = true;
  vi.mocked(navigateTo).mockClear();
});

describe("DocumentBar — opening the document in its other view", () => {
  it("offers a page's form the builder, beside History, at the page's blocks field", () => {
    renderBar("pages");
    const link = screen.getByRole("link", { name: "Open in builder" });
    expect(link).toHaveAttribute(
      "href",
      "/admin/collections/pages/e1/builder?field=content"
    );
    // Beside History: History is the very next control in the bar.
    expect(link.nextElementSibling).toBe(
      screen.getByRole("button", { name: "History" })
    );
  });

  it("offers a post, which opens as a form, the builder at its blocks field", () => {
    renderBar("posts");
    expect(openInBuilder()).toHaveAttribute(
      "href",
      "/admin/collections/posts/e1/builder?field=sections"
    );
  });

  it("offers nothing on a document with no blocks field", () => {
    renderBar("authors");
    expect(openInBuilder()).not.toBeInTheDocument();
    // The control: the bar itself drew.
    expect(screen.getByRole("button", { name: "History" })).toBeInTheDocument();
  });

  it("offers nothing while creating, as there is no saved entry to open", () => {
    renderBar("posts", { mode: "create", entry: null });
    expect(openInBuilder()).not.toBeInTheDocument();
  });

  it("offers nothing to a reader who may not update the document", () => {
    access.mayUpdate = false;
    renderBar("posts");
    expect(openInBuilder()).not.toBeInTheDocument();
  });

  it("offers nothing on a form edited in another language, as the builder edits the default one", () => {
    renderBar("posts", {}, editedIn("fr", true));
    expect(openInBuilder()).not.toBeInTheDocument();
  });

  it("offers it on a form edited in the default language", () => {
    // The control for the case above: a language is named, but it is the
    // default one.
    renderBar("posts", {}, editedIn("en", false));
    expect(openInBuilder()).toHaveAttribute(
      "href",
      "/admin/collections/posts/e1/builder?field=sections"
    );
  });

  it("folds it into the document's menu on a phone, where it opens the builder", async () => {
    const user = userEvent.setup();
    renderBar("posts", { panelMode: "sheet" });
    expect(openInBuilder()).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "Open in builder" })
    );
    expect(navigateTo).toHaveBeenCalledWith(
      "/admin/collections/posts/e1/builder?field=sections"
    );
  });

  it("offers nothing on a Single, which opens as its form", () => {
    renderBar("posts", { scope: "single" });
    expect(openInBuilder()).not.toBeInTheDocument();
  });
});
