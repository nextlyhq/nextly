// @vitest-environment jsdom
/**
 * The editor's page status: where the page is in its life, in the admin's
 * words (Draft, Published or Scheduled, with when a scheduled page goes live
 * on hover), and never anything about its work. The life stage itself is the
 * admin's answer (`useDocumentLifeStage`), tested there against the status,
 * the page's history and its scheduled releases.
 */
import type { DocumentLifeStage } from "@nextlyhq/plugin-sdk/admin";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/** What the surrounding editor reports, set by each case. */
let stage: DocumentLifeStage | null = null;

vi.mock("@nextlyhq/plugin-sdk/admin", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useDocumentLifeStage: () => stage,
}));

const { DocumentStatusPill } = await import("./DocumentStatusPill");

afterEach(() => {
  cleanup();
  stage = null;
});

/** The pill, and its visible words without the screen-reader subject. */
function pill(): { words: string; element: HTMLElement } {
  const element = screen.getByText(/Page status/).parentElement;
  if (element === null) throw new Error("the pill was not drawn");
  return {
    element,
    words: element.textContent?.replace("Page status: ", "") ?? "",
  };
}

describe("DocumentStatusPill", () => {
  it.each([
    [{ stage: "draft", label: "Draft" }, "Draft"],
    [{ stage: "published", label: "Published" }, "Published"],
  ] as const)("reads %o as %s", (given, words) => {
    stage = given;
    render(<DocumentStatusPill />);
    expect(pill().words).toBe(words);
    expect(pill().element.getAttribute("title")).toBeNull();
  });

  it("reads Scheduled, with when it goes live on hover", () => {
    stage = {
      stage: "scheduled",
      label: "Scheduled",
      detail: "Goes live 3 Dec, 09:00",
    };
    render(<DocumentStatusPill />);
    expect(pill().words).toBe("Scheduled");
    expect(pill().element.getAttribute("title")).toBe("Goes live 3 Dec, 09:00");
  });

  it("draws nothing where no editor knows the page's life stage", () => {
    stage = null;
    const { container } = render(<DocumentStatusPill />);
    expect(container.childElementCount).toBe(0);
  });
});
