/**
 * The admin drives light/dark by toggling a class on every `.nextly-admin`
 * container on the page. That is one mode for the whole document, which is
 * correct for the admin itself and wrong for anything rendering a second admin
 * scope in the opposite mode: a side-by-side preview, an embedded sample, a
 * theme gallery. Those containers set their own class and mark themselves
 * `data-theme-sync="off"`.
 *
 * The failure this pins is quiet. The opted-out container keeps its own inline
 * tokens, so it still looks like a themed panel; only the `dark:` component
 * variants follow the page. A gallery claiming to show both modes shows one,
 * and nothing throws.
 */
import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ThemeProvider } from "./ThemeProvider";

function admin(...attributes: Array<[string, string]>): HTMLElement {
  const el = document.createElement("div");
  el.className = "nextly-admin";
  for (const [name, value] of attributes) el.setAttribute(name, value);
  document.body.appendChild(el);
  return el;
}

/**
 * Render the provider with the page pinned to one mode.
 *
 * `defaultTheme`, not `forcedTheme`: next-themes leaves `resolvedTheme` at the
 * default under a forced theme, and ThemeSync reads `resolvedTheme`, so a
 * forced mount syncs nothing and every assertion below would pass vacuously.
 * `enableSystem` is off so the result does not depend on the matchMedia stub.
 */
function mount(theme: "light" | "dark") {
  return render(
    <ThemeProvider
      defaultTheme={theme}
      enableSystem={false}
      storageKey={`nextly-theme-test-${theme}`}
    >
      <span />
    </ThemeProvider>
  );
}

afterEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("ThemeSync", () => {
  it("themes an ordinary admin container", () => {
    // The positive control. Without this, every assertion below would also
    // pass if the sync did nothing at all.
    const container = admin();
    mount("dark");
    expect(container.classList.contains("dark")).toBe(true);
  });

  it("leaves a container that manages its own mode alone", () => {
    const optedOut = admin(["data-theme-sync", "off"]);
    // The class the container set for itself, opposite to the page.
    optedOut.classList.add("dark");
    mount("light");
    expect(optedOut.classList.contains("dark")).toBe(true);
  });

  it("does not force its mode onto an opted-out container either way", () => {
    // The mirror case: a deliberately LIGHT panel while the page is dark. One
    // direction passing says nothing about the other, because `toggle(x, on)`
    // fails asymmetrically.
    const optedOut = admin(["data-theme-sync", "off"]);
    mount("dark");
    expect(optedOut.classList.contains("dark")).toBe(false);
  });

  it("keeps the opt-out for a container that mounts later", async () => {
    // The observer re-applies the page mode to containers added after the
    // first pass, so a preview mounted a frame later would be rethemed then
    // instead. Same defect, later.
    mount("dark");
    const late = admin(["data-theme-sync", "off"]);
    // The opted-out panel is deliberately LIGHT while the page is dark.
    const synced = admin();

    // Wait on the synced container GAINING the class. Waiting on the opted-out
    // one keeping what it already has would be satisfied before the observer
    // ever ran, and the assertion below would then describe a debounce that
    // had not fired rather than an opt-out that held.
    await waitFor(() => expect(synced.classList.contains("dark")).toBe(true));
    expect(late.classList.contains("dark")).toBe(false);
  });
});
