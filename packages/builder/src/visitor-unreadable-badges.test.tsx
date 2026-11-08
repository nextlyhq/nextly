// @vitest-environment jsdom

/**
 * What the canvas badge's tooltip, and the inspector's note, say a visitor
 * sees in place of a field they can't read: a fallback chosen from the media
 * library named by its file and pictured, never by its raw id, while an
 * address and a text fallback keep their quoted words.
 */
import type { VisitorUnreadableBinding } from "@nextlyhq/blocks-engine";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MediaSummary } from "./content-controls";
import {
  VisitorUnreadableLine,
  tipRunsFromStart,
  tipRunsUp,
  visitorUnreadableSentence,
} from "./visitor-unreadable-badges";
import { VisitorUnreadableNote } from "./visitor-unreadable-context";

afterEach(cleanup);

const ADDRESS = "https://cdn.example.test/spring-banner.jpg";

/** An image bound to a field visitors may not read, with `fallback`. */
const image = (fallback: string): VisitorUnreadableBinding => ({
  prop: "mediaId",
  path: "internalCover",
  kind: "image",
  fallback: { value: fallback },
});

const reader = () =>
  vi.fn<(id: string) => Promise<MediaSummary | null>>(async () => ({
    name: "spring-banner.jpg",
    thumbnail: "/t/spring.jpg",
  }));

describe("a visitor-unreadable binding's fallback, in words", () => {
  it("names a library fallback by its file, with its picture, never its id", async () => {
    const readMedia = reader();
    const { container } = render(
      <span data-testid="line">
        <VisitorUnreadableLine
          binding={image("m-7")}
          readMedia={readMedia}
          pictured
        />
      </span>
    );
    const line = screen.getByTestId("line");
    expect(
      await screen.findByText(
        "Visitors can't read “internalCover”. They see the fallback image “spring-banner.jpg”."
      )
    ).toBeTruthy();
    expect(readMedia).toHaveBeenCalledWith("m-7");
    expect(line.textContent).not.toContain("m-7");
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "/t/spring.jpg"
    );
  });

  it("says it is a library image while the file is read, or where it can't be", () => {
    expect(visitorUnreadableSentence(image("m-7"))).toBe(
      "Visitors can't read “internalCover”. They see a fallback image from the library."
    );
    render(
      <VisitorUnreadableLine binding={image("m-7")} readMedia={undefined} />
    );
    expect(document.body.textContent).not.toContain("m-7");
  });

  it("keeps an address fallback quoted, and reads no file for it", () => {
    // The control: an address is a word a reader knows, so it is quoted as
    // before, and never handed to the media read as an id.
    const readMedia = reader();
    render(
      <VisitorUnreadableLine binding={image(ADDRESS)} readMedia={readMedia} />
    );
    expect(document.body.textContent).toBe(
      `Visitors can't read “internalCover”. They see the fallback: “${ADDRESS}”.`
    );
    expect(readMedia).not.toHaveBeenCalled();
  });

  it("keeps a text prop's fallback quoted, though it reads like an id", () => {
    // The same text on a heading is text, not a file: the kind decides.
    const readMedia = reader();
    render(
      <VisitorUnreadableLine
        binding={{
          prop: "text",
          path: "internalNote",
          kind: "text",
          fallback: { value: "m-7" },
        }}
        readMedia={readMedia}
      />
    );
    expect(document.body.textContent).toBe(
      "Visitors can't read “internalNote”. They see the fallback: “m-7”."
    );
    expect(readMedia).not.toHaveBeenCalled();
  });

  it("names the file in the inspector's note as the badge does", async () => {
    render(
      <VisitorUnreadableNote
        bindings={[image("m-7")]}
        props={new Set(["mediaId"])}
        services={{ readMedia: reader() }}
      />
    );
    await waitFor(() =>
      expect(screen.getByRole("note").textContent).toBe(
        "Visitors can't read “internalCover”. They see the fallback image “spring-banner.jpg”."
      )
    );
  });
});

describe("the badge's tooltip, beside the screen's left edge", () => {
  it("runs right from the badge where the widest tooltip would be cut on its left", () => {
    // The badge's right edge 180px in from the screen's left: a tooltip up
    // to 288px wide, right-aligned with it, would start off screen.
    expect(tipRunsFromStart(228, 48)).toBe(true);
  });

  it("runs left from the badge's right edge where there is room", () => {
    // The control: the same screen, a badge far enough in.
    expect(tipRunsFromStart(48 + 400, 48)).toBe(false);
  });
});

describe("the badge's tooltip, near the screen's foot", () => {
  // A screen 600px tall, from y=40 in the chrome's coordinates.
  const screenBand = { x: 48, y: 40, width: 900, height: 600 };

  it("opens upwards from a badge on its block's bottom edge near the foot", () => {
    // The badge's top at 560: 22px of badge and 6px of gap leave 52px under
    // it, too little for a tooltip of a few lines, with 514px above.
    expect(tipRunsUp(560, screenBand)).toBe(true);
  });

  it("opens downwards where there is room under the badge", () => {
    // The control: the same screen, a badge higher up. Fails were the
    // tooltip turned upwards by its edge alone, or by any badge on the bottom.
    expect(tipRunsUp(200, screenBand)).toBe(false);
  });

  it("opens downwards where there is even less room above", () => {
    // A screen too short for the tooltip either way: below keeps the room
    // that is larger, rather than turning up into less.
    expect(tipRunsUp(60, { x: 48, y: 40, width: 900, height: 140 })).toBe(
      false
    );
  });
});
