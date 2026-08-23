/**
 * What the hook copies.
 *
 * It copies what the server returned, unchanged. The URL used to be assembled
 * here from a hardcoded route and a site URL read out of general settings —
 * neither of which the browser can know: the mount is a route file inside the
 * application, and `settings` is a system resource the `editor` and `author`
 * presets cannot read, which are exactly the roles that share preview links.
 *
 * These replace the `buildPreviewUrl` tests, which asserted that assembly.
 * There is no longer a URL built in the browser to test.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { toast, mint } = vi.hoisted(() => ({
  toast: {
    success: vi.fn(),
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

const TOKEN = "a".repeat(280);
const URL_FROM_SERVER = `https://site.example/next/preview?token=${TOKEN}`;

function makeWrapper(): (props: { children: ReactNode }) => ReactElement {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return ({ children }) =>
    createElement(QueryClientProvider, { client }, children);
}

async function run(): Promise<{ isError: boolean }> {
  const { result } = renderHook(
    () => usePreviewLink({ collection: "posts", entryId: "7" }),
    { wrapper: makeWrapper() }
  );

  result.current.mutate();
  await waitFor(() =>
    expect(result.current.isSuccess || result.current.isError).toBe(true)
  );
  return { isError: result.current.isError };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("usePreviewLink", () => {
  it("copies the url the server returned, unmodified", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    mint.mockResolvedValue({
      token: TOKEN,
      url: URL_FROM_SERVER,
      expiresAt: "2026-09-01T00:00:00.000Z",
    });

    await run();

    // Byte-identical. Any transformation here is the browser re-deciding
    // something the server already settled with information the browser lacks.
    expect(writeText).toHaveBeenCalledWith(URL_FROM_SERVER);
  });

  it("mints per click rather than reusing a cached link", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    mint.mockResolvedValue({
      token: TOKEN,
      url: URL_FROM_SERVER,
      expiresAt: "2026-09-01T00:00:00.000Z",
    });

    await run();

    expect(mint).toHaveBeenCalledWith({ collection: "posts", entryId: "7" });
  });

  // The server answers `null` when no site URL is configured, because it cannot
  // name a host. The admin must NOT put its own origin in front of the path:
  // the admin may be served from somewhere the site is not, and a link to the
  // wrong host looks like a working one.
  it("reports the missing site url instead of substituting its own origin", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    mint.mockResolvedValue({
      token: TOKEN,
      url: null,
      expiresAt: "2026-09-01T00:00:00.000Z",
    });

    const { isError } = await run();

    expect(isError).toBe(true);
    expect(writeText).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("site URL")
    );
  });
});
