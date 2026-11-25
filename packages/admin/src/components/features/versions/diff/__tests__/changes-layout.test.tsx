/**
 * Inline is the default, and side by side is a choice each person keeps: it
 * survives leaving the comparison, and one person's choice is not another's on
 * the same browser. Both are in view as one choice, Inline or Side by side, so
 * the one not chosen is a press away and the chosen one is said as chosen.
 */
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

const { userMock } = vi.hoisted(() => ({
  userMock: vi.fn(() => ({ user: { id: "u1" } as { id: string } | null })),
}));

vi.mock("@admin/hooks/useDashboardUser", () => ({
  useDashboardUser: () => userMock(),
}));

import type { FieldDiff } from "@admin/services/versionApi";

import {
  ChangesLayoutToggle,
  honoursSideBySide,
  useChangesLayoutPreference,
} from "../changes-layout";

function Chooser() {
  const [layout, setLayout] = useChangesLayoutPreference();
  return <ChangesLayoutToggle layout={layout} onChange={setLayout} />;
}

const choice = () =>
  screen.getByRole("radiogroup", { name: "How changes are shown" });
const inline = () => screen.getByRole("radio", { name: "Inline" });
const toggle = () => screen.getByRole("radio", { name: "Side by side" });

describe("the changes layout preference", () => {
  beforeEach(() => {
    window.localStorage.clear();
    userMock.mockReturnValue({ user: { id: "u1" } });
  });

  it("starts inline, and remembers side by side for the person who chose it", async () => {
    const { unmount } = render(<Chooser />);
    expect(choice()).toContainElement(inline());
    expect(inline()).toBeChecked();
    expect(toggle()).not.toBeChecked();

    await userEvent.click(toggle());
    expect(toggle()).toBeChecked();
    expect(inline()).not.toBeChecked();
    unmount();

    // Back again: the choice was kept.
    render(<Chooser />);
    expect(await screen.findByRole("radio", { checked: true })).toBe(toggle());

    // And Inline is one press away.
    await userEvent.click(inline());
    expect(inline()).toBeChecked();
  });

  it("keeps one person's choice from another's on the same browser", async () => {
    const { unmount } = render(<Chooser />);
    await userEvent.click(toggle());
    unmount();

    userMock.mockReturnValue({ user: { id: "u2" } });
    render(<Chooser />);
    expect(toggle()).not.toBeChecked();
    expect(inline()).toBeChecked();
  });
});

describe("whether a comparison has a side-by-side view", () => {
  const text = (status: FieldDiff["status"]): FieldDiff => ({
    kind: "text",
    name: "title",
    label: "Title",
    type: "text",
    status,
    segments: [{ op: 0, text: "x" }],
  });
  const tags: FieldDiff = {
    kind: "set",
    name: "tags",
    label: "Tags",
    type: "relationship",
    status: "changed",
    added: [{ id: "c" }],
    removed: [{ id: "a" }],
  };
  const body: FieldDiff = {
    kind: "richText",
    name: "body",
    label: "Body",
    type: "richText",
    status: "changed",
    blocks: [],
  };

  it("has one for a changed text or value, also inside a group or a list", () => {
    expect(honoursSideBySide(text("changed"))).toBe(true);
    expect(
      honoursSideBySide({
        kind: "group",
        name: "seo",
        label: "SEO",
        type: "group",
        status: "changed",
        fields: [tags, text("changed")],
      })
    ).toBe(true);
    expect(
      honoursSideBySide({
        kind: "list",
        name: "rows",
        label: "Rows",
        type: "repeater",
        status: "changed",
        items: [{ id: "r1", status: "changed", fields: [text("changed")] }],
      })
    ).toBe(true);
  });

  it("has none for rich text, a relationship, or an unchanged field", () => {
    expect(honoursSideBySide(body)).toBe(false);
    expect(honoursSideBySide(tags)).toBe(false);
    expect(honoursSideBySide(text("unchanged"))).toBe(false);
  });

  it("offers no side by side that would do nothing, and says why", () => {
    render(
      <ChangesLayoutToggle
        layout="split"
        onChange={vi.fn()}
        splittable={false}
      />
    );
    expect(toggle()).toBeDisabled();
    expect(toggle()).not.toBeChecked();
    // Inline is what is drawn, so it reads as chosen.
    expect(inline()).toBeChecked();
    expect(choice()).toHaveAccessibleDescription(
      "This comparison has no side-by-side view"
    );
  });
});
