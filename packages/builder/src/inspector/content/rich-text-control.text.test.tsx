// @vitest-environment jsdom
/**
 * A Text's field in the panel: the shared editor held to one paragraph, its
 * words written as they are typed (so the canvas shows them as they go in,
 * not when the field is left), and a paste that lost formatting said under
 * the field in the words the canvas uses.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TEXT_FORMAT } from "@nextlyhq/blocks-engine";

import type { ContentServices } from "./content-services";
import { ONE_PARAGRAPH_DROPPED, RichTextField } from "./rich-text-control";
import { typingRunNow } from "../../typing-run";

afterEach(() => cleanup());

const one = (...children: unknown[]) => ({
  root: { type: "root", children: [{ type: "paragraph", children }] },
});

interface ParagraphOptions {
  paragraph?: {
    restrict: (value: unknown) => { value: unknown; dropped: boolean };
    onChange?: (value: unknown) => void;
    onDropped?: () => void;
  };
}

function editorWith(read: () => unknown) {
  const calls: { value: unknown; options: ParagraphOptions | undefined }[] = [];
  const attach = vi.fn(
    (_element: HTMLElement, value: unknown, options?: ParagraphOptions) => {
      calls.push({ value, options });
      return {
        status: "attached",
        session: { focus: vi.fn(), read, detach: vi.fn(), hold: vi.fn() },
      };
    }
  );
  const services = {
    loadRichTextEditor: vi.fn(async () => ({ attach })),
  } as unknown as ContentServices;
  return { services, calls };
}

async function openField(
  value: unknown,
  onCommit: (value: unknown) => unknown,
  read: () => unknown = () => one()
) {
  const { services, calls } = editorWith(read);
  render(
    <>
      <span id="text-label">Text</span>
      <RichTextField
        id="text"
        labelledBy="text-label"
        value={value}
        disabled={false}
        onCommit={next => onCommit(next) as never}
        services={services}
        oneParagraph
      />
    </>
  );
  const box = screen.getByRole("textbox", { name: "Text" });
  await act(async () => {
    fireEvent.focus(box);
  });
  return { box, calls };
}

describe("a Text's field in the panel", () => {
  it("opens an older string as its words and line breaks, held to one paragraph", async () => {
    const { calls } = await openField("One\nTwo", () => undefined);
    expect(calls[0]?.value).toEqual(
      one(
        { type: "text", text: "One", format: 0 },
        { type: "linebreak" },
        { type: "text", text: "Two", format: 0 }
      )
    );
    expect(calls[0]?.options?.paragraph).toBeDefined();
  });

  it("writes the words as they are typed, each write in one run of typing", async () => {
    const runs: (object | null)[] = [];
    const written: unknown[] = [];
    const { calls } = await openField("", next => {
      runs.push(typingRunNow());
      written.push(next);
    });
    const onChange = calls[0]?.options?.paragraph?.onChange;
    act(() => {
      onChange?.(one({ type: "text", text: "H", format: 0 }));
      onChange?.(one({ type: "text", text: "Hi", format: TEXT_FORMAT.BOLD }));
    });
    expect(written).toHaveLength(2);
    expect(runs[0]).not.toBeNull();
    expect(runs[1]).toBe(runs[0]);
  });

  it("writes what is left restricted, in the same run, when the field is left", async () => {
    const runs: (object | null)[] = [];
    const written: unknown[] = [];
    const { box, calls } = await openField(
      "",
      next => {
        runs.push(typingRunNow());
        written.push(next);
      },
      () => ({
        root: {
          type: "root",
          children: [
            { type: "heading", children: [{ type: "text", text: "Big" }] },
          ],
        },
      })
    );
    act(() => calls[0]?.options?.paragraph?.onChange?.(one()));
    await act(async () => {
      fireEvent.blur(box);
    });
    expect(written.at(-1)).toEqual(
      one({ type: "text", text: "Big", format: 0 })
    );
    expect(runs.at(-1)).toBe(runs[0]);
  });

  it("says under the field what a paste lost", async () => {
    const { calls } = await openField("", () => undefined);
    act(() => calls[0]?.options?.paragraph?.onDropped?.());
    expect(screen.getByRole("status").textContent).toBe(ONE_PARAGRAPH_DROPPED);
  });
});
