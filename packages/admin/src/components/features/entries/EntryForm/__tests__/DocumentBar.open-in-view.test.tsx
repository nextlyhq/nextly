/**
 * A document open as its form offers each view it may be opened in, beside
 * History, in the view's own words: "Open in builder" on a page or a post with
 * a blocks field, a Single's included, at the address the admin's one rule
 * gives that view, and nothing on a document no view applies to.
 */
import userEvent from "@testing-library/user-event";
import type { FieldConfig } from "nextly/config";
import type { ReactNode } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";
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

/** A Homepage Single, a page layout after its title; and one with no blocks. */
const SINGLES = [
  { slug: "home", fields: [title, { name: "layout", type: "blocks" }] },
  { slug: "contact", fields: [{ name: "email", type: "email" }] },
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
vi.mock("@admin/hooks/queries/useSingles", async importOriginal => ({
  ...(await importOriginal<object>()),
  useEverySingle: () => ({ data: SINGLES }),
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

/**
 * The main button's "Open in builder" row, read from its menu (opened, then
 * closed again), or null where the menu holds none. A menu with no row to
 * hold draws no arrow at all, which offers it nowhere either.
 */
async function openInBuilder(): Promise<HTMLElement | null> {
  const arrow = screen.queryByRole("button", { name: "More ways to publish" });
  if (arrow === null) return null;
  await userEvent.click(arrow);
  const menu = await screen.findByRole("menu");
  const row = within(menu).queryByRole("menuitem", { name: "Open in builder" });
  const href = row?.getAttribute("href") ?? null;
  await userEvent.keyboard("{Escape}");
  if (row === null) return null;
  // A detached copy keeping what the row said, for the assertions below.
  const copy = document.createElement("a");
  if (href !== null) copy.setAttribute("href", href);
  return copy;
}

beforeEach(() => {
  access.mayUpdate = true;
  vi.mocked(navigateTo).mockClear();
});

describe("DocumentBar — opening the document in its other view", () => {
  it("offers a page's form the builder, as a link on the main button's menu, at the page's blocks field", async () => {
    renderBar("pages");
    // Not a button of its own in the bar.
    expect(
      screen.queryByRole("link", { name: "Open in builder" })
    ).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "More ways to publish" })
    );
    const row = await screen.findByRole("menuitem", {
      name: "Open in builder",
    });
    // A link, so a modified click opens it in a new tab.
    expect(row.tagName).toBe("A");
    expect(row).toHaveAttribute(
      "href",
      "/admin/collections/pages/e1/builder?field=content"
    );
  });

  it("offers a post, which opens as a form, the builder at its blocks field", async () => {
    renderBar("posts");
    expect(await openInBuilder()).toHaveAttribute(
      "href",
      "/admin/collections/posts/e1/builder?field=sections"
    );
  });

  it("offers nothing on a document with no blocks field", async () => {
    renderBar("authors");
    expect(await openInBuilder()).toBeNull();
    // The control: the bar itself drew.
    expect(screen.getByRole("button", { name: "History" })).toBeInTheDocument();
  });

  it("offers nothing while creating, as there is no saved entry to open", async () => {
    renderBar("posts", { mode: "create", entry: null });
    expect(await openInBuilder()).toBeNull();
  });

  it("offers nothing to a reader who may not update the document", async () => {
    access.mayUpdate = false;
    renderBar("posts");
    expect(await openInBuilder()).toBeNull();
  });

  it("offers nothing on a form edited in another language, as the builder edits the default one", async () => {
    renderBar("posts", {}, editedIn("fr", true));
    expect(await openInBuilder()).toBeNull();
  });

  it("offers it on a form edited in the default language", async () => {
    // The control for the case above: a language is named, but it is the
    // default one.
    renderBar("posts", {}, editedIn("en", false));
    expect(await openInBuilder()).toHaveAttribute(
      "href",
      "/admin/collections/posts/e1/builder?field=sections"
    );
  });

  it("keeps it on the main button's menu on a phone, the same link", async () => {
    renderBar("posts", { panelMode: "sheet" });
    expect(await openInBuilder()).toHaveAttribute(
      "href",
      "/admin/collections/posts/e1/builder?field=sections"
    );
  });

  it("offers a Single's form the builder at the Single's own address", async () => {
    renderBar("home", { scope: "single" });
    expect(await openInBuilder()).toHaveAttribute(
      "href",
      "/admin/singles/home/builder?field=layout"
    );
  });

  it("offers a Single read here, or with no blocks field, nothing", async () => {
    const first = renderBar("contact", { scope: "single" });
    expect(await openInBuilder()).toBeNull();
    first.unmount();
    access.mayUpdate = false;
    renderBar("home", { scope: "single" });
    expect(await openInBuilder()).toBeNull();
    // The control: the bar itself drew.
    expect(
      screen.getAllByRole("button", { name: "History" }).length
    ).toBeGreaterThan(0);
  });
});
