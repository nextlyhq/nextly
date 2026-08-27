import { TooltipProvider } from "@nextlyhq/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import type { LexicalCommand, SerializedEditorState } from "lexical";
import type { RichTextFieldConfig } from "nextly/config";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { describe, it, expect, beforeAll, vi } from "vitest";

import { RichTextInput } from "./RichTextInput";
import { RICH_TEXT_NODES } from "./rich-text-kit";
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

// Lexical selection & toolbar DOM stub
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

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

type Dispatcher = (command: LexicalCommand<unknown>, payload: unknown) => void;

function CommandBridgePlugin({
  onReady,
}: {
  onReady: (dispatch: Dispatcher) => void;
}) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    onReady((cmd, payload) => {
      editor.dispatchCommand(cmd, payload);
    });
  }, [editor, onReady]);
  return null;
}

function Harness({
  initial,
  readOnly = false,
}: {
  initial: SerializedEditorState | null;
  readOnly?: boolean;
}) {
  const form = useForm<{ body: unknown }>({
    defaultValues: { body: initial },
  });
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RichTextInput
          name="body"
          field={FIELD}
          control={form.control}
          readOnly={readOnly}
        />
        <button onClick={() => form.reset({ body: doc("Cuerpo espanol") })}>
          switch-es
        </button>
        <button onClick={() => form.reset({ body: null })}>clear</button>
        <button
          onClick={() =>
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
    const user = userEvent.setup();
    render(<Harness initial={doc("English body")} />);
    await screen.findByText("English body");

    await user.click(screen.getByText("switch-es"));

    expect(await screen.findByText("Cuerpo espanol")).toBeInTheDocument();
    expect(screen.queryByText("English body")).not.toBeInTheDocument();
  });

  it("clears when the external value becomes empty", async () => {
    const user = userEvent.setup();
    render(<Harness initial={doc("English body")} />);
    await screen.findByText("English body");

    await user.click(screen.getByText("clear"));

    expect(screen.queryByText("English body")).not.toBeInTheDocument();
  });

  it("degrades to an empty document when the external value cannot be parsed", async () => {
    const user = userEvent.setup();
    render(<Harness initial={doc("English body")} />);
    await screen.findByText("English body");

    await user.click(screen.getByText("corrupt"));

    expect(screen.getByLabelText("body").textContent).toBe("");
    await user.click(screen.getByText("switch-es"));
    expect(await screen.findByText("Cuerpo espanol")).toBeInTheDocument();
  });
});

describe("RichTextInput — read-only", () => {
  it("offers the formatting toolbar while the field is editable", async () => {
    render(<Harness initial={doc("Body copy")} />);

    expect(
      await screen.findByRole("toolbar", { name: /text formatting/i })
    ).toBeInTheDocument();
  });

  it("renders no formatting toolbar when the field is read-only", async () => {
    render(<Harness initial={doc("Body copy")} readOnly />);

    expect(await screen.findByText("Body copy")).toBeInTheDocument();
    expect(
      screen.queryByRole("toolbar", { name: /text formatting/i })
    ).toBeNull();
  });
});

describe("RichTextInput — insert dialogs shell characterization", () => {
  function renderPluginHarness() {
    let dispatch: Dispatcher = () => {};
    const view = render(
      <TooltipProvider>
        <LexicalComposer
          initialConfig={{
            namespace: "DialogTestEditor",
            nodes: [...RICH_TEXT_NODES],
            onError: err => {
              console.error(err);
            },
          }}
        >
          <RichTextTablePlugin />
          <RichTextVideoPlugin />
          <RichTextButtonLinkPlugin />
          <RichTextButtonGroupPlugin />
          <CommandBridgePlugin
            onReady={d => {
              dispatch = d;
            }}
          />
        </LexicalComposer>
      </TooltipProvider>
    );

    return {
      ...view,
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
      const { openTable } = renderPluginHarness();

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
    });
  });

  describe("Video dialog", () => {
    it("opens, disables submit when empty, shows preview, and submits with Enter", async () => {
      const { openVideo } = renderPluginHarness();

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

      // Enter key submits
      fireEvent.keyDown(urlInput, { key: "Enter", code: "Enter" });
      expect(
        screen.queryByRole("heading", { name: "Embed Video" })
      ).not.toBeInTheDocument();
    });
  });

  describe("Button Link dialog", () => {
    it("opens, validates URL on submit, and submits with Enter", async () => {
      const { openButtonLink } = renderPluginHarness();

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

      // Valid URL + Enter key submits
      fireEvent.change(urlInput, { target: { value: "https://nextlyhq.com" } });
      fireEvent.keyDown(urlInput, { key: "Enter", code: "Enter" });
      expect(
        screen.queryByRole("heading", { name: "Insert Button Link" })
      ).not.toBeInTheDocument();
    });
  });

  describe("Button Group dialog", () => {
    it("opens, validates buttons, and submits on valid input", async () => {
      const { openButtonGroup } = renderPluginHarness();

      openButtonGroup();
      expect(
        await screen.findByRole("heading", { name: "Insert Button Group" })
      ).toBeInTheDocument();

      // Submitting empty -> validation error
      fireEvent.click(
        screen.getByRole("button", { name: /^insert button group$/i })
      );
      expect(
        await screen.findByText("Button 1: Please enter button text")
      ).toBeInTheDocument();

      // Cancel closes
      fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
      expect(
        screen.queryByRole("heading", { name: "Insert Button Group" })
      ).not.toBeInTheDocument();

      // Re-open and fill valid buttons
      openButtonGroup();
      const textInputs = await screen.findAllByPlaceholderText("Click here");
      const urlInputs = screen.getAllByPlaceholderText("https://example.com");

      fireEvent.change(textInputs[0], { target: { value: "Docs" } });
      fireEvent.change(urlInputs[0], { target: { value: "/docs" } });
      fireEvent.change(textInputs[1], { target: { value: "Blog" } });
      fireEvent.change(urlInputs[1], { target: { value: "/blog" } });

      fireEvent.click(
        screen.getByRole("button", { name: /^insert button group$/i })
      );
      expect(
        screen.queryByRole("heading", { name: "Insert Button Group" })
      ).not.toBeInTheDocument();
    });
  });
});
