/**
 * A collapsed panel must not keep its links reachable by keyboard.
 *
 * The panel is hidden with zero width, zero opacity and `pointer-events-none`.
 * None of those removes a subtree from the TAB ORDER, so while an immersive
 * editor suppressed the panel a keyboard user could tab through an invisible
 * menu and be navigated out of the editor by a link they never saw.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ChromeSuppressionProvider,
  useSuppressAdminChrome,
} from "../../ChromeSuppression";

import { SubSidebarPanel } from "../SubSidebarPanel";

vi.mock("../SubSidebarContent", () => ({
  SubSidebarContent: () => <a href="/admin/settings/api-keys">API Keys</a>,
}));

afterEach(cleanup);

/** Suppresses the panel for as long as it is mounted, as the editor does. */
function Suppressor() {
  useSuppressAdminChrome({ layers: ["subSidebar"], canExit: true });
  return null;
}

function renderPanel({
  suppress,
  isMobile = false,
  selectedMain = "settings",
}: {
  suppress: boolean;
  isMobile?: boolean;
  selectedMain?: string;
}) {
  return render(
    <ChromeSuppressionProvider>
      {suppress ? <Suppressor /> : null}
      <SubSidebarPanel
        isMobile={isMobile}
        selectedMain={selectedMain}
        visibleMenuItemIds={["dashboard", "settings"]}
        isFolderTreeVisible={false}
        standaloneLabel=""
        content={{} as never}
      />
    </ChromeSuppressionProvider>
  );
}

describe("SubSidebarPanel", () => {
  it("holds no focusable link while a surface has suppressed it", () => {
    renderPanel({ suppress: true });

    expect(screen.queryByRole("link", { name: "API Keys" })).toBeNull();
  });

  it("renders the links when nothing suppressed it", () => {
    // The control. Without it, a panel that never rendered its content would
    // pass the test above just as well.
    renderPanel({ suppress: false });

    expect(screen.getByRole("link", { name: "API Keys" })).toBeDefined();
  });
});

/** The panel's width utilities, which decide where the main column beside it starts. */
function widthClasses(): string[] {
  const panel = screen.getByTestId("sub-sidebar");
  return Array.from(panel.classList).filter(name => /^w-/.test(name));
}

describe("SubSidebarPanel's track on the wide layout", () => {
  it("keeps the open panel's width on a surface that owns no panel", () => {
    // The separating property: the main column starts where this box ends, so
    // a track as wide as the open panel on the dashboard and on a collection
    // is what keeps the column still between them.
    renderPanel({ suppress: false, selectedMain: "settings" });
    const open = widthClasses();
    cleanup();
    renderPanel({ suppress: false, selectedMain: "dashboard" });

    expect(open).toEqual(["w-64"]);
    expect(widthClasses()).toEqual(open);
  });

  it("holds nothing in the track while the selection owns no panel", () => {
    renderPanel({ suppress: false, selectedMain: "dashboard" });
    const panel = screen.getByTestId("sub-sidebar");

    // No links, and not the selection's name as a title over an empty panel.
    expect(screen.queryByRole("link")).toBeNull();
    expect(panel).not.toHaveTextContent(/dashboard/i);
    // An empty landmark is noise to assistive technology, so the held track
    // is out of the accessibility tree until it holds a panel.
    expect(panel).toHaveAttribute("aria-hidden", "true");
  });

  it("exposes the panel once the selection owns one", () => {
    // The control for the case above: the same element, holding a panel, is
    // in the accessibility tree with its links.
    renderPanel({ suppress: false, selectedMain: "settings" });

    expect(screen.getByTestId("sub-sidebar")).not.toHaveAttribute(
      "aria-hidden"
    );
    expect(screen.getByRole("link", { name: "API Keys" })).toBeDefined();
  });

  it("gives the width back while a surface has suppressed the panel", () => {
    // An immersive editor asks for the panel to go to have its width.
    renderPanel({ suppress: true, selectedMain: "settings" });

    expect(widthClasses()).toEqual(["w-0"]);
  });
});

describe("SubSidebarPanel on the narrow layout", () => {
  it("has width only while open, as the overlay it is there", () => {
    renderPanel({ suppress: false, isMobile: true, selectedMain: "dashboard" });
    expect(widthClasses()).toEqual(["w-0"]);
    cleanup();

    renderPanel({ suppress: false, isMobile: true, selectedMain: "settings" });
    expect(widthClasses()).toEqual(["w-64"]);
  });
});
