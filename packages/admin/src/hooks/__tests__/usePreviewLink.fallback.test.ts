/**
 * What happens when the browser refuses the copy.
 *
 * The path that matters most and is hardest to reach by hand: an insecure
 * origin or a `clipboard-write` permissions policy rejects `writeText`, and the
 * link the editor asked for exists but never reached them. A minted preview
 * link is a live bearer credential, so the fallback has to make it usable
 * WITHOUT issuing another one.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { toast, mint } = vi.hoisted(() => ({
  toast: {
    success: vi.fn(),
    // Typed with its parameters: a bare `() => id` infers a zero-argument
    // signature, and reading `calls[0][1]` off it is a compile error.
    info: vi.fn((_message: string, _options?: unknown) => "toast-id"),
    error: vi.fn(),
    dismiss: vi.fn(),
  },
  mint: vi.fn(),
}));

vi.mock("@admin/components/ui", () => ({ toast }));
vi.mock("@admin/services/previewLinkApi", () => ({
  previewLinkApi: { mint: (...args: unknown[]) => mint(...args) },
}));

const { usePreviewLink } = await import("../usePreviewLink");

/** A token long enough to stand in for a real signed one. */
const TOKEN = "a".repeat(280);

function makeWrapper(): (props: { children: ReactNode }) => ReactElement {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return ({ children }) =>
    createElement(QueryClientProvider, { client }, children);
}

/** Runs the hook once with a clipboard that answers as told. */
async function mintWith(writeText: () => Promise<void>): Promise<void> {
  mint.mockResolvedValue({ token: TOKEN });
  vi.stubGlobal("navigator", { clipboard: { writeText } });

  const { result } = renderHook(
    () => usePreviewLink({ collection: "posts", entryId: "7" }),
    { wrapper: makeWrapper() }
  );

  result.current.mutate();
  await waitFor(() => expect(result.current.isSuccess).toBe(true));
}

/** Clicks the toast's Copy action, returning the event it was given. */
function clickCopy(): { preventDefault: ReturnType<typeof vi.fn> } {
  const options = toast.info.mock.calls[0]?.[1] as {
    action: { onClick: (event: { preventDefault: () => void }) => void };
  };
  const event = { preventDefault: vi.fn() };
  options.action.onClick(event);
  return event;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("usePreviewLink when the clipboard is refused", () => {
  it("keeps the link on screen instead of letting it time out", async () => {
    // Sonner dismisses after about four seconds by default, which is not long
    // enough to select a few hundred characters of signed token by hand, and it
    // leaves nothing behind when it goes.
    await mintWith(() => Promise.reject(new Error("insecure origin")));

    expect(toast.info).toHaveBeenCalledTimes(1);
    const options = toast.info.mock.calls[0]?.[1] as {
      description?: string;
      duration?: number;
      action?: { label: string; onClick: () => void };
    };

    expect(options.duration).toBe(Infinity);
    // The URL is the payload, so it has to be present in full and selectable
    // rather than interpolated into a headline that may be truncated.
    expect(options.description).toContain(TOKEN);
    expect(options.action?.label).toBe("Copy");
  });

  it("does not mint a second credential when the copy is retried", async () => {
    // Every mint issues another live bearer token. A retry that went back to
    // the server would leave a working link behind each failed copy.
    let attempts = 0;
    await mintWith(() => {
      attempts += 1;
      return attempts === 1
        ? Promise.reject(new Error("insecure origin"))
        : Promise.resolve();
    });

    expect(mint).toHaveBeenCalledTimes(1);

    clickCopy();

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it("keeps the link on screen when the retry fails too", async () => {
    // Sonner closes a toast when its action is clicked unless the event is
    // prevented, and the retry settles afterwards. Without that, a second
    // refusal would remove the only copy of the link and leave a bare error.
    await mintWith(() => Promise.reject(new Error("insecure origin")));

    const event = clickCopy();

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(event.preventDefault).toHaveBeenCalled();
    expect(toast.dismiss).not.toHaveBeenCalled();
  });

  it("closes the link toast once the clipboard really holds it", async () => {
    let attempts = 0;
    await mintWith(() => {
      attempts += 1;
      return attempts === 1
        ? Promise.reject(new Error("insecure origin"))
        : Promise.resolve();
    });

    clickCopy();

    await waitFor(() => expect(toast.dismiss).toHaveBeenCalledWith("toast-id"));
  });

  it("says so when the retry is refused as well", async () => {
    // Silence would read as success, and the editor would go looking for a link
    // that is not on their clipboard.
    await mintWith(() => Promise.reject(new Error("insecure origin")));

    clickCopy();

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("just reports success when the clipboard accepts", async () => {
    await mintWith(() => Promise.resolve());

    expect(toast.success).toHaveBeenCalledWith("Preview link copied.");
    expect(toast.info).not.toHaveBeenCalled();
  });
});
