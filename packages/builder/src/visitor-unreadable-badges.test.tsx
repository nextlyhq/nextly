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
