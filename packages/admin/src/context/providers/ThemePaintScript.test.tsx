/**
 * The admin's theme lives on its own containers, never on `<html>`.
 *
 * `<html>` belongs to the host app's root layout. A theme written there before
 * React hydrates is a hydration mismatch in every app whose layout does not opt
 * out, which is every app `create-next-app` makes. These tests hold the
 * provider and its pre-paint script to the admin's containers, and hold the
 * script to the same reading of a saved value as the provider's React state.
 */
import { act, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ThemePaintScript, ThemeProvider, useTheme } from "./ThemeProvider";

const KEY = "nextly-theme";

function adminContainer(): HTMLElement {
  const element = document.createElement("div");
  element.className = "nextly-admin";
  document.body.appendChild(element);
  return element;
}

/** A browser whose system setting is dark or light, answering only the dark-scheme query. */
function systemSetting(dark: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: dark && query === "(prefers-color-scheme: dark)",
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

function ShowResolved() {
  const { resolvedTheme } = useTheme();
  return <output>{resolvedTheme ?? "unknown"}</output>;
}

/** The theme the provider's React state resolves a saved value to. */
function resolvedByProvider(): string {
  const { unmount } = render(
    <ThemeProvider>
      <ShowResolved />
    </ThemeProvider>
  );
  const text = screen.getByRole("status").textContent ?? "";
  unmount();
  return text;
}

/** The theme the server-rendered pre-paint script paints onto an admin container. */
function paintedByScript(): string {
  const html = renderToString(
    <ThemeProvider>
      <ThemePaintScript />
    </ThemeProvider>
  );
  const source = /<script[^>]*>([\s\S]*)<\/script>/.exec(html)?.[1];
  expect(source, "the server renders the script").toBeTruthy();
  const container = adminContainer();
  new Function(source ?? "")();
  const painted = container.classList.contains("dark") ? "dark" : "light";
  container.remove();
  return painted;
}

afterEach(() => {
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("class");
  document.documentElement.removeAttribute("style");
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("the admin's theme", () => {
  it.each([
    ["dark", false, "dark"],
    ["light", true, "light"],
    ["system", true, "dark"],
    ["system", false, "light"],
    // Nothing saved, or a value it does not offer: the default, "system".
    [null, true, "dark"],
    [null, false, "light"],
    ["Dark", true, "dark"],
    ["Light", true, "dark"],
  ] as const)(
    "reads a saved %j with a dark system setting %s as %s, in the script and in React alike",
    (saved, systemDark, expected) => {
      systemSetting(systemDark);
      if (saved !== null) localStorage.setItem(KEY, saved);

      expect(paintedByScript()).toBe(expected);
      expect(resolvedByProvider()).toBe(expected);
    }
  );

  it("themes the admin's containers and leaves <html> exactly as the host rendered it", () => {
    systemSetting(false);
    localStorage.setItem(KEY, "dark");
    const container = adminContainer();

    render(
      <ThemeProvider>
        <span />
      </ThemeProvider>
    );

    expect(container.classList.contains("dark")).toBe(true);
    expect(document.documentElement.getAttribute("class")).toBeNull();
    expect(document.documentElement.getAttribute("style")).toBeNull();
  });

  it("saves a choice, and applies it in this tab at once", () => {
    systemSetting(false);
    const container = adminContainer();
    let setTheme: (theme: string) => void = () => {};
    function Capture() {
      setTheme = useTheme().setTheme;
      return null;
    }
    render(
      <ThemeProvider>
        <Capture />
      </ThemeProvider>
    );
    expect(container.classList.contains("dark")).toBe(false);

    act(() => setTheme("dark"));

    expect(localStorage.getItem(KEY)).toBe("dark");
    expect(container.classList.contains("dark")).toBe(true);
  });

  it("follows a choice another tab saves", () => {
    systemSetting(false);
    const container = adminContainer();
    render(
      <ThemeProvider>
        <span />
      </ThemeProvider>
    );

    act(() => {
      localStorage.setItem(KEY, "dark");
      window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
    });

    expect(container.classList.contains("dark")).toBe(true);
  });

  it("emits no script when the admin mounts in the browser rather than from server HTML", () => {
    systemSetting(false);
    const { container } = render(
      <ThemeProvider>
        <ThemePaintScript />
      </ThemeProvider>
    );

    expect(container.querySelector("script")).toBeNull();
  });
});
