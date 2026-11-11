// @vitest-environment jsdom

/**
 * The Pages and addresses screen as a person uses it: the list and its
 * filters, and a page built in code given a title in the panel beside it,
 * its preview following what is typed. What a save sends is read from the
 * save itself.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@nextlyhq/plugin-sdk/admin", async importOriginal => ({
  ...(await importOriginal<typeof import("@nextlyhq/plugin-sdk/admin")>()),
  usePluginRoute: vi.fn(),
  usePluginRouteMutation: vi.fn(),
  useMediaItem: vi.fn(() => ({ data: undefined })),
  MediaPickerDialog: () => null,
  toastMutationResult: vi.fn(),
  navigateTo: vi.fn(),
}));

import {
  navigateTo,
  toastMutationResult,
  usePluginRoute,
  usePluginRouteMutation,
} from "@nextlyhq/plugin-sdk/admin";

import type { SiteAddress } from "../../code-pages/contract";
import { SeoPagesPage } from "../SeoPagesPage";

const ITEMS: SiteAddress[] = [
  {
    path: "/",
    name: "Home",
    source: "entry",
    from: "Pages",
    standing: "listed",
    title: "Acme | Acme",
    canonical: "https://acme.example/",
    entry: { kind: "collection", slug: "pages", id: "7" },
  },
  {
    path: "/pricing",
    name: "Pricing",
    source: "built",
    from: "app/pricing/page.tsx",
    standing: "not-connected",
    canonical: "https://acme.example/pricing",
    seo: {
      typed: { hidden: false },
      automatic: {
        title: {
          value: "Pricing | Acme",
          from: "pattern",
          pattern: "{Title} | {Site name}",
        },
      },
      siteName: "Acme",
    },
  },
  {
    path: "/contact",
    name: "Contact",
    source: "built",
    from: "app/contact/page.tsx",
    standing: "listed",
    canonical: "https://acme.example/contact",
    seo: { typed: { hidden: false }, automatic: {}, siteName: "Acme" },
  },
];

/** Every body a save sent, in order. */
let sent: unknown[];

beforeEach(() => {
  sent = [];
  vi.mocked(usePluginRoute).mockImplementation(
    () =>
      ({
        data: { items: ITEMS },
        pending: false,
        error: null,
        refetch: () => {},
        fetching: false,
      }) as unknown as ReturnType<typeof usePluginRoute>
  );
  vi.mocked(usePluginRouteMutation).mockImplementation(
    () =>
      ({
        write: vi.fn(async (body: unknown) => {
          sent.push(body);
          return { path: "/pricing" };
        }),
        pending: false,
        error: null,
      }) as unknown as ReturnType<typeof usePluginRouteMutation>
  );
});

const rows = () => screen.getAllByRole("row").slice(1);

describe("the list", () => {
  it("counts the addresses, and narrows them by filter and by search", () => {
    render(<SeoPagesPage />);

    expect(screen.getByText("not connected").textContent).toBe(
      "1 not connected"
    );
    expect(rows()).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: "Not connected" }));
    expect(rows()).toHaveLength(1);
    expect(within(rows()[0]).getByText("/pricing")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "All" }));
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "nothing here" },
    });
    expect(screen.getByText("No addresses match.")).toBeTruthy();
  });

  it("opens an entry's own screen for its SEO", () => {
    render(<SeoPagesPage />);

    fireEvent.click(screen.getByRole("button", { name: "Open entry" }));

    expect(navigateTo).toHaveBeenCalledWith("/admin/collections/pages/7");
  });
});

describe("the panel of a page built in code", () => {
  it("says the route is not connected, previews what is typed and saves it", async () => {
    render(<SeoPagesPage />);
    fireEvent.click(screen.getAllByRole("button", { name: "Edit SEO" })[0]);

    const panel = screen.getByRole("dialog", { name: "SEO for /pricing" });
    expect(
      within(panel).getByText(/doesn't call the SEO function yet/)
    ).toBeTruthy();
    // Nothing typed: the automatic title, shown in the preview.
    expect(within(panel).getByText("Pricing | Acme")).toBeTruthy();

    fireEvent.change(within(panel).getByLabelText("Title on Google"), {
      target: { value: "Plans and prices" },
    });
    expect(within(panel).getByText("Plans and prices")).toBeTruthy();
    expect(within(panel).getByText("Typed for this address")).toBeTruthy();

    fireEvent.click(within(panel).getByRole("button", { name: "Save" }));
    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    expect(sent).toEqual([
      {
        path: "/pricing",
        title: "Plans and prices",
        description: "",
        hidden: false,
        image: null,
      },
    ]);
    expect(toastMutationResult).toHaveBeenCalledWith(
      "Saved for /pricing. It reaches the page once the route calls the SEO function.",
      undefined
    );
  });

  it("hides the page from search under Advanced, the preview saying so", () => {
    render(<SeoPagesPage />);
    fireEvent.click(screen.getAllByRole("button", { name: "Edit SEO" })[1]);
    const panel = screen.getByRole("dialog", { name: "SEO for /contact" });
    expect(within(panel).getByText(/calls the SEO function, so/)).toBeTruthy();

    fireEvent.click(within(panel).getByRole("button", { name: /Advanced/ }));
    fireEvent.click(
      within(panel).getByRole("switch", { name: "Hide this page from search" })
    );

    expect(within(panel).getByText("Hidden from search")).toBeTruthy();
    fireEvent.keyDown(panel, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
