// @vitest-environment jsdom
/**
 * That the Design panel's tabs READ their words from the editor's catalogue.
 *
 * The catalogue is replaced with words no surface could have typed, and the
 * tabs must show those: a label typed beside the catalogue would still read
 * "Variables" and pass any comparison with it.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@nextlyhq/builder/shell", async importOriginal => {
  const real = await importOriginal<typeof import("@nextlyhq/builder/shell")>();
  return {
    ...real,
    EDITOR_WORDS: Object.fromEntries(
      Object.keys(real.EDITOR_WORDS).map(key => [key, `«${key}»`])
    ),
  };
});

const { DesignPanel } = await import("./design-panel");

afterEach(cleanup);

describe("the Design panel's words", () => {
  it("names itself and its tabs from the editor's catalogue", () => {
    render(
      <DesignPanel
        view={{ current: null, choose: vi.fn() }}
        tabs={{
          variables: () => <p>variables</p>,
          classes: () => <p>classes</p>,
          fonts: () => <p>fonts</p>,
        }}
      />
    );

    expect(screen.getAllByRole("tab").map(tab => tab.textContent)).toEqual([
      "«variables»",
      "«sharedStyles»",
      "«fonts»",
    ]);
    expect(screen.getByRole("heading", { name: "«design»" })).toBeTruthy();
    expect(screen.getByRole("tablist", { name: "«design»" })).toBeTruthy();
  });
});
