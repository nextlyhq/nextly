/**
 * How "Copy diagnostics" writes the report: through a clipboard item started
 * at the click where the browser takes one, else as text once it arrives; a
 * write refused, unavailable or left unanswered is "refused"; and a report
 * that could not be built is an error, with nothing written.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@admin/lib/api/protectedApi", () => ({
  protectedApi: { get },
}));

import {
  CLIPBOARD_WAIT_MS,
  copyReport,
  DIAGNOSTICS_PATH,
  fetchDiagnosticsReport,
} from "./copy-diagnostics";

/** A blob's text, read as jsdom's blobs can be. */
function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

const REPORT = "Nextly diagnostics, 2026-11-10 17:20 UTC\nNextly: 0.0.2";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  get.mockReset();
});

describe("fetchDiagnosticsReport", () => {
  it("reads the report the server built", async () => {
    get.mockResolvedValue({ report: REPORT });
    await expect(fetchDiagnosticsReport()).resolves.toBe(REPORT);
    expect(get).toHaveBeenCalledWith(DIAGNOSTICS_PATH);
  });

  it("fails on an answer with no report", async () => {
    get.mockResolvedValue({ items: [] });
    await expect(fetchDiagnosticsReport()).rejects.toThrow();
  });
});

describe("copyReport", () => {
  it("writes the text once it arrives where only text can be written", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    await expect(
      copyReport(Promise.resolve(REPORT), { writeText })
    ).resolves.toBe("copied");
    expect(writeText).toHaveBeenCalledWith(REPORT);
  });

  it("starts a clipboard item at once, before the text arrives, where the browser takes one", async () => {
    class FakeItem {
      constructor(readonly items: Record<string, Promise<Blob>>) {}
    }
    vi.stubGlobal("ClipboardItem", FakeItem);
    const write = vi.fn((items: FakeItem[]) =>
      items[0].items["text/plain"].then(() => undefined)
    );
    const writeText = vi.fn(() => Promise.resolve());
    let arrive: (text: string) => void = () => undefined;
    const text = new Promise<string>(resolve => {
      arrive = resolve;
    });
    const copied = copyReport(text, {
      write: write as unknown as (items: ClipboardItem[]) => Promise<void>,
      writeText,
    });
    // Within the click: Safari takes a write only there.
    expect(write).toHaveBeenCalledTimes(1);
    arrive(REPORT);
    await expect(copied).resolves.toBe("copied");
    const blob = await (write.mock.calls[0][0][0] as FakeItem).items[
      "text/plain"
    ];
    expect(blob.type).toBe("text/plain");
    expect(await readBlob(blob)).toBe(REPORT);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("is refused when the clipboard says no", async () => {
    const writeText = vi.fn(() => Promise.reject(new Error("NotAllowed")));
    await expect(
      copyReport(Promise.resolve(REPORT), { writeText })
    ).resolves.toBe("refused");
  });

  it("is refused where there is no clipboard", async () => {
    await expect(copyReport(Promise.resolve(REPORT), undefined)).resolves.toBe(
      "refused"
    );
    await expect(copyReport(Promise.resolve(REPORT), {})).resolves.toBe(
      "refused"
    );
  });

  it("is refused when the clipboard does not answer in time", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn(() => new Promise<void>(() => undefined));
    const copied = copyReport(Promise.resolve(REPORT), { writeText });
    await vi.advanceTimersByTimeAsync(CLIPBOARD_WAIT_MS - 1);
    let settled = false;
    void copied.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(copied).resolves.toBe("refused");
  });

  it("fails, writing nothing, when the report could not be built", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    await expect(
      copyReport(Promise.reject(new Error("403")), { writeText })
    ).rejects.toThrow("403");
    expect(writeText).not.toHaveBeenCalled();
  });
});
