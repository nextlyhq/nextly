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

import {
  readSelection,
  writeSelection,
  DEFAULT_SELECTION,
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
 * the other two axes) only exists inside the hook's state updater -- calling
 * a pure helper instead would test a different thing than what the switcher
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

  it("defaults to the mono control", () => {
    expect(readSelection()).toEqual(DEFAULT_SELECTION);
  });

  it("round-trips a selection", () => {
    writeSelection({
      theme: "sand",
      layout: "right-panel",
      density: "compact",
    });
    expect(readSelection()).toEqual({
      theme: "sand",
      layout: "right-panel",
      density: "compact",
    });
  });

  it("falls back to mono for an unknown theme id", () => {
    writeSelection({
      theme: "deleted",
      layout: "rail-panel",
      density: "default",
    });
    expect(readSelection().theme).toBe("mono");
  });

  it("falls back on corrupt stored json", () => {
    localStorage.setItem("nextly-theme-lab", "{not json");
    expect(readSelection()).toEqual(DEFAULT_SELECTION);
  });

  it("recognises a tweakcn preset id as known", () => {
    writeSelection({
      theme: "tweakcn-vercel",
      layout: "rail-panel",
      density: "default",
    });
    expect(readSelection().theme).toBe("tweakcn-vercel");
  });
});

/**
 * The three themes below are picked for their recommendations, not their
 * looks: mono is rail-panel/default (and the stored default), calm is
 * single-sidebar/comfortable, and terminal is rail-panel/compact. Between
 * them every combination this needs -- an axis that agrees with the outgoing
 * theme, one that disagrees, and one whose recommendation is unchanged by the
 * switch -- is expressible without a fixture theme that could drift from the
 * real set.
 */
describe("theme lab axis follow", () => {
  beforeEach(() => localStorage.clear());

  it("moves untouched axes to the new theme's recommendation", () => {
    const hook = renderThemeLab();
    try {
      expect(hook.current.layout).toBe("rail-panel");
      expect(hook.current.density).toBe("default");

      hook.act(() => hook.current.setTheme("calm"));

      expect(hook.current.theme).toBe("calm");
      expect(hook.current.layout).toBe("single-sidebar");
      expect(hook.current.density).toBe("comfortable");
    } finally {
      hook.unmount();
    }
  });

  it("leaves an axis the user changed alone across a theme switch", () => {
    const hook = renderThemeLab();
    try {
      hook.act(() => hook.current.setLayout("right-panel"));
      hook.act(() => hook.current.setTheme("calm"));

      // Layout diverged from mono's recommendation before the switch, so it
      // is a deliberate choice and survives it; density was still following,
      // so it moves.
      expect(hook.current.layout).toBe("right-panel");
      expect(hook.current.density).toBe("comfortable");
    } finally {
      hook.unmount();
    }
  });

  it("keeps following after a switch that did not move the axis", () => {
    const hook = renderThemeLab();
    try {
      // mono and terminal recommend the same layout, so layout stays
      // "following" rather than being read as a user choice on the next
      // switch -- the case a "user touched this axis" flag would get wrong.
      hook.act(() => hook.current.setTheme("terminal"));
      expect(hook.current.layout).toBe("rail-panel");
      expect(hook.current.density).toBe("compact");

      hook.act(() => hook.current.setTheme("calm"));
      expect(hook.current.layout).toBe("single-sidebar");
      expect(hook.current.density).toBe("comfortable");
    } finally {
      hook.unmount();
    }
  });

  it("holds a manual density through a theme that recommends another", () => {
    const hook = renderThemeLab();
    try {
      hook.act(() => hook.current.setDensity("compact"));
      hook.act(() => hook.current.setTheme("calm"));

      expect(hook.current.density).toBe("compact");
      expect(hook.current.layout).toBe("single-sidebar");
    } finally {
      hook.unmount();
    }
  });

  it("ignores an unknown theme id entirely", () => {
    const hook = renderThemeLab();
    try {
      hook.act(() => hook.current.setTheme("no-such-theme"));

      expect(hook.current.theme).toBe(DEFAULT_SELECTION.theme);
      expect(hook.current.layout).toBe(DEFAULT_SELECTION.layout);
      expect(hook.current.density).toBe(DEFAULT_SELECTION.density);
    } finally {
      hook.unmount();
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
      hook.act(() => hook.current.setTheme("terminal"));

      for (const root of [shell, portal]) {
        expect(root.dataset.theme).toBe("terminal");
        expect(root.dataset.layout).toBe("rail-panel");
        expect(root.dataset.density).toBe("compact");
      }
    } finally {
      hook.unmount();
      shell.remove();
    }
  });
});
