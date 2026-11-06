/**
 * The one row layout and the one list card every dashboard list draws with.
 *
 * Pinned here: the row's five slots and their order, that the whole row is one link with its
 * actions outside it, that the list draws only the rows it holds, the one footer and how it
 * counts, and that the stacked and table forms show the same rows, links and order.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WidgetCard } from "../../WidgetCard";
import { ENTITY_LEADING_CLASS, EntityRow } from "../entity-row";
import {
  countSpoken,
  countText,
  ListCard,
  listFooter,
  type ListModel,
} from "../list-card";

afterEach(() => cleanup());

interface Post {
  id: string;
  title: string;
  status: string;
  updated: string;
}

const posts = (count: number): Post[] =>
  Array.from({ length: count }, (_, i) => ({
    id: String(i + 1),
    title: `Post ${i + 1}`,
    status: "Draft",
    updated: `${i + 1} min ago`,
  }));

const model: ListModel<Post> = {
  titleLabel: "Title",
  titleOf: post => post.title,
  hrefOf: post => `/admin/collections/posts/${post.id}`,
  fields: [
    {
      key: "status",
      label: "Status",
      role: "trailing",
      present: p => p.status,
    },
    { key: "updated", label: "Updated", role: "meta", present: p => p.updated },
  ],
};

describe("EntityRow", () => {
  it("draws its five slots in order, and a meta line of at most three fields", () => {
    render(
      <EntityRow
        density="default"
        leading={<span>P</span>}
        title="Pricing"
        meta={["Pages", "Ana", "2 min ago", "never shown"]}
        trailing="Draft"
        href="/admin/collections/pages/1"
        menu={[{ id: "open", label: "Open", onSelect: () => {} }]}
      />
    );
    const row = screen.getByTestId("entity-row");
    const slots = [
      "entity-row-leading",
      "entity-row-title",
      "entity-row-meta",
      "entity-row-trailing",
    ].map(id => within(row).getByTestId(id));
    // Each slot follows the one before it in the document.
    for (let i = 1; i < slots.length; i++) {
      expect(
        slots[i - 1].compareDocumentPosition(slots[i]) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    }
    expect(screen.getByTestId("entity-row-meta")).toHaveTextContent(
      "Pages · Ana · 2 min ago"
    );
    expect(screen.getByTestId("entity-row-meta")).not.toHaveTextContent(
      "never shown"
    );
    // The menu comes last, named for its row.
    expect(
      screen.getByRole("button", { name: "Actions for Pricing" })
    ).toBeInTheDocument();
  });

  it("draws no slot it has nothing for", () => {
    render(<EntityRow density="default" title="Pricing" />);
    expect(screen.queryByTestId("entity-row-leading")).toBeNull();
    expect(screen.queryByTestId("entity-row-meta")).toBeNull();
    expect(screen.queryByTestId("entity-row-trailing")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("is one link to what it names, with its menu and action outside the link", () => {
    render(
      <EntityRow
        density="default"
        title="Spring launch"
        href="/admin/releases/7"
        action={{ label: "Review", href: "/admin/releases/7/review" }}
        menu={[{ id: "open", label: "Open", onSelect: () => {} }]}
      />
    );
    const link = screen.getByRole("link", { name: "Spring launch" });
    expect(link).toHaveAttribute("href", "/admin/releases/7");
    const menu = screen.getByRole("button", {
      name: "Actions for Spring launch",
    });
    const action = screen.getByRole("link", { name: "Review" });
    // 🔴 Nothing interactive inside another: the row's link holds neither control.
    expect(link.contains(menu)).toBe(false);
    expect(link.contains(action)).toBe(false);
  });

  it("is plain text when it leads nowhere, never a link that goes nowhere", () => {
    render(<EntityRow density="default" title="Deleted entry" />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByTestId("entity-row-title")).toHaveTextContent(
      "Deleted entry"
    );
  });

  it("keeps a plain row's full title within reach of hover and focus, as a linked row does", () => {
    // 🔴 A deletion leads nowhere; cut with "…" and given no tooltip, its title could not be
    // read whole by pointer or keyboard.
    render(<EntityRow density="default" title="A very long deleted title" />);
    const trigger = screen
      .getByTestId("entity-row-title")
      .closest('[tabindex="0"]');
    expect(trigger).not.toBeNull();
    // The tooltip's trigger, as the linked row's link is.
    expect(trigger).toHaveAttribute("data-state");
  });

  it("keeps one fixed row height per density", () => {
    const { rerender } = render(<EntityRow density="default" title="A" />);
    expect(screen.getByTestId("entity-row")).toHaveClass("h-13");
    rerender(<EntityRow density="compact" title="A" />);
    expect(screen.getByTestId("entity-row")).toHaveClass("h-9");
  });
});

describe("ListCard", () => {
  it("draws only the rows it holds, never the extra row the query asked for", () => {
    render(
      <ListCard
        model={model}
        rows={posts(6)}
        drawn={5}
        tier="medium"
        density="default"
      />
    );
    expect(screen.getAllByTestId("entity-row")).toHaveLength(5);
    expect(screen.queryByText("Post 6")).toBeNull();
  });

  it("offers View all with no count when it draws everything the list holds", () => {
    // 🔴 Offered only when more exist, a card with one release would have no way to Releases.
    render(
      <ListCard
        model={model}
        rows={posts(5)}
        drawn={5}
        total={{ count: 5 }}
        viewAllHref="/admin/collections/posts"
        tier="medium"
        density="default"
      />
    );
    const footer = screen.getByTestId("list-card-footer");
    expect(footer).toHaveAttribute("href", "/admin/collections/posts");
    expect(footer).toHaveTextContent(/^View all/);
    expect(footer.textContent).not.toMatch(/\(\d/);
  });

  it("links to the full list with its whole count when there are more", () => {
    render(
      <ListCard
        model={model}
        rows={posts(6)}
        drawn={5}
        total={{ count: 42 }}
        viewAllHref="/admin/collections/posts?sort=-updatedAt"
        tier="medium"
        density="default"
      />
    );
    const footer = screen.getByTestId("list-card-footer");
    expect(footer).toHaveAttribute(
      "href",
      "/admin/collections/posts?sort=-updatedAt"
    );
    expect(footer).toHaveTextContent("View all (42)");
  });

  it("draws its footer in the card's footer, never under its rows in the body", () => {
    // 🔴 Drawn in the body, the line takes room the rows were counted for, and the card ends
    // on a different line from the card beside it.
    render(
      <WidgetCard title="Posts">
        <ListCard
          model={model}
          rows={posts(6)}
          drawn={5}
          total={{ count: 42 }}
          viewAllHref="/admin/collections/posts?sort=-updatedAt"
          tier="medium"
          density="default"
        />
      </WidgetCard>
    );
    expect(
      within(screen.getByTestId("widget-card-footer")).getByTestId(
        "list-card-footer"
      )
    ).toHaveTextContent("View all (42)");
    expect(
      within(screen.getByTestId("widget-card-body")).queryByTestId(
        "list-card-footer"
      )
    ).toBeNull();
    // The rows stay in the body.
    expect(
      within(screen.getByTestId("widget-card-body")).getAllByTestId(
        "entity-row"
      )
    ).toHaveLength(5);
  });

  it("draws a row's trailing fields as keyed children, so React has nothing to warn of", () => {
    // 🔴 Handed to the row as a bare array, two trailing elements (a status pill, a time) make
    // React warn that each child in a list needs a key, on every row of every list card.
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ListCard
        model={{
          ...model,
          fields: [
            {
              key: "status",
              label: "Status",
              role: "trailing",
              present: post => <span>{post.status}</span>,
            },
            {
              key: "when",
              label: "When",
              role: "trailing",
              present: () => <time>now</time>,
            },
          ],
        }}
        rows={posts(2)}
        drawn={2}
        tier="medium"
        density="default"
      />
    );
    const keyWarnings = warn.mock.calls.filter(call =>
      String(call[0]).includes('unique "key"')
    );
    warn.mockRestore();
    expect(keyWarnings).toEqual([]);
    expect(screen.getAllByTestId("entity-row-trailing")[0]).toHaveTextContent(
      "Draftnow"
    );
  });

  it("has no footer where there is no list to open, however many more exist", () => {
    // 🔴 A footer holds a link: "37 more" with nowhere to go is a count the reader can do
    // nothing with.
    const { rerender } = render(
      <ListCard
        model={model}
        rows={posts(6)}
        drawn={5}
        tier="medium"
        density="default"
      />
    );
    expect(screen.queryByTestId("list-card-footer")).toBeNull();
    rerender(
      <ListCard
        model={model}
        rows={posts(6)}
        drawn={5}
        total={{ count: 42 }}
        tier="medium"
        density="default"
      />
    );
    expect(screen.queryByTestId("list-card-footer")).toBeNull();
  });

  it("sizes a row's leading content in the table form as it is in the stacked one", () => {
    // 🔴 Given no size, an avatar or chip drawn at its container's full size collapses in a cell.
    render(
      <ListCard
        model={{ ...model, leadingOf: () => <span data-testid="lead" /> }}
        rows={posts(1)}
        drawn={1}
        tier="large"
        density="default"
      />
    );
    expect(screen.getByTestId("lead").parentElement).toHaveClass(
      ENTITY_LEADING_CLASS.default
    );
  });

  it("gives the table's title the width the other columns leave, a time set at its end", () => {
    render(
      <ListCard
        model={{
          ...model,
          fields: [
            ...model.fields,
            {
              key: "at",
              label: "At",
              role: "meta",
              align: "end",
              present: () => "now",
            },
          ],
        }}
        rows={posts(2)}
        drawn={2}
        tier="large"
        density="default"
      />
    );
    const [title, status, , at] = screen.getAllByRole("columnheader");
    // 🔴 Laid out evenly, the status and the time float mid-card on a wide one.
    expect(title).toHaveClass("w-full");
    expect(status).toHaveClass("w-px", "whitespace-nowrap");
    expect(status).not.toHaveClass("text-right");
    expect(at).toHaveClass("text-right");
  });

  it("draws the same rows, in the same order, to the same places as a table when large", () => {
    const { rerender } = render(
      <ListCard
        model={model}
        rows={posts(3)}
        drawn={3}
        tier="medium"
        density="default"
      />
    );
    const stacked = screen
      .getAllByRole("link")
      .map(link => link.getAttribute("href"));
    rerender(
      <ListCard
        model={model}
        rows={posts(3)}
        drawn={3}
        tier="large"
        density="default"
      />
    );
    const table = screen.getByTestId("list-card-table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map(heading => heading.textContent)
    ).toEqual(["Title", "Status", "Updated"]);
    const tabled = within(table)
      .getAllByRole("link")
      .map(link => link.getAttribute("href"));
    expect(tabled).toEqual(stacked);
  });

  it("calls a menu item's action from the table form as from the stacked form", () => {
    const onSelect = vi.fn();
    render(
      <ListCard
        model={{
          ...model,
          menuOf: () => [{ id: "open", label: "Open", onSelect }],
        }}
        rows={posts(1)}
        drawn={1}
        tier="large"
        density="default"
      />
    );
    expect(
      screen.getByRole("button", { name: "Actions for Post 1" })
    ).toBeInTheDocument();
  });
});

describe("the footer's count", () => {
  it("is the source's total when it gave one", () => {
    expect(listFooter(6, 5, { count: 42 })).toEqual({
      count: 42,
      atLeast: false,
      drawn: 5,
    });
    expect(listFooter(6, 5, { count: 5 })).toBeUndefined();
  });

  it("is a floor from the extra row when the source gave no total", () => {
    expect(listFooter(6, 5, undefined)).toEqual({
      count: 6,
      atLeast: true,
      drawn: 5,
    });
    expect(listFooter(5, 5, undefined)).toBeUndefined();
  });

  it("caps at 99 and reads a floor as 'or more'", () => {
    expect(countText(42, false)).toBe("42");
    expect(countText(6, true)).toBe("6+");
    expect(countText(250, false)).toBe("99+");
    expect(countSpoken(250, false)).toBe("99 or more");
    expect(countSpoken(6, true)).toBe("6 or more");
  });
});
