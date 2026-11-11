/**
 * The theme a person chose is one of their interface preferences, kept by the
 * device memory under whatever key the host gave the provider: forgotten with
 * the person on sign-out, removed by the site's off switch, and not kept at
 * all while remembering is off, when it applies to this tab alone.
 *
 * A host key outside the admin's own spelling is the case that separates a
 * provider that goes through the device memory from one that writes beside it.
 */
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  applyRememberingSwitch,
  forgetPerson,
  resetDeviceMemoryForTests,
} from "@admin/lib/device-memory/device-memory";

import { ThemeProvider, useTheme } from "./ThemeProvider";

const HOST_KEY = "my-app-theme";

let setTheme: (theme: string) => void = () => {};
let shown = "";

function Probe() {
  const theme = useTheme();
  setTheme = theme.setTheme;
  shown = theme.theme ?? "";
  return null;
}

function mount() {
  return render(
    <ThemeProvider enableSystem={false} storageKey={HOST_KEY}>
      <Probe />
    </ThemeProvider>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  resetDeviceMemoryForTests();
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("the theme under a host's own key", () => {
  it("is forgotten with the person on sign-out", () => {
    mount();
    act(() => setTheme("dark"));
    expect(window.localStorage.getItem(HOST_KEY)).toBe("dark");

    forgetPerson();
    expect(window.localStorage.getItem(HOST_KEY)).toBeNull();
  });

  it("is removed when the site turns remembering off", () => {
    mount();
    act(() => setTheme("dark"));
    applyRememberingSwitch(false);
    expect(window.localStorage.getItem(HOST_KEY)).toBeNull();
  });

  it("is kept for this tab alone while remembering is off", () => {
    applyRememberingSwitch(false);
    mount();
    act(() => setTheme("dark"));
    expect(window.localStorage.getItem(HOST_KEY)).toBeNull();
    expect(shown).toBe("dark");
  });
});
