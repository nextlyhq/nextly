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

function renderPanel({ suppress }: { suppress: boolean }) {
  return render(
    <ChromeSuppressionProvider>
      {suppress ? <Suppressor /> : null}
      <SubSidebarPanel
        isMobile={false}
        selectedMain="settings"
        visibleMenuItemIds={["settings"]}
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
