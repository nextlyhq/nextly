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

import {
  ThemePaintScript,
  ThemeProvider,
  useTheme,
  type UseThemeProps,
} from "./ThemeProvider";

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
  vi.restoreAllMocks();
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
    // The pre-paint script runs first, as in a browser, then React takes over.
    expect(paintedByScript()).toBe("dark");
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

  it("still applies a choice in this tab when storage refuses to keep it", () => {
    systemSetting(false);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    const container = adminContainer();
    let theme: UseThemeProps | undefined;
    function Capture() {
      theme = useTheme();
      return null;
    }
    render(
      <ThemeProvider storageKey="nextly-theme-refused">
        <Capture />
      </ThemeProvider>
    );

    act(() => theme?.setTheme("dark"));

    expect(theme?.theme).toBe("dark");
    expect(container.classList.contains("dark")).toBe(true);
  });

  it("composes two functional updates made before a render", () => {
    systemSetting(false);
    localStorage.setItem(KEY, "light");
    let theme: UseThemeProps | undefined;
    function Capture() {
      theme = useTheme();
      return null;
    }
    render(
      <ThemeProvider>
        <Capture />
      </ThemeProvider>
    );
    const toggle = (current: string) => (current === "dark" ? "light" : "dark");

    act(() => {
      theme?.setTheme(toggle);
      theme?.setTheme(toggle);
    });

    expect(theme?.theme).toBe("light");
  });

  it("keeps the user's choice apart from a forced theme", () => {
    systemSetting(false);
    localStorage.setItem(KEY, "light");
    let theme: UseThemeProps | undefined;
    function Capture() {
      theme = useTheme();
      return null;
    }
    render(
      <ThemeProvider forcedTheme="dark">
        <Capture />
      </ThemeProvider>
    );

    expect(theme?.theme).toBe("light");
    expect(theme?.forcedTheme).toBe("dark");
    expect(theme?.resolvedTheme).toBe("dark");
    const html = renderToString(
      <ThemeProvider forcedTheme="dark">
        <ThemePaintScript />
      </ThemeProvider>
    );
    const container = adminContainer();
    new Function(/<script[^>]*>([\s\S]*)<\/script>/.exec(html)?.[1] ?? "")();
    expect(container.classList.contains("dark")).toBe(true);
  });

  it("reports no system theme when system mode is off", () => {
    systemSetting(true);
    let theme: UseThemeProps | undefined;
    function Capture() {
      theme = useTheme();
      return null;
    }
    render(
      <ThemeProvider enableSystem={false} defaultTheme="light">
        <Capture />
      </ThemeProvider>
    );

    expect(theme?.systemTheme).toBeUndefined();
    expect(theme?.themes).toEqual(["light", "dark"]);
  });

  it("defaults to light, not the system's setting, when system mode is off", () => {
    systemSetting(true);
    let theme: UseThemeProps | undefined;
    function Capture() {
      theme = useTheme();
      return null;
    }
    render(
      <ThemeProvider enableSystem={false}>
        <Capture />
      </ThemeProvider>
    );

    expect(theme?.theme).toBe("light");
    expect(theme?.resolvedTheme).toBe("light");
  });

  it("is exported from the package, for hosts that compose the provider themselves", async () => {
    const admin = await import("../../index");

    expect(admin.ThemePaintScript).toBe(ThemePaintScript);
    expect(admin.ThemeProvider).toBe(ThemeProvider);
    // The package entry loads the whole admin, which takes several seconds.
  }, 30_000);

  it("lets an enclosing provider's settings hold inside a nested one", () => {
    systemSetting(false);
    localStorage.setItem("host-theme", "dark");
    render(
      <ThemeProvider storageKey="host-theme">
        <ThemeProvider>
          <ShowResolved />
        </ThemeProvider>
      </ThemeProvider>
    );

    expect(screen.getByRole("status").textContent).toBe("dark");
  });

  it("keeps a storage key that spells </script> inside the script", () => {
    systemSetting(false);
    const key = '</script><img src=x onerror="window.injected=1">';
    localStorage.setItem(key, "dark");

    const html = renderToString(
      <ThemeProvider storageKey={key}>
        <ThemePaintScript />
      </ThemeProvider>
    );

    expect(html.match(/<\/script>/g)).toHaveLength(1);
    expect(html).not.toContain("<img");
    const container = adminContainer();
    new Function(/<script[^>]*>([\s\S]*)<\/script>/.exec(html)?.[1] ?? "")();
    expect(container.classList.contains("dark")).toBe(true);
  });

  it("follows the system setting through a media query's older listener API", () => {
    let dark = false;
    let changed: (() => void) | undefined;
    vi.stubGlobal("matchMedia", (query: string) => ({
      get matches() {
        return dark && query === "(prefers-color-scheme: dark)";
      },
      media: query,
      addListener: (listener: () => void) => {
        changed = listener;
      },
      removeListener: () => {},
    }));
    render(
      <ThemeProvider>
        <ShowResolved />
      </ThemeProvider>
    );
    expect(screen.getByRole("status").textContent).toBe("light");

    act(() => {
      dark = true;
      changed?.();
    });

    expect(screen.getByRole("status").textContent).toBe("dark");
  });

  it("gives the pre-paint script the nonce the provider was handed", () => {
    const html = renderToString(
      <ThemeProvider nonce="r4nd0m">
        <ThemePaintScript />
      </ThemeProvider>
    );

    expect(html).toMatch(/<script[^>]*nonce="r4nd0m"/);
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
