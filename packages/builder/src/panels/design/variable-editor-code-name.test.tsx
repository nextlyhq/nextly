// @vitest-environment jsdom

/**
 * A variable's "Code name" line in Design reads the site's CSS variable
 * prefix: the default `--site-`, a prefix the site sets, and a new one the
 * moment the site's variables arrive with it.
 */
import type { SiteTokenSet } from "@nextlyhq/blocks-engine";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { TokensPanel } from "./tokens-panel";

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
});

const BRAND = {
  name: "color.brand",
  kind: "color",
  values: { light: "#1d2b6b" },
} as const;

function panel(tokens: SiteTokenSet) {
  return (
    <TokensPanel
      tokens={tokens}
      currentTokens={() => tokens}
      onChange={() => undefined}
    />
  );
}

/** The open editor's "Code name" line, as it reads. */
async function codeNameOfBrand(): Promise<string> {
  fireEvent.click(screen.getByRole("button", { name: /^Brand/ }));
  const editor = await screen.findByRole("dialog");
  const line = within(editor).getByText("Code name:").closest("p");
  return line?.textContent ?? "";
}

describe("a variable's code name", () => {
  it("is written under --site- when the site sets no prefix", async () => {
    render(panel({ tokens: [BRAND] }));
    expect(await codeNameOfBrand()).toBe("Code name: --site-color-brand");
  });

  it("is written under the site's prefix", async () => {
    render(panel({ tokens: [BRAND], prefix: "--brand-" }));
    expect(await codeNameOfBrand()).toBe("Code name: --brand-color-brand");
  });

  it("follows a prefix change while the editor is open", async () => {
    const view = render(panel({ tokens: [BRAND] }));
    expect(await codeNameOfBrand()).toBe("Code name: --site-color-brand");
    view.rerender(panel({ tokens: [BRAND], prefix: "--brand-" }));
    const editor = screen.getByRole("dialog");
    expect(
      within(editor).getByText("Code name:").closest("p")?.textContent
    ).toBe("Code name: --brand-color-brand");
  });
});
