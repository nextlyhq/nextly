// @vitest-environment jsdom
/**
 * The parts a plugin's own page draws its admin place with, loaded from the
 * package's BUILT `@nextlyhq/plugin-sdk/admin` entry, the module a plugin's
 * bundle imports.
 *
 * Each is the admin's own export, the very object the admin's suites exercise
 * (`packages/admin/src/components/shared/target-slot/__tests__/
 * TargetSlot.test.tsx`, which draws another plugin's block at a plugin's own
 * place), so an entry that kept the names but pointed elsewhere fails here,
 * and one whose behaviour changed fails there. Rendered outside any admin
 * provider, as a plugin's own tests render it: with nothing sent to the place,
 * the slot draws nothing and the tabs draw the page's content alone.
 *
 * The built entry is there because `turbo.json` makes this package's tests
 * depend on its own build; `vitest.global-setup.ts` stops a run that bypasses
 * that edge before it reaches a missing entry.
 */
import * as admin from "@nextlyhq/admin";
import * as entry from "@nextlyhq/plugin-sdk/admin";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

declare global {
  // React reads this to know `act` drives the renders, so it warns otherwise.
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let host: HTMLDivElement;
let root: Root;
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  consoleError = vi.spyOn(console, "error");
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  consoleError.mockRestore();
});

describe("an admin place's parts, from the plugin SDK", () => {
  it("are the admin's own", () => {
    expect(typeof entry.TargetSlot).toBe("function");
    expect(entry.TargetSlot).toBe(admin.TargetSlot);
    expect(typeof entry.PlaceTabs).toBe("function");
    expect(entry.PlaceTabs).toBe(admin.PlaceTabs);
  });

  it("draw only the page's own content at a place nothing was sent to", () => {
    const { PlaceTabs, TargetSlot } = entry;

    act(() =>
      root.render(
        <PlaceTabs
          place="settings"
          context={{ userId: "u1" }}
          contentLabel="Overview"
        >
          <p>page content</p>
          <TargetSlot place="settings" context={{ userId: "u1" }} />
        </PlaceTabs>
      )
    );

    expect(host.textContent).toBe("page content");
    expect(host.querySelector("[role='tablist']")).toBeNull();
    expect(consoleError).not.toHaveBeenCalled();
  });
});
