// @vitest-environment jsdom
/**
 * The New page dialog's "Start from" choices, for a starter the site can't
 * use: listed, dimmed and not choosable, saying "Not available on this site"
 * and the server's reason, which is also the choice's description. Blank and
 * the starters the site can use are chosen as before.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { JSX } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { NewPageStarter } from "../../pages-write-contract";

// A starter's picture is the shared picture part's, tested beside it; here
// it is a plain mark, so the choices render without the site's style.
vi.mock("../header-footer-pictures", () => ({
  useDocumentPictures: () => (): JSX.Element => <span data-picture="" />,
}));

const { NewPageStarters } = await import("./new-page-starters");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** A starter as the read lists it: its blocks are one Heading. */
function starter(
  id: string,
  label: string,
  unavailable?: string
): NewPageStarter {
  return {
    id,
    label,
    description: `${label}, in a few blocks.`,
    document: {
      formatVersion: 1,
      kind: "page",
      nodes: [
        {
          id: `${id}-title`,
          type: "core/heading",
          version: 1,
          props: { text: label, level: 1 },
        },
      ],
    },
    ...(unavailable === undefined
      ? {}
      : { unavailable: { reason: unavailable } }),
  };
}

const REASON = "Needs 5 levels of nesting; this site allows 4.";

describe("a starter the site can't use", () => {
  it("is listed dimmed and not choosable, saying why", async () => {
    const onChoose = vi.fn();
    render(
      <NewPageStarters
        starters={[
          starter("landing", "Landing"),
          starter("deep", "Deep", REASON),
        ]}
        chosen={undefined}
        onChoose={onChoose}
      />
    );
    const row = screen.getByRole("group", { name: "Start from" });
    // Named by its label alone: the note and the reason describe it.
    const deep = within(row).getByRole("radio", { name: "Deep" });
    expect((deep as HTMLInputElement).disabled).toBe(true);
    const tile = deep.closest("label");
    expect(tile?.textContent).toContain("Not available on this site");
    expect(tile?.textContent).toContain(REASON);
    expect(tile?.hasAttribute("data-unavailable")).toBe(true);
    const described = (deep.getAttribute("aria-describedby") ?? "")
      .split(" ")
      .map(id => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    expect(described).toContain("Not available on this site");
    expect(described).toContain(REASON);
    // Clicking its tile chooses nothing; the starter it can use still is.
    await userEvent.click(within(row).getByText("Deep"));
    expect(onChoose).not.toHaveBeenCalled();
    await userEvent.click(within(row).getByText("Landing"));
    expect(onChoose).toHaveBeenCalledWith("landing");
    // An available starter keeps its own description and no note.
    const landing = within(row).getByRole("radio", { name: "Landing" });
    expect((landing as HTMLInputElement).disabled).toBe(false);
    expect(
      document.getElementById(landing.getAttribute("aria-describedby") ?? "")
        ?.textContent
    ).toBe("Landing, in a few blocks.");
  });

  it("is not kept as the choice: Blank is chosen in its place", () => {
    const onChoose = vi.fn();
    render(
      <NewPageStarters
        starters={[starter("deep", "Deep", REASON)]}
        chosen="deep"
        onChoose={onChoose}
      />
    );
    const row = screen.getByRole("group", { name: "Start from" });
    expect(
      (within(row).getByRole("radio", { name: "Deep" }) as HTMLInputElement)
        .checked
    ).toBe(false);
    expect(
      (within(row).getByRole("radio", { name: "Blank" }) as HTMLInputElement)
        .checked
    ).toBe(true);
    // The form is told, so a page is never asked of the server from it.
    expect(onChoose).toHaveBeenCalledWith(undefined);
  });
});
