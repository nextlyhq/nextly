// @vitest-environment jsdom
/**
 * When the panel's text box says its change could not be saved, and what it
 * says then.
 *
 * The page refuses an edit that changes nothing, so writing again what the
 * box already wrote as it was typed is refused. That refusal is not one: the
 * words are on the page. Only a real refusal holds the passage open, and it
 * is worded by the reason the panel gives, not always as the size limit.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createOpenPassages } from "../../canvas/open-passages";
import { TypingCancel } from "../../live-draft";
import { typingRunNow } from "../../typing-run";

import type { ContentServices } from "./content-services";
import { PropRefusalContext, type PropRefusal } from "./prop-refusal";
import { RichTextControl, RichTextField } from "./rich-text-control";

afterEach(() => cleanup());

const one = (text: string) => ({
  root: {
    type: "root",
    children: [
      { type: "paragraph", children: [{ type: "text", text, format: 0 }] },
    ],
  },
});

interface ParagraphOptions {
  paragraph?: { onChange?: (value: unknown) => void };
}

/** A shared editor whose words are `words.current`, read when asked. */
function sharedEditor(words: { current: unknown }) {
  const detach = vi.fn();
  const hold = vi.fn();
  const options: { current: ParagraphOptions | undefined } = {
    current: undefined,
  };
  const attach = vi.fn(
    (_element: HTMLElement, _value: unknown, given?: ParagraphOptions) => {
      options.current = given;
      return {
        status: "attached",
        session: { focus: vi.fn(), read: () => words.current, detach, hold },
      };
    }
  );
  const passages = createOpenPassages();
  const services = {
    loadRichTextEditor: vi.fn(async () => ({ attach })),
    openPassages: passages,
  } as unknown as ContentServices;
  return { services, passages, detach, hold, options };
}

/**
 * A page holding one passage, refusing as the page does: a write of what it
 * already holds changes nothing and is refused, and `refuse` refuses the rest.
 */
function Page({
  initial,
  services,
  oneParagraph,
  refuse,
  writes,
}: {
  initial: unknown;
  services: ContentServices;
  oneParagraph: boolean;
  refuse: { current: boolean };
  writes: { value: unknown; run: object | null }[];
}): React.JSX.Element {
  const [stored, setStored] = React.useState<unknown>(initial);
  const latest = React.useRef(stored);
  latest.current = stored;
  return (
    <>
      <span id="text-label">Text</span>
      <RichTextField
        id="text"
        labelledBy="text-label"
        value={stored}
        disabled={false}
        services={services}
        oneParagraph={oneParagraph}
        onCommit={next => {
          writes.push({ value: next, run: typingRunNow() });
          if (refuse.current) return null;
          if (JSON.stringify(next) === JSON.stringify(latest.current)) {
            return null;
          }
          latest.current = next;
          setStored(next);
          return { formatVersion: 1, kind: "page", nodes: [] } as never;
        }}
      />
    </>
  );
}

async function open(initial: unknown, oneParagraph = true) {
  const words = { current: initial };
  const editor = sharedEditor(words);
  const refuse = { current: false };
  const writes: { value: unknown; run: object | null }[] = [];
  const view = (
    <Page
      initial={initial}
      services={editor.services}
      oneParagraph={oneParagraph}
      refuse={refuse}
      writes={writes}
    />
  );
  render(view);
  const box = screen.getByRole("textbox", { name: "Text" });
  await act(async () => {
    fireEvent.focus(box);
  });
  /** The author types `text`: the editor holds it and writes it live. */
  const type = (text: string) => {
    words.current = one(text);
    act(() => editor.options.current?.paragraph?.onChange?.(one(text)));
  };
  return { box, words, refuse, writes, type, ...editor };
}

const leave = async (box: HTMLElement) => {
  await act(async () => {
    fireEvent.blur(box);
  });
};

describe("the panel's text box, left after typing", () => {
  it("lets the passage go, with nothing said, when its words were written as they were typed", async () => {
    const field = await open(one("A paragraph"));
    expect(field.passages.isOpen()).toBe(true);
    field.type("A paragraph, browse by category");
    await leave(field.box);
    expect(screen.queryByRole("status")).toBeNull();
    expect(field.hold).not.toHaveBeenCalled();
    expect(field.detach).toHaveBeenCalledTimes(1);
    // Released, so the page no longer counts an open passage as unsaved.
    expect(field.passages.isOpen()).toBe(false);
  });

  it("finishes the same way when a save finishes it before the box is left", async () => {
    const field = await open(one("A paragraph"));
    field.type("A paragraph, browse by category");
    act(() => {
      field.passages.finishAll();
    });
    expect(screen.queryByRole("status")).toBeNull();
    expect(field.passages.isOpen()).toBe(false);
  });

  it("writes nothing for a passage left as it was", async () => {
    const field = await open(one("Unchanged"), false);
    await leave(field.box);
    expect(field.writes).toHaveLength(0);
    expect(screen.queryByRole("status")).toBeNull();
    expect(field.passages.isOpen()).toBe(false);
  });

  it("still writes what the typing did not, and lets go", async () => {
    const field = await open(one("Old"));
    field.type("Old and");
    field.words.current = one("Old and new");
    await leave(field.box);
    expect(field.writes.at(-1)?.value).toEqual(one("Old and new"));
    expect(screen.queryByRole("status")).toBeNull();
    expect(field.passages.isOpen()).toBe(false);
  });
});

/** A Text's prop, as the Content tab draws it, with the panel's reason. */
async function openControl(reason: PropRefusal | undefined) {
  const words = { current: one("Long") };
  const editor = sharedEditor(words);
  const why = vi.fn((_name: string, _value: unknown) => reason ?? "refused");
  render(
    <PropRefusalContext.Provider value={reason === undefined ? undefined : why}>
      <RichTextControl
        id="text"
        prop={
          {
            name: "text",
            value: one("Long"),
            schema: { type: "richText", oneParagraph: true },
          } as never
        }
        disabled={false}
        onCommit={() => null}
        services={editor.services}
      />
    </PropRefusalContext.Provider>
  );
  const box = screen.getByRole("textbox", { name: "Text" });
  await act(async () => {
    fireEvent.focus(box);
  });
  words.current = one("Longer");
  await leave(box);
  return { why, box, ...editor };
}

describe("a refused write in the panel's text box", () => {
  it("names the size limit only when the page is at it", async () => {
    const field = await openControl("size-limit");
    expect(field.why).toHaveBeenCalledWith("text", one("Longer"));
    expect(screen.getByRole("status").textContent).toContain(
      "because the page is at its size limit"
    );
    expect(field.hold).toHaveBeenCalled();
  });

  it("says the text can no longer be changed, for a lock", async () => {
    await openControl("locked");
    const said = screen.getByRole("status").textContent ?? "";
    expect(said).toContain("can no longer be changed here");
    expect(said).not.toContain("size limit");
  });

  it("does not guess the size limit when the reason is not known", async () => {
    await openControl(undefined);
    const said = screen.getByRole("status").textContent ?? "";
    expect(said).toContain("could not be saved");
    expect(said).not.toContain("size limit");
  });
});

describe("Escape on a refused passage", () => {
  it("takes back what its typing wrote, so the page matches the box", async () => {
    const words = { current: one("Before") };
    const editor = sharedEditor(words);
    const refuse = { current: false };
    const writes: { value: unknown; run: object | null }[] = [];
    const cancel = vi.fn((_run: object) => true);
    render(
      <TypingCancel.Provider value={cancel}>
        <Page
          initial={one("Before")}
          services={editor.services}
          oneParagraph
          refuse={refuse}
          writes={writes}
        />
      </TypingCancel.Provider>
    );
    const box = screen.getByRole("textbox", { name: "Text" });
    await act(async () => {
      fireEvent.focus(box);
    });
    words.current = one("Before and after");
    act(() =>
      editor.options.current?.paragraph?.onChange?.(one("Before and after"))
    );
    const run = writes[0]?.run;
    expect(run).not.toBeNull();
    // The rest is refused, so the passage stays open with its message.
    refuse.current = true;
    words.current = one("Before and after, and more");
    await leave(box);
    expect(screen.getByRole("status")).not.toBeNull();
    fireEvent.keyDown(box, { key: "Escape" });
    expect(cancel).toHaveBeenCalledWith(run);
    expect(screen.queryByRole("status")).toBeNull();
    expect(editor.passages.isOpen()).toBe(false);
  });
});
