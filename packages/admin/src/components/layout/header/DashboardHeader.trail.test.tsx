/**
 * The top bar's left slot shows where the open document sits: Content, then
 * its list, then the document itself, each step but the last a link. On a bar
 * narrower than 600px it shows only the way back to the list.
 *
 * The trail is registered by the editor that is open and drawn by the top bar,
 * so each case renders both, as the dashboard does. jsdom evaluates no CSS, so
 * what a narrow bar hides is read from the container-query classes that hide
 * it.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";

import {
  DocumentTrail,
  type DocumentTrailProps,
} from "@admin/components/features/entries/EntryForm/DocumentTrail";

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  useBranding: () => ({ plugins: [] }),
}));
vi.mock("@admin/hooks/useDashboardUser", () => ({
  useDashboardUser: () => ({ user: null }),
}));
vi.mock("@admin/hooks/useLogout", () => ({
  useLogout: () => () => {},
}));
vi.mock("@admin/components/features/notifications", () => ({
  NotificationBell: () => null,
}));
vi.mock("../sidebar/UserProfileDropdown", () => ({
  UserProfileDropdown: () => null,
}));

import { DashboardHeader } from "./DashboardHeader";
import { HeaderTrailProvider } from "./HeaderTrail";

/** The trail's own facts, per kind of document: what an editor passes. */
type TrailFor = DocumentTrailProps extends infer Props
  ? Props extends unknown
    ? Omit<Props, "control" | "titleName">
    : never
  : never;

/** An editor's form holding `title`, registering the trail for it. */
function Editor({ trail, title }: { trail: TrailFor; title: string }) {
  const form = useForm<Record<string, unknown>>({ defaultValues: { title } });
  return (
    <>
      <input aria-label="Title" {...form.register("title")} />
      <DocumentTrail {...trail} control={form.control} titleName="title" />
    </>
  );
}

function renderHeader(editor: ReactElement | null) {
  return render(
    <HeaderTrailProvider>
      <DashboardHeader />
      {editor}
    </HeaderTrailProvider>
  );
}

const ENTRY: TrailFor = {
  kind: "entry",
  collectionSlug: "posts",
  pluralLabel: "Blog posts",
  singularLabel: "Blog post",
  mode: "edit",
};

const trail = () => screen.getByRole("navigation", { name: "Breadcrumb" });

describe("the top bar's trail", () => {
  it("names an entry's place: Content, its collection, then the entry", () => {
    renderHeader(<Editor trail={ENTRY} title="Spring is here" />);

    const links = within(trail()).getAllByRole("link");
    expect(links.map(link => link.textContent)).toEqual([
      "Content",
      "Blog posts",
    ]);
    expect(links[0]).toHaveAttribute("href", "/admin/collections");
    expect(links[1]).toHaveAttribute("href", "/admin/collections/posts");
    // The last step is the page itself, named and not a link.
    const here = within(trail()).getByText("Spring is here");
    expect(here).toHaveAttribute("aria-current", "page");
    expect(here.closest("a")).toBeNull();
  });

  it("names a Single's place: Content, Singles, then the Single", () => {
    renderHeader(
      <Editor trail={{ kind: "single", label: "Homepage" }} title="Homepage" />
    );

    const links = within(trail()).getAllByRole("link");
    expect(links.map(link => link.textContent)).toEqual(["Content", "Singles"]);
    expect(links[1]).toHaveAttribute("href", "/admin/singles");
    expect(within(trail()).getByText("Homepage")).toHaveAttribute(
      "aria-current",
      "page"
    );
  });

  it("calls a document being created New <singular>", () => {
    renderHeader(<Editor trail={{ ...ENTRY, mode: "create" }} title="" />);
    expect(within(trail()).getByText("New Blog post")).toHaveAttribute(
      "aria-current",
      "page"
    );
  });

  it("calls a document with no title Untitled", () => {
    renderHeader(<Editor trail={ENTRY} title="" />);
    expect(within(trail()).getByText("Untitled")).toHaveAttribute(
      "aria-current",
      "page"
    );
  });

  it("follows the title as it is typed", () => {
    renderHeader(<Editor trail={ENTRY} title="Draft one" />);
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Draft two" },
    });
    expect(within(trail()).getByText("Draft two")).toBeInTheDocument();
  });

  it("draws one link to the list, which is the way back on a narrow bar", () => {
    renderHeader(<Editor trail={ENTRY} title="Spring is here" />);

    // One link to the list at every width: the step itself, not a second
    // back link beside it.
    const toList = within(trail())
      .getAllByRole("link")
      .filter(link => link.getAttribute("href") === "/admin/collections/posts");
    expect(toList).toHaveLength(1);

    // Under 600px the bar keeps only that link, with a chevron before it.
    const narrowHidden = "@max-[37.5rem]/topbar:hidden";
    const content = within(trail()).getByRole("link", { name: "Content" });
    expect(content.closest("li")?.className).toContain(narrowHidden);
    expect(
      within(trail()).getByText("Spring is here").closest("li")?.className
    ).toContain(narrowHidden);
    expect(toList[0]?.closest("li")?.className).not.toContain(narrowHidden);
    expect(
      toList[0]?.querySelector("svg")?.getAttribute("class") ?? ""
    ).toContain("@max-[37.5rem]/topbar:inline");
    // Measured against the bar itself, so a sidebar narrowing it counts.
    expect(screen.getByRole("banner").className).toContain("@container/topbar");
  });

  it("lets a long list name shrink and truncate rather than push into the controls, keeping it whole in the tooltip", () => {
    // On a phone the list step is the trail's only item, and beside a plugin's
    // controls on any bar a long label would otherwise overflow them.
    const long = "Quarterly investor relations announcements";
    renderHeader(
      <Editor trail={{ ...ENTRY, pluralLabel: long }} title="Spring is here" />
    );
    const toList = within(trail()).getByRole("link", { name: long });
    expect(toList).toHaveAttribute("title", long);
    expect(toList.className).toMatch(/(^|\s)min-w-0(\s|$)/);
    const step = toList.closest("li")!;
    expect(step.className).toMatch(/(^|\s)min-w-0(\s|$)/);
    expect(step.className).not.toMatch(/(^|\s)shrink-0(\s|$)/);
    expect(within(toList).getByText(long).className).toMatch(
      /(^|\s)truncate(\s|$)/
    );
  });

  it("draws nothing where no document is open", () => {
    renderHeader(null);
    expect(
      screen.queryByRole("navigation", { name: "Breadcrumb" })
    ).not.toBeInTheDocument();
  });

  it("is withdrawn when the document closes", () => {
    const { rerender } = renderHeader(
      <Editor trail={ENTRY} title="Spring is here" />
    );
    expect(trail()).toBeInTheDocument();
    rerender(
      <HeaderTrailProvider>
        <DashboardHeader />
      </HeaderTrailProvider>
    );
    expect(
      screen.queryByRole("navigation", { name: "Breadcrumb" })
    ).not.toBeInTheDocument();
  });
});
