import { TooltipProvider } from "@nextlyhq/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SerializedEditorState } from "lexical";
import type { RichTextFieldConfig } from "nextly/config";
import { useForm } from "react-hook-form";
import { describe, it, expect, beforeAll, vi } from "vitest";

import { RichTextInput } from "./RichTextInput";

// Lexical's selection and toolbar code touch DOM APIs jsdom does not
// implement — stub them so the editor can mount and re-render.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  window.matchMedia =
    window.matchMedia ??
    (vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }) as unknown as typeof window.matchMedia);
});

const FIELD = {
  type: "richText",
  name: "body",
} as unknown as RichTextFieldConfig;

/** A minimal serialized Lexical document holding one paragraph of plain text. */
function doc(text: string): SerializedEditorState {
  return {
    root: {
      children: [
        {
          children: [
            {
              detail: 0,
              format: 0,
              mode: "normal",
              style: "",
              text,
              type: "text",
              version: 1,
            },
          ],
          direction: "ltr",
          format: "",
          indent: 0,
          type: "paragraph",
          version: 1,
        },
      ],
      direction: "ltr",
      format: "",
      indent: 0,
      type: "root",
      version: 1,
    },
  } as unknown as SerializedEditorState;
}

// Never retries in tests, so a plugin's failed background query cannot hang a run.
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

/**
 * Form harness mirroring the entry/single editors: the editor is bound through RHF
 * `control`, and a locale switch arrives as `form.reset(...)` with another language's
 * value — the exact external-change path the editor must follow.
 */
function Harness({ initial }: { initial: SerializedEditorState | null }) {
  const form = useForm<{ body: unknown }>({
    defaultValues: { body: initial },
  });
  return (
    // The editor's media plugins query the API and the toolbar renders inside
    // tooltips, so the harness supplies the same app-level providers the admin does.
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RichTextInput name="body" field={FIELD} control={form.control} />
        <button onClick={() => form.reset({ body: doc("Cuerpo espanol") })}>
          switch-es
        </button>
        <button onClick={() => form.reset({ body: null })}>clear</button>
        <button
          onClick={() =>
            // A corrupted stored value: parseable JSON, but not a Lexical document.
            form.reset({ body: { root: { type: "bogus-node-type" } } })
          }
        >
          corrupt
        </button>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

describe("RichTextInput — external value sync", () => {
  it("renders the value present at mount", async () => {
    render(<Harness initial={doc("English body")} />);
    expect(await screen.findByText("English body")).toBeInTheDocument();
  });

  it("follows an external form reset to another language's content", async () => {
    render(<Harness initial={doc("English body")} />);
    await screen.findByText("English body");

    // A locale switch resets the form with the other language's fetched value; the
    // editor must display it instead of keeping the first-mounted language.
    await userEvent.click(screen.getByText("switch-es"));

    expect(await screen.findByText("Cuerpo espanol")).toBeInTheDocument();
    expect(screen.queryByText("English body")).not.toBeInTheDocument();
  });

  it("clears when the external value becomes empty", async () => {
    render(<Harness initial={doc("English body")} />);
    await screen.findByText("English body");

    // An untranslated language has no stored value — the editor must show empty,
    // not the previous language's content.
    await userEvent.click(screen.getByText("clear"));

    expect(screen.queryByText("English body")).not.toBeInTheDocument();
  });

  it("degrades to an empty document when the external value cannot be parsed", async () => {
    render(<Harness initial={doc("English body")} />);
    await screen.findByText("English body");

    // A corrupted or version-mismatched stored value must not crash the editor
    // tree, and must not leave the previous document on screen (a save from that
    // screen would write the previous language's content into this one).
    await userEvent.click(screen.getByText("corrupt"));

    expect(screen.queryByText("English body")).not.toBeInTheDocument();
    // The editor is still alive: a follow-up valid value loads normally.
    await userEvent.click(screen.getByText("switch-es"));
    expect(await screen.findByText("Cuerpo espanol")).toBeInTheDocument();
  });
});
