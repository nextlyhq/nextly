// @vitest-environment jsdom
/**
 * Grouped rows, rows that open a region, the stepper and the save bar's own
 * message, loaded from the package's BUILT `@nextlyhq/plugin-sdk/admin` entry,
 * the module a plugin's bundle imports.
 *
 * IDENTITY: the stepper is the admin's own object, the one the email provider
 * setup draws, not a copy that matched it once. BEHAVIOUR as a plugin uses it,
 * rendered outside any admin provider: the grouping and the row region are
 * props of the admin's list, so they are only real for a plugin if they reach
 * the table through both barrels, and identity alone passes for a component
 * that throws without the admin's providers.
 *
 * The built entry is there because `turbo.json` makes this package's tests
 * depend on its own build; `vitest.global-setup.ts` stops a run that bypasses
 * that edge before it reaches a missing entry.
 */
import * as admin from "@nextlyhq/admin";
import * as entry from "@nextlyhq/plugin-sdk/admin";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

declare global {
  // React reads this to know `act` drives the renders, so it warns otherwise.
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

interface Item {
  id: string;
  title: string;
  kind: string;
}

const ITEMS: Item[] = [
  { id: "a", title: "Home", kind: "one" },
  { id: "b", title: "Pricing", kind: "two" },
];

describe("grouped rows, rows with a region, steps and the save bar's message, from the plugin SDK", () => {
  it("Stepper is the admin's own", () => {
    expect(typeof entry.Stepper).toBe("function");
    expect(entry.Stepper).toBe(admin.Stepper);
  });

  it("ListView draws each group as a row group named by its title", () => {
    const { ListView } = entry;
    act(() =>
      root.render(
        <ListView<Item>
          columns={[{ name: "title", header: "Title" }]}
          rows={ITEMS}
          ariaLabel="Items"
          grouping={{
            groups: [
              { id: "one", title: "First kind", actions: <a href="#x">Fix</a> },
              { id: "two", title: "Second kind" },
            ],
            groupOf: item => item.kind,
            collapsible: true,
          }}
        />
      )
    );

    const table = host.querySelector("table");
    const bodies = Array.from(table?.querySelectorAll("tbody") ?? []);
    const names = bodies.map(
      body =>
        document.getElementById(body.getAttribute("aria-labelledby") ?? "")
          ?.textContent
    );
    expect(names).toEqual(["First kind", "Second kind"]);
    expect(bodies[0]?.textContent).toContain("Home");
    expect(bodies[0]?.textContent).not.toContain("Pricing");
    expect(
      bodies[0]?.querySelector('th[scope="rowgroup"] a')?.textContent
    ).toBe("Fix");

    // Folding: the title is the button, and it hides the group's rows.
    const fold = bodies[0]?.querySelector<HTMLButtonElement>(
      "th button[aria-expanded]"
    );
    expect(fold?.getAttribute("aria-expanded")).toBe("true");
    act(() => fold?.click());
    expect(fold?.getAttribute("aria-expanded")).toBe("false");
    const row = table?.querySelector<HTMLElement>("tr[data-row-id='a']");
    expect(row?.hidden).toBe(true);
  });

  it("ListView opens a row's region from its toggle", () => {
    const { ListView } = entry;
    act(() =>
      root.render(
        <ListView<Item>
          columns={[{ name: "title", header: "Title" }]}
          rows={ITEMS}
          ariaLabel="Items"
          rowDetail={{ render: item => <p>About {item.title}</p> }}
        />
      )
    );

    const table = host.querySelector("table");
    const toggle = table?.querySelector<HTMLButtonElement>(
      "tr[data-row-id='a'] button[aria-expanded]"
    );
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    act(() => toggle?.click());
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    const region = document.getElementById(
      toggle?.getAttribute("aria-controls") ?? ""
    );
    expect(region?.getAttribute("role")).toBe("region");
    expect(region?.textContent).toBe("About Home");
  });

  it("Stepper marks the current step and links back from a done one", () => {
    const { Stepper } = entry;
    act(() =>
      root.render(
        <Stepper
          aria-label="Import"
          current={1}
          steps={[
            { label: "Choose the source", href: "/admin/plugins/x/source" },
            { label: "Match the fields" },
            { label: "Check the result" },
          ]}
        />
      )
    );

    const items = Array.from(
      host.querySelectorAll('ol[aria-label="Import"] > li')
    );
    expect(items.map(item => item.getAttribute("aria-current"))).toEqual([
      null,
      "step",
      null,
    ]);
    expect(items[0]?.querySelector("a")?.getAttribute("href")).toBe(
      "/admin/plugins/x/source"
    );
    expect(items[0]?.textContent).toContain("(done)");
  });

  it("FormActions says the page's own message", () => {
    const { FormActions } = entry;
    act(() =>
      root.render(
        <FormActions dirty message="1 page changed">
          <button type="button">Save</button>
        </FormActions>
      )
    );

    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      "1 page changed"
    );
  });
});
