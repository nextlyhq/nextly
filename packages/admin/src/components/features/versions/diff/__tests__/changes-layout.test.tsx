/**
 * Inline is the default, and side by side is a choice each person keeps: it
 * survives leaving the comparison, and one person's choice is not another's on
 * the same browser.
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

import {
  ChangesLayoutToggle,
  useChangesLayoutPreference,
} from "../changes-layout";

function Chooser() {
  const [layout, setLayout] = useChangesLayoutPreference();
  return <ChangesLayoutToggle layout={layout} onChange={setLayout} />;
}

const toggle = () => screen.getByRole("button", { name: "Side by side" });

describe("the changes layout preference", () => {
  beforeEach(() => {
    window.localStorage.clear();
    userMock.mockReturnValue({ user: { id: "u1" } });
  });

  it("starts inline, and remembers side by side for the person who chose it", async () => {
    const { unmount } = render(<Chooser />);
    expect(toggle()).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(toggle());
    expect(toggle()).toHaveAttribute("aria-pressed", "true");
    unmount();

    // Back again: the choice was kept.
    render(<Chooser />);
    expect(await screen.findByRole("button", { pressed: true })).toBe(toggle());
  });

  it("keeps one person's choice from another's on the same browser", async () => {
    const { unmount } = render(<Chooser />);
    await userEvent.click(toggle());
    unmount();

    userMock.mockReturnValue({ user: { id: "u2" } });
    render(<Chooser />);
    expect(toggle()).toHaveAttribute("aria-pressed", "false");
  });
});
