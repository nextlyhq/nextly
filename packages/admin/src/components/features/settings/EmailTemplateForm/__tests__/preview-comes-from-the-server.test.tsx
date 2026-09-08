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

  /*
   * The transition, not the steady state. The rejection test above starts with
   * a failing request, so it never HAS a good render to lose and passes either
   * way — it cannot tell this regression from the intended behaviour. This one
   * renders successfully first and then fails, which is the only ordering in
   * which "the last good render survives" means anything.
   */
  it("keeps the last successful render visible when a later one fails", async () => {
    previewDraft.mockResolvedValueOnce({
      subject: "GOOD SUBJECT",
      html: "<p>GOOD HTML</p>",
      text: "GOOD TEXT",
    });

    const { result, rerender } = renderHook(
      ({ subject }: { subject: string }) =>
        useDerivedTemplateState({ ...INPUT, subject }),
      { wrapper, initialProps: { subject: INPUT.subject } }
    );

    await waitFor(() => {
      expect(result.current.previewHtml).toBe("<p>GOOD HTML</p>");
    });

    // A new key, whose render rejects.
    previewDraft.mockRejectedValue(new Error("Preview endpoint unreachable"));
    rerender({ subject: "Hi again {{userName}}" });

    await waitFor(() => {
      expect(result.current.previewError).toBe("Preview endpoint unreachable");
    });
    // The banner reports the failure; the frame still shows the last render
    // the author was reading rather than going blank underneath it.
    expect(result.current.previewHtml).toBe("<p>GOOD HTML</p>");
    expect(result.current.previewText).toBe("GOOD TEXT");
    expect(result.current.previewSubject).toBe("GOOD SUBJECT");
  });

  /*
   * The RECOVERY, not the steady state. The unparseable test below holds the
   * JSON broken throughout, so it never crosses back and cannot see this: the
   * decision to send and the payload were debounced separately, so correcting
   * the JSON flipped `enabled` at once while the body was still the 300ms-old
   * empty object — one render with every variable blank.
   */
  it("never renders with empty data after the sample JSON is corrected", async () => {
    previewDraft.mockResolvedValue({ subject: "", html: "", text: "" });

    const { rerender } = renderHook(
      ({ sampleOverride }: { sampleOverride: string }) =>
        useDerivedTemplateState({ ...INPUT, sampleOverride }),
      { wrapper, initialProps: { sampleOverride: "{ not json" } }
    );

    // Let the debounce settle on the unrenderable state.
    await new Promise(resolve => setTimeout(resolve, 450));
    expect(previewDraft).not.toHaveBeenCalled();

    rerender({ sampleOverride: JSON.stringify({ userName: "Priya" }) });

    await waitFor(() => {
      expect(previewDraft).toHaveBeenCalled();
    });
    // Every call carries the corrected data. A call with `{}` is the bug:
    // the author sees their variables render blank for a frame.
    for (const [, data] of previewDraft.mock.calls) {
      expect(data).toEqual({ userName: "Priya" });
    }
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
