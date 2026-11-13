// @vitest-environment jsdom
/**
 * The admin's page building blocks, loaded from the package's BUILT
 * `@nextlyhq/plugin-sdk/admin` entry, the module a plugin's bundle imports.
 *
 * Two properties, and each needs its own half. IDENTITY: every export is the
 * admin's own object, so a plugin's list, trail, segmented control, checklist
 * and settings row are the admin's rather than a copy that matched it once —
 * an entry that kept a name but pointed elsewhere fails there. BEHAVIOUR as a
 * plugin uses it, rendered outside any admin provider as a plugin's own test
 * renders it: identity alone passes for a component that throws without the
 * admin's providers, which is the plausible break for parts lifted out of
 * admin pages.
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

const BLOCKS = [
  "ListView",
  "ListToolbar",
  "ListColumnsMenu",
  "ListEmptyState",
  "useListColumns",
  "useTableColumns",
  "Breadcrumbs",
  "SegmentedChoice",
  "Checklist",
  "ChecklistItem",
  "ChecklistMark",
  "ChecklistProgress",
  "SettingsRowGroup",
  "Badge",
] as const;

describe("the page building blocks, from the plugin SDK", () => {
  it.each(BLOCKS)("%s is the admin's own", name => {
    expect(typeof entry[name]).toBe("function");
    expect(entry[name]).toBe(admin[name]);
  });

  it("ListView says the list is empty, and says so differently for a search that matched nothing", () => {
    const { ListView } = entry;
    const columns = [{ name: "title", header: "Title" }];
    const draw = (search: string) =>
      act(() =>
        root.render(
          <ListView<{ id: string; title: string }>
            columns={columns}
            rows={[]}
            search={{
              value: search,
              onChange: () => {},
              placeholder: "Search pages",
            }}
            empty={{ title: "No pages yet" }}
            emptyFiltered={{ title: "No page matches" }}
          />
        )
      );

    draw("");
    expect(host.querySelector('[data-slot="list-toolbar"]')).not.toBeNull();
    expect(host.querySelector("input")?.getAttribute("placeholder")).toBe(
      "Search pages"
    );
    expect(host.querySelector("h3")?.textContent).toBe("No pages yet");

    draw("zzz");
    expect(host.querySelector("h3")?.textContent).toBe("No page matches");
  });

  it("ListView draws its rows through the admin's table", () => {
    const { ListView } = entry;
    act(() =>
      root.render(
        <ListView<{ id: string; title: string }>
          columns={[{ name: "title", header: "Title" }]}
          rows={[
            { id: "a", title: "Home" },
            { id: "b", title: "Pricing" },
          ]}
          getRowId={row => row.id}
          ariaLabel="Pages"
          empty={{ title: "No pages yet" }}
        />
      )
    );

    const table = host.querySelector("table");
    expect(table).not.toBeNull();
    expect(table?.textContent).toContain("Home");
    expect(table?.textContent).toContain("Pricing");
    expect(host.textContent).not.toContain("No pages yet");
  });

  it("Breadcrumbs draws the trail where it stands outside the admin shell", () => {
    const { Breadcrumbs } = entry;
    act(() =>
      root.render(
        <Breadcrumbs
          items={[
            { label: "SEO", href: "/admin/plugins/seo" },
            { label: "Pages" },
          ]}
        />
      )
    );

    const nav = host.querySelector('nav[aria-label="Breadcrumb"]');
    expect(nav).not.toBeNull();
    expect(nav?.querySelector("a")?.getAttribute("href")).toBe(
      "/admin/plugins/seo"
    );
    expect(nav?.textContent).toContain("Pages");
  });

  it("SegmentedChoice is a radio group the arrow keys move", () => {
    const { SegmentedChoice } = entry;
    const onSelect = vi.fn();
    act(() =>
      root.render(
        <SegmentedChoice
          aria-label="Mode"
          options={[
            { value: "view", label: "View" },
            { value: "edit", label: "Edit" },
          ]}
          value="view"
          onSelect={onSelect}
        />
      )
    );

    const group = host.querySelector('[role="radiogroup"]');
    expect(group?.getAttribute("aria-label")).toBe("Mode");
    const radios = Array.from(host.querySelectorAll('[role="radio"]'));
    expect(radios.map(radio => radio.getAttribute("aria-checked"))).toEqual([
      "true",
      "false",
    ]);
    act(() =>
      radios[0]!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })
      )
    );
    expect(onSelect).toHaveBeenCalledWith("edit");
  });

  it("Checklist speaks each step's status", () => {
    const { Checklist, ChecklistItem } = entry;
    act(() =>
      root.render(
        <Checklist label="Set up SEO" done={1} total={2}>
          <ChecklistItem status="done" label="Name the site" />
          <ChecklistItem status="open" label="Import old values" />
        </Checklist>
      )
    );

    const items = Array.from(
      host.querySelectorAll('ol[aria-label="Set up SEO"] > li')
    ).map(item => item.textContent);
    expect(items).toEqual([
      "Name the site — done",
      "Import old values — still to do",
    ]);
  });

  it("SettingsRowGroup names its controls as one group", () => {
    const { SettingsRowGroup } = entry;
    act(() =>
      root.render(
        <SettingsRowGroup
          label="Title separator"
          description="Between title and site"
        >
          <button type="button">|</button>
        </SettingsRowGroup>
      )
    );

    const group = host.querySelector('[role="group"]');
    const labelId = group?.getAttribute("aria-labelledby");
    expect(labelId).toBeTruthy();
    expect(document.getElementById(labelId!)?.textContent).toBe(
      "Title separator"
    );
    expect(group?.getAttribute("data-slot")).toBe("field-row");
  });

  it("FieldShell's row layout puts the label beside the control and wires it", () => {
    const { FieldShell, Input } = entry;
    act(() =>
      root.render(
        <FieldShell layout="row" label="Site name" description="Ends titles.">
          <Input />
        </FieldShell>
      )
    );

    const row = host.querySelector('[data-slot="field-row"]');
    const [left, right] = Array.from(row?.children ?? []);
    const input = right?.querySelector("input");
    const label = left?.querySelector("label");
    expect(input).toBeTruthy();
    expect(label?.getAttribute("for")).toBe(input?.id);
    expect(input?.getAttribute("aria-describedby")).toBeTruthy();
  });
});
