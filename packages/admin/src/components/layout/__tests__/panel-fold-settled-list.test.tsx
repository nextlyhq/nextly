// @vitest-environment jsdom
/**
 * Which answer folds a collection's screens: the signed-in metadata once it
 * has settled, even when it lists no plugins at all (a site whose last plugin
 * went sends no list), and the prebuilt page only while that answer is still
 * on its way or could not be had. The prebuilt page here still names the
 * forms collection, as a page built before the plugin went would.
 */
import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ADMIN_STARTUP_SCREENS_ELEMENT_ID } from "nextly/config";

import {
  ChromeSuppressionProvider,
  useSuppressedChrome,
} from "../ChromeSuppression";
import { PanelFoldProvider, useCollectionFoldedPanel } from "../PanelFold";

/** The metadata's state: settled, still on its way, or unavailable. */
const status = vi.hoisted(() => ({ isPending: false, isUnavailable: false }));

vi.mock("@admin/context/providers/BrandingProvider", () => ({
  // A settled response with no plugins carries no `plugins` key at all.
  useBranding: () => ({}),
  useBrandingStatus: () => status,
}));

beforeAll(() => {
  const page = document.createElement("script");
  page.id = ADMIN_STARTUP_SCREENS_ELEMENT_ID;
  page.type = "application/json";
  page.textContent = JSON.stringify({ reads: [], foldedPanels: ["forms"] });
  document.body.append(page);
});
afterEach(cleanup);

function Released(): React.JSX.Element {
  const released = useSuppressedChrome().has("subSidebar");
  return <span data-testid="released">{String(released)}</span>;
}

function FormsScreen(): React.JSX.Element {
  useCollectionFoldedPanel("forms");
  return <p>screen</p>;
}

function folded(): string | null {
  render(
    <ChromeSuppressionProvider>
      <PanelFoldProvider>
        <Released />
        <FormsScreen />
      </PanelFoldProvider>
    </ChromeSuppressionProvider>
  );
  return screen.getByTestId("released").textContent;
}

describe("the answer a collection's fold is read from", () => {
  it("folds by the prebuilt page while the metadata is on its way", () => {
    Object.assign(status, { isPending: true, isUnavailable: false });
    expect(folded()).toBe("true");
  });

  it("folds by the prebuilt page when the metadata could not be had", () => {
    Object.assign(status, { isPending: false, isUnavailable: true });
    expect(folded()).toBe("true");
  });

  it("takes a settled answer with no plugins as no fold, over the page", () => {
    Object.assign(status, { isPending: false, isUnavailable: false });
    expect(folded()).toBe("false");
  });
});
