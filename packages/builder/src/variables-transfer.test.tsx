// @vitest-environment jsdom

/**
 * The message an export leaves: every file it saved, by file name and in words,
 * so an author can tell the variables from the theme file without opening them.
 */
import type { SiteTokenSet } from "@nextlyhq/blocks-engine";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { useVariablesTransfer } from "./variables-transfer";

/** The transfer menu and its report, hosted as the Design panel hosts them. */
function Host({ tokens }: { tokens: SiteTokenSet }): React.JSX.Element {
  const transfer = useVariablesTransfer({
    onChange: () => undefined,
    currentTokens: () => tokens,
    readOnly: false,
  });
  return (
    <>
      {transfer.menu}
      {transfer.overlays}
    </>
  );
}

afterEach(cleanup);

beforeAll(() => {
  const element = window.Element.prototype as unknown as Record<
    string,
    unknown
  >;
  element.scrollIntoView = function scrollIntoView(): void {};
  element.hasPointerCapture = () => false;
  element.releasePointerCapture = () => undefined;
  (window as unknown as Record<string, unknown>).ResizeObserver =
    class ResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  // A download needs an object URL, which jsdom does not make.
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: () => "blob:variables",
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: () => undefined,
  });
});

const WITH_DARK: SiteTokenSet = {
  tokens: [
    {
      name: "color.brand",
      kind: "color",
      values: { light: "#1d2b6b", dark: "#8fa7ff" },
    },
    { name: "space.4", kind: "dimension", values: { light: "1rem" } },
  ],
};

async function exportWith(item: string): Promise<string> {
  fireEvent.keyDown(screen.getByRole("button", { name: "Import or export" }), {
    key: "Enter",
  });
  fireEvent.click(await screen.findByRole("menuitem", { name: item }));
  await waitFor(() => expect(screen.getByRole("status")).toBeDefined());
  return screen.getByRole("status").querySelector("p")?.textContent ?? "";
}

describe("the message an export leaves", () => {
  it("names the variables and the theme file in words", async () => {
    render(<Host tokens={WITH_DARK} />);
    expect(await exportWith("Export (DTCG)")).toBe(
      "Saved variables.tokens.json (variables) and variables.resolver.json (theme file: dark values)."
    );
  });

  it("names only the variables when no variable has a dark value", async () => {
    render(
      <Host
        tokens={{
          tokens: [
            { name: "space.4", kind: "dimension", values: { light: "1rem" } },
          ],
        }}
      />
    );
    expect(await exportWith("Export (DTCG)")).toBe(
      "Saved variables.tokens.json (variables)."
    );
  });

  it("names each Figma file by its mode", async () => {
    render(<Host tokens={WITH_DARK} />);
    expect(await exportWith("Export for Figma")).toBe(
      "Saved light.tokens.json (Figma light mode) and dark.tokens.json (Figma dark mode)."
    );
  });
});
