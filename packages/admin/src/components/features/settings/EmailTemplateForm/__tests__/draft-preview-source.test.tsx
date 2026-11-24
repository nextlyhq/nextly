/**
 * The code a written draft's preview carries belongs to the blocks on screen:
 * the moment the blocks change, the code of the earlier ones is no longer
 * offered, and the code of the new ones arrives with their own render.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type { DraftPreviewTemplate } from "@admin/services/emailTemplateApi";

import { useDraftPreview, type DraftPreviewRequest } from "../useDraftPreview";

const api = vi.hoisted(() => ({ previewDraft: vi.fn() }));
vi.mock("@admin/services/emailTemplateApi", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/services/emailTemplateApi")
  >()),
  ...api,
}));

/** A written draft of one heading, whose code the mock names after it. */
function written(heading: string): NonNullable<DraftPreviewRequest> {
  const draft: DraftPreviewTemplate = {
    subject: "",
    htmlContent: "",
    plainTextContent: null,
    preheader: null,
    useLayout: false,
    kind: "template",
    layoutId: null,
    format: "written",
    blocks: {
      version: 1,
      blocks: [{ type: "heading", text: [{ type: "text", text: heading }] }],
    },
  };
  return { draft, data: {} };
}

describe("a written draft's code in its preview", () => {
  it("is never the code of blocks no longer on screen", async () => {
    api.previewDraft.mockImplementation(
      async (template: DraftPreviewTemplate) => {
        const block = template.blocks?.blocks[0];
        const heading =
          block?.type === "heading" && block.text[0]?.type === "text"
            ? block.text[0].text
            : "";
        return {
          subject: "",
          html: "",
          text: "",
          preheader: "",
          from: null,
          source: { html: `<h1>${heading}</h1>`, text: heading },
        };
      }
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result, rerender } = renderHook(
      ({ request }: { request: DraftPreviewRequest }) =>
        useDraftPreview(request),
      { wrapper, initialProps: { request: written("Saved") } }
    );
    await waitFor(() =>
      expect(result.current.previewSource).toBe("<h1>Saved</h1>")
    );

    // An edit: while its render is still to come, the saved blocks' code is
    // not offered as this draft's.
    rerender({ request: written("Edited") });
    expect(result.current.previewSource).toBeUndefined();
    await waitFor(() =>
      expect(result.current.previewSource).toBe("<h1>Edited</h1>")
    );

    // Undone back to the saved blocks: the edited code is not offered either.
    rerender({ request: written("Saved") });
    expect(result.current.previewSource).toBeUndefined();
    await waitFor(() =>
      expect(result.current.previewSource).toBe("<h1>Saved</h1>")
    );
  });
});
