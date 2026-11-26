import { TooltipProvider } from "@nextlyhq/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { TablePlugin } from "@lexical/react/LexicalTablePlugin";
import { TableNode } from "@lexical/table";
import { $isLinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isElementNode,
  $isTextNode,
  $nodesOfType,
  PASTE_COMMAND,
  type Klass,
  type LexicalCommand,
  type LexicalEditor,
  type LexicalNode,
  type SerializedEditorState,
} from "lexical";
import type { RichTextFieldConfig } from "nextly/config";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { describe, it, expect, beforeAll, vi } from "vitest";

import { RichTextInput } from "./RichTextInput";
import { RICH_TEXT_NODES } from "./rich-text-kit";
import { VideoNode } from "./VideoNode";
import { ButtonLinkNode } from "./ButtonLinkNode";
import { ButtonGroupNode } from "./ButtonGroupNode";
import {
  RichTextTablePlugin,
  OPEN_TABLE_DIALOG_COMMAND,
} from "./RichTextTablePlugin";
import {
  RichTextVideoPlugin,
  OPEN_VIDEO_DIALOG_COMMAND,
} from "./RichTextVideoPlugin";
import {
  RichTextButtonLinkPlugin,
  OPEN_BUTTON_LINK_DIALOG_COMMAND,
} from "./RichTextButtonLinkPlugin";
import {
  RichTextButtonGroupPlugin,
  OPEN_BUTTON_GROUP_DIALOG_COMMAND,
} from "./RichTextButtonGroupPlugin";

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

// Hand the mounted editor out to the test harness, so tests can dispatch each
// plugin's registered dialog command (the same command the toolbar trigger
// fires) and read the editor's node state to observe what a dialog inserted.
type Dispatcher = (command: LexicalCommand<unknown>, payload: unknown) => void;

function CommandBridgePlugin({
  onReady,
}: {
  onReady: (editor: LexicalEditor) => void;
}) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    onReady(editor);
  }, [editor, onReady]);
  return null;
}

/**
 * Form harness mirroring the entry/single editors: the editor is bound through RHF
 * `control`, and a locale switch arrives as `form.reset(...)` with another language's
 * value — the exact external-change path the editor must follow.
 */
function Harness({
  initial,
  readOnly = false,
  field = FIELD,
}: {
  initial: SerializedEditorState | null;
  readOnly?: boolean;
  field?: RichTextFieldConfig;
}) {
  const form = useForm<{ body: unknown }>({
    defaultValues: { body: initial },
  });
  // The editor's media plugins query the API and the toolbar renders inside
  // tooltips, so the harness supplies the same app-level providers the admin does.
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RichTextInput
          name="body"
          field={field}
          control={form.control}
          readOnly={readOnly}
        />
        <button onClick={() => form.reset({ body: doc("Cuerpo espanol") })}>
          switch-es
        </button>
        <button onClick={() => form.reset({ body: null })}>clear</button>
        <button
          onClick={() => {
            // A corrupted stored value: parseable JSON, but not a Lexical document.
            form.reset({ body: { root: { type: "bogus-node-type" } } });
          }}
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
    const user = userEvent.setup();
    render(<Harness initial={doc("English body")} />);
    await screen.findByText("English body");

    // A locale switch resets the form with the other language's fetched value; the
    // editor must display it instead of keeping the first-mounted language.
    await user.click(screen.getByText("switch-es"));

    expect(await screen.findByText("Cuerpo espanol")).toBeInTheDocument();
    expect(screen.queryByText("English body")).not.toBeInTheDocument();
  });

  it("clears when the external value becomes empty", async () => {
    const user = userEvent.setup();
    render(<Harness initial={doc("English body")} />);
    await screen.findByText("English body");

    // An untranslated language has no stored value — the editor must show empty,
    // not the previous language's content.
    await user.click(screen.getByText("clear"));

    expect(screen.queryByText("English body")).not.toBeInTheDocument();
  });

  it("degrades to an empty document when the external value cannot be parsed", async () => {
    const user = userEvent.setup();
    render(<Harness initial={doc("English body")} />);
    await screen.findByText("English body");

    // A corrupted or version-mismatched stored value must not crash the editor
    // tree, and must not leave the previous document on screen (a save from that
    // screen would write the previous language's content into this one).
    await user.click(screen.getByText("corrupt"));

    // The whole document is empty — not just missing the previous content, but
    // holding nothing else either (no partial or garbled render of the bad value).
    // The contentEditable carries the field name as its accessible label.
    expect(screen.getByLabelText("body").textContent).toBe("");
    // The editor is still alive: a follow-up valid value loads normally.
    await user.click(screen.getByText("switch-es"));
    expect(await screen.findByText("Cuerpo espanol")).toBeInTheDocument();
  });
});

/** The editor RichTextInput mounted on `element`, its editable root. */
function editorOn(element: HTMLElement): LexicalEditor {
  const editor = (element as HTMLElement & { __lexicalEditor?: LexicalEditor })
    .__lexicalEditor;
  if (editor === undefined) throw new Error("no editor is mounted here");
  return editor;
}

/** Replace the document with one paragraph of `text`, as typing would. */
function typeText(editor: LexicalEditor, text: string): void {
  editor.update(
    () => {
      const paragraph = $createParagraphNode();
      paragraph.append($createTextNode(text));
      $getRoot().clear().append(paragraph);
    },
    { discrete: true }
  );
}

/**
 * Run `command` and commit what it changed before returning: a command sent
 * on its own commits on a later tick.
 */
function dispatchNow<T>(
  editor: LexicalEditor,
  command: LexicalCommand<T>,
  payload: T
): void {
  editor.update(() => void editor.dispatchCommand(command, payload), {
    discrete: true,
  });
}

/** Select the whole of the document's first text. */
function selectAll(editor: LexicalEditor): void {
  editor.update(
    () => {
      const text = $getRoot().getFirstDescendant();
      if ($isTextNode(text)) text.select(0, text.getTextContentSize());
    },
    { discrete: true }
  );
}

/** Each link the document holds, by kind, address and text. */
function linksIn(
  editor: LexicalEditor
): { type: string; url: string; text: string }[] {
  return editor.getEditorState().read(() => {
    const found: { type: string; url: string; text: string }[] = [];
    const walk = (node: LexicalNode): void => {
      if ($isLinkNode(node)) {
        found.push({
          type: node.getType(),
          url: node.getURL(),
          text: node.getTextContent(),
        });
      }
      if ($isElementNode(node)) node.getChildren().forEach(walk);
    };
    walk($getRoot());
    return found;
  });
}

describe("RichTextInput — links made from addresses in the text", () => {
  it("links web and email addresses as they are typed, and stores them as links", async () => {
    render(<Harness initial={doc("")} />);
    const editor = editorOn(await screen.findByLabelText("body"));

    typeText(
      editor,
      "Meet at https://www.example.org/groups/open-source/ or www.example.com, mail me@example.com today"
    );

    expect(linksIn(editor)).toEqual([
      {
        type: "autolink",
        url: "https://www.example.org/groups/open-source/",
        text: "https://www.example.org/groups/open-source/",
      },
      {
        type: "autolink",
        url: "https://www.example.com",
        text: "www.example.com",
      },
      {
        type: "autolink",
        url: "mailto:me@example.com",
        text: "me@example.com",
      },
    ]);
    // What the form stores is the link node, which every renderer draws.
    const stored = JSON.stringify(editor.getEditorState().toJSON());
    expect(stored).toContain('"type":"autolink"');
  });

  it("makes no link by itself on a field whose toolbar leaves links out", async () => {
    render(
      <Harness
        initial={doc("")}
        field={{ ...FIELD, features: ["bold", "italic"] }}
      />
    );
    const editor = editorOn(await screen.findByLabelText("body"));

    typeText(
      editor,
      "Meet at https://www.example.org/groups/open-source/ today"
    );

    expect(linksIn(editor)).toEqual([]);
  });

  it("keeps an address the author unlinks as words, stored as the renderers read it", async () => {
    render(<Harness initial={doc("")} />);
    const editor = editorOn(await screen.findByLabelText("body"));
    typeText(editor, "see https://example.com/a today");

    // Select the linked address, then take the link off as the toolbar does.
    editor.update(
      () => {
        const link = $getRoot().getFirstDescendant()?.getNextSibling();
        const words = $isElementNode(link) ? link.getFirstChild() : null;
        if ($isTextNode(words)) words.select(0, words.getTextContentSize());
      },
      { discrete: true }
    );
    dispatchNow(editor, TOGGLE_LINK_COMMAND, null);

    // The node stays, marked unlinked, so typing does not link it again;
    // every renderer draws that as the words alone.
    const stored = JSON.stringify(editor.getEditorState().toJSON());
    expect(stored).toContain(
      '"type":"autolink","version":1,"rel":null,"target":null,"title":null,"url":"https://example.com/a","isUnlinked":true'
    );
  });

  it("leaves text that is not an address as text", async () => {
    render(<Harness initial={doc("")} />);
    const editor = editorOn(await screen.findByLabelText("body"));

    typeText(editor, "Version 1.2 ships soon, see javascript:alert(1) nowhere");

    expect(linksIn(editor)).toEqual([]);
  });

  it("links selected text to an address pasted over it", async () => {
    // jsdom has no ClipboardEvent; Lexical's paste handler knows the event
    // by its constructor's name, so a stand-in of that name carries the text.
    const Stub = {
      ClipboardEvent: class extends Event {
        constructor(
          readonly clipboardData: { getData: (type: string) => string }
        ) {
          super("paste");
        }
      },
    }.ClipboardEvent;
    vi.stubGlobal("ClipboardEvent", Stub);
    try {
      render(<Harness initial={doc("")} />);
      const editor = editorOn(await screen.findByLabelText("body"));
      typeText(editor, "Hack day");
      selectAll(editor);
      const url = "https://events.example.org/2026/builders-day";
      dispatchNow(
        editor,
        PASTE_COMMAND,
        // The stand-in has the one member the handler reads.
        new Stub({
          getData: type => (type === "text" ? url : ""),
        }) as unknown as ClipboardEvent
      );

      expect(linksIn(editor)).toEqual([
        { type: "link", url, text: "Hack day" },
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("refuses to link text to a script address", async () => {
    render(<Harness initial={doc("")} />);
    const editor = editorOn(await screen.findByLabelText("body"));
    typeText(editor, "Hack day");

    selectAll(editor);
    dispatchNow(editor, TOGGLE_LINK_COMMAND, "javascript:alert(1)");
    expect(linksIn(editor)).toEqual([]);

    // The control: the same command links a web address.
    selectAll(editor);
    dispatchNow(editor, TOGGLE_LINK_COMMAND, "https://example.com/");
    expect(linksIn(editor)).toEqual([
      { type: "link", url: "https://example.com/", text: "Hack day" },
    ]);
  });
});

describe("RichTextInput — read-only", () => {
  it("offers the formatting toolbar while the field is editable", async () => {
    render(<Harness initial={doc("Body copy")} />);

    // The control for the negative below: without this, an absent toolbar in
    // the read-only case would be satisfied by a harness that renders no
    // toolbar under any circumstances.
    expect(
      await screen.findByRole("toolbar", { name: /text formatting/i })
    ).toBeInTheDocument();
  });

  it("renders no formatting toolbar when the field is read-only", async () => {
    render(<Harness initial={doc("Body copy")} readOnly />);

    // The content still has to be there — an absent toolbar proves nothing if
    // the editor failed to mount at all.
    expect(await screen.findByText("Body copy")).toBeInTheDocument();
    expect(
      screen.queryByRole("toolbar", { name: /text formatting/i })
    ).toBeNull();
  });
});

describe("RichTextInput — insert dialogs shell characterization", () => {
  // The harness renders a real Lexical composer and opens each dialog by
  // dispatching its OPEN_* command — the same command the toolbar trigger
  // fires — so the dialogs themselves are exercised without coupling the
  // tests to toolbar layout or its icon buttons.
  function renderPluginHarness() {
    let dispatch: Dispatcher = () => {};
    let editorRef: LexicalEditor | null = null;
    const view = render(
      <TooltipProvider>
        <LexicalComposer
          initialConfig={{
            namespace: "DialogTestEditor",
            nodes: [...RICH_TEXT_NODES],
            onError: err => {
              // Re-throw: returning normally would let Lexical attempt
              // recovery, so an editor error would never fail the test.
              throw err;
            },
          }}
        >
          {/* Handles INSERT_TABLE_COMMAND the way the real editor does, so
              the dialog's submit actually inserts a table into the composer.
              The editable gives the insert a selection to anchor to. */}
          <TablePlugin />
          <ContentEditable />
          <RichTextTablePlugin />
          <RichTextVideoPlugin />
          <RichTextButtonLinkPlugin />
          <RichTextButtonGroupPlugin />
          <CommandBridgePlugin
            onReady={editor => {
              editorRef = editor;
              // jsdom fires no real selection events, so seed one in editor
              // state — a table insert needs a selection to anchor to.
              editor.update(() => {
                $getRoot().selectEnd();
              });
              dispatch = (cmd, payload) => editor.dispatchCommand(cmd, payload);
            }}
          />
        </LexicalComposer>
      </TooltipProvider>
    );

    // Reading node state through the editor (rather than the DOM) keeps the
    // assertion about what the dialog INSERTED, independent of any renderer.
    const nodeCount = (nodeType: Klass<LexicalNode>): number =>
      editorRef?.getEditorState().read(() => $nodesOfType(nodeType).length) ??
      0;

    return {
      ...view,
      nodeCount,
      openTable: () => dispatch(OPEN_TABLE_DIALOG_COMMAND, undefined),
      openVideo: () => dispatch(OPEN_VIDEO_DIALOG_COMMAND, undefined),
      openButtonLink: () =>
        dispatch(OPEN_BUTTON_LINK_DIALOG_COMMAND, undefined),
      openButtonGroup: () =>
        dispatch(OPEN_BUTTON_GROUP_DIALOG_COMMAND, undefined),
    };
  }

  describe("Table dialog", () => {
    it("opens, resets on cancel, reports validation error, and submits with Enter", async () => {
      const { openTable, nodeCount } = renderPluginHarness();

      // Give the insert a selection to anchor to, as a user clicking into the
      // field would; without it a table insert has nowhere to land.
      fireEvent.focus(screen.getByRole("textbox"));

      openTable();
      expect(
        await screen.findByRole("heading", { name: "Insert Table" })
      ).toBeInTheDocument();
      const rowsInput = screen.getByLabelText(/^rows/i);
      const colsInput = screen.getByLabelText(/^columns/i);
      expect(rowsInput).toHaveValue(3);
      expect(colsInput).toHaveValue(3);

      // Cancel closes and resets
      fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
      expect(
        screen.queryByRole("heading", { name: "Insert Table" })
      ).not.toBeInTheDocument();

      // Re-open: invalid row count -> validation error
      openTable();
      const rowsInput2 = await screen.findByLabelText(/^rows/i);
      fireEvent.change(rowsInput2, { target: { value: "0" } });
      fireEvent.click(screen.getByRole("button", { name: /^insert table$/i }));
      expect(
        await screen.findByText("Rows must be between 1 and 20")
      ).toBeInTheDocument();

      // Valid value + Enter key submits
      fireEvent.change(rowsInput2, { target: { value: "4" } });
      fireEvent.keyDown(rowsInput2, { key: "Enter", code: "Enter" });
      expect(
        screen.queryByRole("heading", { name: "Insert Table" })
      ).not.toBeInTheDocument();
      // The dialog closing is not enough: Enter must have INSERTED the table
      // into the editor, which a close-only submit would silently skip.
      await vi.waitFor(() => expect(nodeCount(TableNode)).toBe(1));
    });
  });

  describe("Video dialog", () => {
    it("opens, disables submit when empty, shows preview, and submits with Enter", async () => {
      const { openVideo, nodeCount } = renderPluginHarness();

      openVideo();
      expect(
        await screen.findByRole("heading", { name: "Embed Video" })
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /^embed video$/i })
      ).toBeDisabled();

      // Cancel closes
      fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
      expect(
        screen.queryByRole("heading", { name: "Embed Video" })
      ).not.toBeInTheDocument();

      // Re-open and fill YouTube URL
      openVideo();
      const urlInput = await screen.findByLabelText(/video url/i);
      fireEvent.change(urlInput, {
        target: { value: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" },
      });

      expect(await screen.findByText(/video detected/i)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /^embed video$/i })
      ).toBeEnabled();

      // Enter key submits — and must INSERT the video node, not merely close
      fireEvent.keyDown(urlInput, { key: "Enter", code: "Enter" });
      expect(
        screen.queryByRole("heading", { name: "Embed Video" })
      ).not.toBeInTheDocument();
      await vi.waitFor(() => expect(nodeCount(VideoNode)).toBe(1));
    });
  });

  describe("Button Link dialog", () => {
    it("opens, validates URL on submit, and submits with Enter", async () => {
      const { openButtonLink, nodeCount } = renderPluginHarness();

      openButtonLink();
      expect(
        await screen.findByRole("heading", { name: "Insert Button Link" })
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /^insert button$/i })
      ).toBeDisabled();

      const textInput = screen.getByLabelText(/^button text/i);
      const urlInput = screen.getByLabelText(/^url/i);

      // Invalid URL error on submit
      fireEvent.change(textInput, { target: { value: "Documentation" } });
      fireEvent.change(urlInput, { target: { value: "javascript:alert(1)" } });
      expect(
        screen.getByRole("button", { name: /^insert button$/i })
      ).toBeEnabled();

      fireEvent.click(screen.getByRole("button", { name: /^insert button$/i }));
      expect(
        await screen.findByText("Please enter a valid URL")
      ).toBeInTheDocument();

      // Valid URL + Enter key submits — and must INSERT the button node
      fireEvent.change(urlInput, { target: { value: "https://nextlyhq.com" } });
      fireEvent.keyDown(urlInput, { key: "Enter", code: "Enter" });
      expect(
        screen.queryByRole("heading", { name: "Insert Button Link" })
      ).not.toBeInTheDocument();
      await vi.waitFor(() => expect(nodeCount(ButtonLinkNode)).toBe(1));
    });

    it("names each colour's picker and its hex value field", async () => {
      const { openButtonLink } = renderPluginHarness();

      openButtonLink();
      await screen.findByRole("heading", { name: "Insert Button Link" });

      // The picker takes the visible label; the typed value beside it has a
      // name of its own rather than its placeholder.
      for (const colour of ["Background Color", "Text Color"]) {
        expect(screen.getByLabelText(colour)).toHaveAttribute("type", "color");
        expect(
          screen.getByRole("textbox", { name: `${colour} hex value` })
        ).toBeInTheDocument();
      }
    });
  });

  describe("Button Group dialog", () => {
    it("gates confirm on filled buttons, validates URLs, and submits with Enter", async () => {
      const { openButtonGroup, nodeCount } = renderPluginHarness();

      openButtonGroup();
      expect(
        await screen.findByRole("heading", { name: "Insert Button Group" })
      ).toBeInTheDocument();

      // Confirm is disabled while any button is missing text or a URL
      expect(
        screen.getByRole("button", { name: /^insert button group$/i })
      ).toBeDisabled();

      // Non-empty but invalid URL leaves confirm enabled so the error
      // banner stays reachable, mirroring the button-link dialog
      const textInputs = await screen.findAllByPlaceholderText("Click here");
      const urlInputs = screen.getAllByPlaceholderText("https://example.com");
      fireEvent.change(textInputs[0], { target: { value: "Docs" } });
      fireEvent.change(urlInputs[0], {
        target: { value: "javascript:alert(1)" },
      });
      fireEvent.change(textInputs[1], { target: { value: "Blog" } });
      fireEvent.change(urlInputs[1], { target: { value: "/blog" } });
      expect(
        screen.getByRole("button", { name: /^insert button group$/i })
      ).toBeEnabled();

      fireEvent.click(
        screen.getByRole("button", { name: /^insert button group$/i })
      );
      expect(
        await screen.findByText("Button 1: Please enter a valid URL")
      ).toBeInTheDocument();

      // Cancel closes and resets
      fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
      expect(
        screen.queryByRole("heading", { name: "Insert Button Group" })
      ).not.toBeInTheDocument();

      // Re-open, fill valid buttons, and submit with Enter from a text
      // input — the parity behavior the shared shell gives this dialog
      openButtonGroup();
      const textInputs2 = await screen.findAllByPlaceholderText("Click here");
      const urlInputs2 = screen.getAllByPlaceholderText("https://example.com");
      fireEvent.change(textInputs2[0], { target: { value: "Docs" } });
      fireEvent.change(urlInputs2[0], { target: { value: "/docs" } });
      fireEvent.change(textInputs2[1], { target: { value: "Blog" } });
      fireEvent.change(urlInputs2[1], { target: { value: "/blog" } });

      fireEvent.keyDown(urlInputs2[1], { key: "Enter", code: "Enter" });
      expect(
        screen.queryByRole("heading", { name: "Insert Button Group" })
      ).not.toBeInTheDocument();
      // Enter must have INSERTED the button group node, not merely closed
      await vi.waitFor(() => expect(nodeCount(ButtonGroupNode)).toBe(1));
    });
  });
});
