// @vitest-environment jsdom
/**
 * A picked form on the editor's canvas: drawn by the Form block from the
 * provider's description, read as the author through the editor's route,
 * as a visitor will see it once published: a draft and a published form
 * alike; a closed one as its closed message, a deleted one as the empty box
 * the editor's notice sits on. Nothing is sent from there.
 */
import {
  DOCUMENT_FORMAT_VERSION,
  type AnyBlockDefinition,
} from "@nextlyhq/blocks-engine";
import {
  createBlockResolver,
  createStandaloneContext,
  PageRenderer,
} from "@nextlyhq/blocks-react";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import { renderToReadableStream } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const read = vi.hoisted(() => vi.fn());
vi.mock("@nextlyhq/plugin-sdk/admin", () => ({ readPluginRoute: read }));

import { forgetEditorForms } from "../editor-forms-client";

import { canvasForms } from "./canvas-forms";

const blocks = createBlockResolver(coreBlocks as AnyBlockDefinition[]);

const QUOTE = {
  ref: "7",
  title: "Request a quote",
  fields: [
    { name: "email", label: "Your email", kind: "email", required: true },
  ],
  submitText: "Ask for a quote",
  afterSending: { kind: "message", message: "Thanks" },
  encoding: "urlencoded",
};

async function html(element: React.ReactElement): Promise<string> {
  const stream = await renderToReadableStream(element);
  await stream.allReady;
  return new Response(stream).text();
}

/** The canvas drawing one Form picking form 7, as the route answers `answer`. */
async function canvasWith(answer: unknown): Promise<string> {
  read.mockResolvedValue(answer);
  return html(
    <PageRenderer
      document={{
        formatVersion: DOCUMENT_FORMAT_VERSION,
        kind: "page",
        nodes: [
          {
            id: "f",
            type: "core/form",
            version: 2,
            props: { form: { provider: "forms", ref: "7" } },
          },
        ],
      }}
      blocks={blocks}
      context={createStandaloneContext({
        diagnostics: true,
        forms: canvasForms("en", "u1"),
      })}
    />
  );
}

beforeEach(() => {
  read.mockReset();
  forgetEditorForms();
});

describe("a picked form on the canvas", () => {
  it("draws a published form as a visitor will see it, read as the author", async () => {
    const out = await canvasWith({ state: "published", drawing: QUOTE });
    expect(out).toContain("Your email");
    expect(out).toContain("Ask for a quote");
    expect(read).toHaveBeenCalledWith({
      plugin: "@nextlyhq/plugin-page-builder",
      path: "/forms/editor/describe?provider=forms&ref=7&locale=en",
    });
  });

  it("draws a draft the same way, which only its author can read", async () => {
    const out = await canvasWith({ state: "draft", drawing: QUOTE });
    expect(out).toContain("Your email");
    expect(out).toContain("Ask for a quote");
  });

  it("names no document, so nothing is sent from the canvas", async () => {
    const out = await canvasWith({ state: "published", drawing: QUOTE });
    expect(out).not.toContain('name="_form"');
  });

  it("draws a closed form's message, and a deleted form's empty box", async () => {
    expect(
      await canvasWith({ state: "closed", message: "Entries are closed." })
    ).toContain("Entries are closed.");
    forgetEditorForms();
    expect(await canvasWith({ state: "missing" })).toContain(
      'data-nx-form-unavailable="missing"'
    );
  });
});
