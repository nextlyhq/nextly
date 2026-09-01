/**
 * The preview must be the SERVER's render, never the browser's.
 *
 * A client-side copy of the interpolation lived in this hook and had drifted
 * from the send path on the preheader and on the derived text part. Deleting it
 * is only half the guarantee: the half that survives refactoring is a test that
 * fails the moment anything renders `{{...}}` locally again.
 *
 * The discriminator is deliberate. Sample data BINDS the variable, so a
 * client-side render would produce the bound value and a server-sourced one
 * produces whatever the endpoint returned. Asserting the endpoint's marker —
 * and asserting the locally-bound value is ABSENT — separates the two sources,
 * which an assertion on either alone cannot do.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useDerivedTemplateState } from "../useDerivedTemplateState";

const previewDraft = vi.hoisted(() => vi.fn());

vi.mock("@admin/services/emailTemplateApi", async importOriginal => {
  const actual =
    await importOriginal<typeof import("@admin/services/emailTemplateApi")>();
  return { ...actual, previewDraft };
});

afterEach(() => {
  previewDraft.mockReset();
});

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

/** The authored fields, with one variable the sample data binds. */
const INPUT = {
  variables: [{ name: "userName", description: "", required: false }],
  sampleOverride: JSON.stringify({ userName: "Priya" }),
  subject: "Hi {{userName}}",
  htmlContent: "<p>Hello {{userName}}</p>",
  plainTextContent: "",
  preheader: "The line under the subject",
  useLayout: false,
  layoutId: undefined,
  kind: "template" as const,
};

describe("the editor previews what the server renders", () => {
  it("shows the server's html, not a locally interpolated copy", async () => {
    previewDraft.mockResolvedValue({
      subject: "SERVER SUBJECT",
      html: "<p>SERVER HTML</p>",
      text: "SERVER TEXT",
    });

    const { result } = renderHook(() => useDerivedTemplateState(INPUT), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.previewHtml).toBe("<p>SERVER HTML</p>");
    });
    expect(result.current.previewSubject).toBe("SERVER SUBJECT");
    // The bound value would be the fingerprint of a browser-side render.
    expect(result.current.previewHtml).not.toContain("Priya");
    expect(result.current.previewSubject).not.toContain("Priya");
  });

  it("sends the preheader, which the deleted client render never had", async () => {
    previewDraft.mockResolvedValue({ subject: "", html: "", text: "" });

    renderHook(() => useDerivedTemplateState(INPUT), { wrapper });

    await waitFor(() => {
      expect(previewDraft).toHaveBeenCalled();
    });
    const [template] = previewDraft.mock.calls[0] as [
      { preheader: string | null },
    ];
    expect(template.preheader).toBe("The line under the subject");
  });

  it("reports a refused render instead of showing a stale one as current", async () => {
    previewDraft.mockRejectedValue(new Error("Preview endpoint unreachable"));

    const { result } = renderHook(() => useDerivedTemplateState(INPUT), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.previewError).toBe("Preview endpoint unreachable");
    });
  });

  it("does not render at all while the sample data is unparseable", async () => {
    previewDraft.mockResolvedValue({ subject: "", html: "", text: "" });

    renderHook(
      () => useDerivedTemplateState({ ...INPUT, sampleOverride: "{ not json" }),
      { wrapper }
    );

    // The error is surfaced by `sampleError`; sending `{}` would preview
    // against values the author cannot see.
    await new Promise(resolve => setTimeout(resolve, 450));
    expect(previewDraft).not.toHaveBeenCalled();
  });
});
