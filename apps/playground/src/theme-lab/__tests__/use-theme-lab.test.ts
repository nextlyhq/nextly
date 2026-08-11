// @vitest-environment jsdom
//
// The rest of this package's tests run under vitest's default "node"
// environment (see vitest.config.ts) because a fixture elsewhere asserts a
// module throws when it detects a browser-like `window` global. This suite
// needs the opposite: readSelection/writeSelection use `localStorage`, which
// plain node doesn't provide, so it opts into jsdom for just this file.
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, beforeEach } from "vitest";

import { NEXTLY_THEMES, TWEAKCN_THEMES } from "../themes";
import {
  readSelection,
  writeSelection,
  DEFAULT_SELECTION,
  SHIPPED_THEME,
  useThemeLab,
} from "../use-theme-lab";

declare global {
  // React 19 refuses to run updates inside `act` unless the environment
  // opts in through this global. It is declared by React's runtime rather
  // than by its published types, so the ambient declaration has to live here.
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

/**
 * Minimal stand-in for a testing-library `renderHook`: mounts the hook in a
 * throwaway root and hands back a live view of its latest return value.
 * Written by hand because this package has react/react-dom but no React
 * testing library, and the behaviour under test (how `setTheme` reconciles
 * density) only exists inside the hook's state updater -- calling a pure
 * helper instead would test a different thing than what the switcher
 * actually runs.
 */
function renderThemeLab() {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  let latest: ReturnType<typeof useThemeLab> | undefined;
  function Probe() {
    const api = useThemeLab();
    // Published from an effect rather than during render: writing to a
    // variable outside the component while rendering is a side effect, and
    // `act` flushes effects before it returns, so the value is already
    // current by the time any assertion below reads it.
    useEffect(() => {
      latest = api;
    }, [api]);
    return null;
  }

  act(() => {
    root.render(createElement(Probe));
  });

  return {
    get current(): ReturnType<typeof useThemeLab> {
      if (!latest) throw new Error("hook did not render");
      return latest;
    },
    act(fn: () => void) {
      act(fn);
    },
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe("theme lab selection", () => {
  beforeEach(() => localStorage.clear());

  it("defaults to the shipped theme, not a lab palette", () => {
    // The harness at /admin is where contributors judge the admin. Defaulting
    // to a lab id means every fresh session renders a palette that is not the
    // product's, and the generated `[data-theme]` rules outrank the shipped
    // base, so nothing on screen says so.
    expect(readSelection()).toEqual(DEFAULT_SELECTION);
    expect(DEFAULT_SELECTION.theme).toBe(SHIPPED_THEME);
  });

  it("keeps the shipped sentinel out of the real theme ids", () => {
    // The sentinel is compared by value, so a collision is silent and total: a
    // theme whose id equalled it would be selectable, would report itself as
    // applied, and would apply no override at all -- picking it from the
    // switcher would show the shipped theme under the candidate's name.
    const real = [...NEXTLY_THEMES, ...TWEAKCN_THEMES].map(theme => theme.id);
    expect(real.length).toBeGreaterThan(0);
    expect(real).not.toContain(SHIPPED_THEME);
  });

  it("round-trips a selection", () => {
    writeSelection({ theme: "sand", density: "compact", densityChosen: false });
    expect(readSelection()).toEqual({
      theme: "sand",
      density: "compact",
      densityChosen: false,
    });
  });

  it("falls back to the shipped theme for an unknown id", () => {
    writeSelection({
      theme: "deleted",
      density: "default",
      densityChosen: false,
    });
    expect(readSelection().theme).toBe(SHIPPED_THEME);
  });

  it("falls back to the shipped theme for one this build no longer ships", () => {
    // Not hypothetical: every browser that used the 54-theme lab has one of
    // the pruned ids persisted. `graphite` was a real theme until the set was
    // shortlisted, which is exactly the shape of id that arrives here.
    writeSelection({
      theme: "graphite",
      density: "default",
      densityChosen: false,
    });
    expect(readSelection()).toEqual({
      theme: SHIPPED_THEME,
      density: "default",
      densityChosen: false,
    });
  });

  it("falls back to the default density for an unknown one", () => {
    // Densities are validated the same way theme ids are: the stylesheet has
    // no block for an unrecognised one, so applying it would style nothing.
    localStorage.setItem(
      "nextly-theme-lab",
      JSON.stringify({ theme: "sand", density: "roomy" })
    );
    expect(readSelection()).toEqual({
      theme: "sand",
      density: DEFAULT_SELECTION.density,
      densityChosen: false,
    });
  });

  it("falls back on corrupt stored json", () => {
    localStorage.setItem("nextly-theme-lab", "{not json");
    expect(readSelection()).toEqual(DEFAULT_SELECTION);
  });

  it("narrows a selection stored by an older build", () => {
    // The retired layout axis persisted a third key. A stored value from
    // before it was removed must still read back as a usable selection
    // rather than reintroducing a key nothing consumes.
    localStorage.setItem(
      "nextly-theme-lab",
      JSON.stringify({
        theme: "sand",
        layout: "right-panel",
        density: "compact",
      })
    );
    expect(readSelection()).toEqual({
      theme: "sand",
      density: "compact",
      densityChosen: false,
    });
  });

  it("recognises a tweakcn preset id as known", () => {
    writeSelection({
      theme: "tweakcn-vercel",
      density: "default",
      densityChosen: false,
    });
    expect(readSelection().theme).toBe("tweakcn-vercel");
  });
});

/**
 * The three themes below are picked for their recommendations, not their
 * looks: mono recommends `default` (and is the stored default), signal also
 * recommends `default`, and calm recommends `comfortable`. Between them every
 * case this needs -- a density that agrees with the outgoing theme, one that
 * disagrees, and a switch that leaves the recommendation unchanged -- is
 * expressible without a fixture theme that could drift from the real set.
 */
describe("theme lab density follow", () => {
  beforeEach(() => localStorage.clear());

  it("moves an untouched density to the new theme's recommendation", () => {
    const hook = renderThemeLab();
    try {
      expect(hook.current.density).toBe("default");

      hook.act(() => hook.current.setTheme("calm"));

      expect(hook.current.theme).toBe("calm");
      expect(hook.current.density).toBe("comfortable");
    } finally {
      hook.unmount();
    }
  });

  it("leaves a density the user changed alone across a theme switch", () => {
    const hook = renderThemeLab();
    try {
      // Density diverged from mono's recommendation before the switch, so it
      // is a deliberate choice and survives a theme that recommends another.
      hook.act(() => hook.current.setDensity("compact"));
      hook.act(() => hook.current.setTheme("calm"));

      expect(hook.current.theme).toBe("calm");
      expect(hook.current.density).toBe("compact");
    } finally {
      hook.unmount();
    }
  });

  it("keeps following after a switch that did not move density", () => {
    const hook = renderThemeLab();
    try {
      // mono and signal recommend the same density, so density stays
      // "following" rather than being read as a user choice on the next
      // switch -- the case a "user touched this axis" flag would get wrong.
      hook.act(() => hook.current.setTheme("signal"));
      expect(hook.current.density).toBe("default");

      hook.act(() => hook.current.setTheme("calm"));
      expect(hook.current.density).toBe("comfortable");
    } finally {
      hook.unmount();
    }
  });

  it("keeps following through the shipped selection", () => {
    const hook = renderThemeLab();
    try {
      // The resting state recommends nothing, which is what broke this. When
      // "following" was inferred by comparing the density against the current
      // theme's recommendation, returning to shipped left a density that
      // matched no recommendation -- so it read as a deliberate choice nobody
      // had made, and the next theme was shown at the previous theme's
      // metrics instead of its own.
      hook.act(() => hook.current.setTheme("calm"));
      expect(hook.current.density).toBe("comfortable");

      hook.act(() => hook.current.setTheme(SHIPPED_THEME));
      // Density is a separate axis; dropping the palette override does not
      // discard it.
      expect(hook.current.density).toBe("comfortable");

      hook.act(() => hook.current.setTheme("signal"));
      expect(hook.current.density).toBe("default");
    } finally {
      hook.unmount();
    }
  });

  it("still respects a chosen density through the shipped selection", () => {
    // The mirror case. Passing through the resting state must not FORGET a
    // real choice either, which a naive "reset following on shipped" fix
    // would have done.
    const hook = renderThemeLab();
    try {
      hook.act(() => hook.current.setDensity("compact"));
      hook.act(() => hook.current.setTheme(SHIPPED_THEME));
      hook.act(() => hook.current.setTheme("calm"));
      expect(hook.current.density).toBe("compact");
    } finally {
      hook.unmount();
    }
  });

  it("ignores an unknown theme id entirely", () => {
    const hook = renderThemeLab();
    try {
      hook.act(() => hook.current.setTheme("no-such-theme"));

      expect(hook.current.theme).toBe(DEFAULT_SELECTION.theme);
      expect(hook.current.density).toBe(DEFAULT_SELECTION.density);
    } finally {
      hook.unmount();
    }
  });

  it("sets no data-theme at all for the shipped selection", () => {
    // Absence is the mechanism, not an omission: the generated stylesheet is
    // keyed on `[data-theme="..."]`, so ANY value would win over the admin's
    // own tokens. Setting `data-theme="shipped"` would be just as wrong as
    // setting `data-theme="mono"` -- it would simply match no rule and leave
    // the density attribute as the only thing applied.
    const shell = document.createElement("div");
    shell.className = "nextly-admin";
    document.body.appendChild(shell);

    const hook = renderThemeLab();
    try {
      expect(shell.dataset.theme).toBeUndefined();
      expect(shell.dataset.density).toBe(DEFAULT_SELECTION.density);

      // And a lab override is REMOVED on the way back, not left behind.
      hook.act(() => hook.current.setTheme("sand"));
      expect(shell.dataset.theme).toBe("sand");

      hook.act(() => hook.current.setTheme(SHIPPED_THEME));
      expect(shell.dataset.theme).toBeUndefined();
    } finally {
      hook.unmount();
      shell.remove();
    }
  });

  it("leaves the lab's own preview panels unattributed", () => {
    // A preview wears `nextly-admin` to pick up the ui components' base
    // styles, but it is not an admin root. Attributed, every preview would
    // be stamped with the SELECTED theme's density -- so each theme would
    // be shown at whatever density is currently active rather than its own,
    // and every preview would shift whenever the selection changed.
    const shell = document.createElement("div");
    shell.className = "nextly-admin";
    const preview = document.createElement("div");
    preview.className = "nextly-admin";
    preview.setAttribute("data-theme-preview", "");
    shell.appendChild(preview);
    document.body.appendChild(shell);

    const hook = renderThemeLab();
    try {
      hook.act(() => hook.current.setTheme("sand"));

      expect(shell.dataset.theme).toBe("sand");
      expect(preview.dataset.theme).toBeUndefined();
      expect(preview.dataset.density).toBeUndefined();
    } finally {
      hook.unmount();
      shell.remove();
    }
  });

  it("attributes every admin root, including the portal container", () => {
    // The two roots the admin renders: the shell, and the container every
    // overlay portals into. Both re-declare the whole token set, so a theme
    // only reaches the overlays if both carry the attributes.
    const shell = document.createElement("div");
    shell.className = "nextly-admin";
    const portal = document.createElement("div");
    portal.id = "nextly-admin-portal-root";
    portal.className = "nextly-admin";
    shell.appendChild(portal);
    document.body.appendChild(shell);

    const hook = renderThemeLab();
    try {
      hook.act(() => hook.current.setTheme("sand"));

      for (const root of [shell, portal]) {
        expect(root.dataset.theme).toBe("sand");
        expect(root.dataset.density).toBe("comfortable");
      }
    } finally {
      hook.unmount();
      shell.remove();
    }
  });
});
