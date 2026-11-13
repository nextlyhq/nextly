// @vitest-environment jsdom
/**
 * The notice, side panel, tabs, progress bar, menu and hint, loaded from the
 * package's BUILT `@nextlyhq/plugin-sdk/admin` entry, the module a plugin's
 * bundle imports.
 *
 * IDENTITY: each is the admin's own object, not a copy that matched it once.
 * BEHAVIOUR as a plugin uses it, rendered outside any admin provider, because
 * identity alone passes for a component that throws without the admin's
 * providers.
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

const FORWARDED = [
  "Alert",
  "AlertDescription",
  "AlertTitle",
  "Sheet",
  "SheetClose",
  "SheetContent",
  "SheetDescription",
  "SheetFooter",
  "SheetHeader",
  "SheetTitle",
  "SheetTrigger",
  "Tabs",
  "TabsContent",
  "TabsList",
  "TabsTrigger",
  "Progress",
  "DropdownMenu",
  "DropdownMenuCheckboxItem",
  "DropdownMenuContent",
  "DropdownMenuGroup",
  "DropdownMenuItem",
  "DropdownMenuLabel",
  "DropdownMenuRadioGroup",
  "DropdownMenuRadioItem",
  "DropdownMenuSeparator",
  "DropdownMenuTrigger",
  "Tooltip",
  "TooltipContent",
  "TooltipProvider",
  "TooltipTrigger",
] as const;

describe("the notice, side panel, tabs, progress, menu and hint, from the plugin SDK", () => {
  it.each(FORWARDED)("%s is the admin's own", name => {
    expect(entry[name]).toBeDefined();
    expect(entry[name]).toBe(admin[name]);
  });

  it("Alert is announced, with its title and text", () => {
    const { Alert, AlertTitle, AlertDescription } = entry;
    act(() =>
      root.render(
        <Alert variant="warning">
          <AlertTitle>Not served yet</AlertTitle>
          <AlertDescription>Wire the proxy.</AlertDescription>
        </Alert>
      )
    );

    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe("Not served yetWire the proxy.");
  });

  it("Progress reports its value", () => {
    const { Progress } = entry;
    act(() => root.render(<Progress value={30} max={60} />));

    const bar = host.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute("aria-valuenow")).toBe("30");
    expect(bar?.getAttribute("aria-valuemax")).toBe("60");
  });

  it("Tabs show the panel of the selected tab", () => {
    const { Tabs, TabsList, TabsTrigger, TabsContent } = entry;
    act(() =>
      root.render(
        <Tabs defaultValue="one">
          <TabsList aria-label="Sources">
            <TabsTrigger value="one">This site</TabsTrigger>
            <TabsTrigger value="two">A file</TabsTrigger>
          </TabsList>
          <TabsContent value="one">First panel</TabsContent>
          <TabsContent value="two">Second panel</TabsContent>
        </Tabs>
      )
    );

    const tabs = Array.from(host.querySelectorAll('[role="tab"]'));
    expect(tabs.map(tab => tab.getAttribute("aria-selected"))).toEqual([
      "true",
      "false",
    ]);
    const panel = host.querySelector('[role="tabpanel"]');
    expect(panel?.textContent).toBe("First panel");
  });

  it("Sheet opens as a named dialog", () => {
    const { Sheet, SheetContent, SheetTitle, SheetDescription } = entry;
    act(() =>
      root.render(
        <Sheet open onOpenChange={() => {}}>
          <SheetContent side="right">
            <SheetTitle>Edit the page</SheetTitle>
            <SheetDescription>Its title and description.</SheetDescription>
          </SheetContent>
        </Sheet>
      )
    );

    // The panel renders in a portal, outside the host.
    const dialog = document.body.querySelector('[role="dialog"]');
    const label = document.getElementById(
      dialog?.getAttribute("aria-labelledby") ?? ""
    );
    expect(label?.textContent).toBe("Edit the page");
  });

  it("DropdownMenu shows its items when open", () => {
    const {
      DropdownMenu,
      DropdownMenuTrigger,
      DropdownMenuContent,
      DropdownMenuItem,
    } = entry;
    act(() =>
      root.render(
        <DropdownMenu open onOpenChange={() => {}}>
          <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem>Inspect</DropdownMenuItem>
            <DropdownMenuItem disabled>Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )
    );

    const items = Array.from(
      document.body.querySelectorAll('[role="menuitem"]')
    );
    expect(items.map(item => item.textContent)).toEqual(["Inspect", "Delete"]);
    expect(items[1]?.getAttribute("aria-disabled")).toBe("true");
  });

  it("Tooltip shows its hint when open", () => {
    const { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } = entry;
    act(() =>
      root.render(
        <TooltipProvider>
          <Tooltip open>
            <TooltipTrigger>Score</TooltipTrigger>
            <TooltipContent>Errors count twice</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )
    );

    expect(document.body.querySelector('[role="tooltip"]')?.textContent).toBe(
      "Errors count twice"
    );
  });
});
