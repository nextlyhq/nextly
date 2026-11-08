// @vitest-environment jsdom

/**
 * When the editor's meter counts a page, and what it says when it cannot.
 *
 * The count is made a moment after the page last changed. Two ways it could
 * never land are held here: a count that fails, which must be said with a
 * way to count again rather than left "Counting reads"; and an editor that
 * renders more often than the moment, which must not put the count off. A
 * count that never answers is a failed one too, once it has had its while. The
 * form's identity is a new object on every call, as the admin's own hook
 * answers it, so a render of the editor reaches the meter as new inputs.
 *
 * @module page-read-meter.counting.test
 */
import { DOCUMENT_FORMAT_VERSION } from "@nextlyhq/blocks-engine";
import type { CountedDrawing, PageReadReport } from "@nextlyhq/blocks-react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const countWithStages = vi.hoisted(() => vi.fn());

/**
 * The off-screen draws begun, each with the signal it was handed and how it
 * ended: a draw that is held until its signal aborts, as React's is while a
 * block on the page has not settled.
 */
const draws = vi.hoisted(
  () => [] as { signal: AbortSignal | undefined; ended: string }[]
);

vi.mock("react-dom/server", () => ({
  renderToReadableStream: (
    _element: unknown,
    options: { signal?: AbortSignal }
  ) => {
    const draw = { signal: options.signal, ended: "drawing" };
    draws.push(draw);
    const allReady = new Promise<void>((_resolve, reject) => {
      options.signal?.addEventListener(
        "abort",
        () => {
          draw.ended = "aborted";
          reject(options.signal?.reason);
        },
        { once: true }
      );
    });
    return Promise.resolve({ allReady, cancel: () => Promise.resolve() });
  },
}));

vi.mock("@nextlyhq/blocks-react", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  countPageReads: countWithStages,
}));

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  // A new object on every call, as the admin's own hook answers.
  useDocumentIdentity: () => ({
    kind: "collection",
    slug: "pages",
    documentId: "p1",
  }),
  useCurrentUserId: () => "u1",
}));

import { PageReadMeter } from "./page-read-meter";

const counted: PageReadReport = {
  cap: 500,
  used: 3,
  refused: 0,
  byKind: { entries: 3 },
  unread: [],
};

const document = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page" as const,
  nodes: [],
};

const editor = { document, select: () => undefined };

const drawnWith = {
  styleContext: { breakpoints: { viewport: [], container: [] } },
  definitions: new Map(),
} as unknown as CountedDrawing;

const NO_REGIONS: [] = [];

function meter(): HTMLElement {
  return screen.getByRole("button");
}

/** Let a settled count's answer reach the meter. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

/** Move the clock on, letting each timer's count answer as it goes. */
async function wait(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  countWithStages.mockReset();
  draws.length = 0;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("a count that could not be made", () => {
  it("is said, with a way to count again, and Retry counts again", async () => {
    countWithStages
      .mockRejectedValueOnce(new Error("bindings route unavailable"))
      .mockResolvedValueOnce(counted);
    render(
      <PageReadMeter
        editor={editor}
        drawnWith={drawnWith}
        regions={NO_REGIONS}
      />
    );
    expect(meter().getAttribute("aria-label")).toBe("Counting page reads");
    await wait(600);
    await settle();
    expect(countWithStages).toHaveBeenCalledTimes(1);
    // Said, in the meter's place, its name and its tooltip the same words.
    expect(meter().getAttribute("aria-label")).toBe(
      "Couldn't count page reads. Retry"
    );
    expect(meter().getAttribute("title")).toBe(
      "Couldn't count page reads. Retry"
    );
    expect(meter().getAttribute("data-standing")).toBe("failed");
    // It stays said: no count is made again on its own.
    await wait(5000);
    expect(countWithStages).toHaveBeenCalledTimes(1);
    expect(meter().getAttribute("data-standing")).toBe("failed");

    fireEvent.click(meter());
    expect(meter().getAttribute("aria-label")).toBe("Counting page reads");
    // At once, not after the moment the page is given to settle.
    await wait(0);
    await settle();
    expect(countWithStages).toHaveBeenCalledTimes(2);
    expect(meter().getAttribute("aria-label")).toBe("3 of 500 reads");
  });
});

describe("a count that never answers", () => {
  it("is said as one that could not be made, once it has had its while", async () => {
    countWithStages
      .mockReturnValueOnce(new Promise<never>(() => undefined))
      .mockResolvedValueOnce(counted);
    render(
      <PageReadMeter
        editor={editor}
        drawnWith={drawnWith}
        regions={NO_REGIONS}
      />
    );
    await wait(600);
    expect(countWithStages).toHaveBeenCalledTimes(1);
    // Still counting well into its while: a slow count is not a failed one.
    await wait(15_000);
    expect(meter().getAttribute("aria-label")).toBe("Counting page reads");
    await wait(5_000);
    expect(meter().getAttribute("aria-label")).toBe(
      "Couldn't count page reads. Retry"
    );
    fireEvent.click(meter());
    await wait(0);
    await settle();
    expect(meter().getAttribute("aria-label")).toBe("3 of 500 reads");
  });
});

describe("an editor that renders more often than the count waits", () => {
  it("has its page counted within the wait, the form's identity new each render", async () => {
    countWithStages.mockResolvedValue(counted);
    const view = render(
      <PageReadMeter
        editor={editor}
        drawnWith={drawnWith}
        regions={NO_REGIONS}
      />
    );
    // Rendered again every 200 ms, the page itself unchanged.
    for (let step = 0; step < 3; step += 1) {
      await wait(200);
      view.rerender(
        <PageReadMeter
          editor={editor}
          drawnWith={drawnWith}
          regions={NO_REGIONS}
        />
      );
    }
    await settle();
    // 600 ms after the page was drawn, once.
    expect(countWithStages).toHaveBeenCalledTimes(1);
    expect(meter().getAttribute("aria-label")).toBe("3 of 500 reads");
  });

  it("has its page counted within three seconds when its inputs are new each render", async () => {
    countWithStages.mockResolvedValue(counted);
    const fresh = () => ({ ...drawnWith }) as CountedDrawing;
    const view = render(
      <PageReadMeter editor={editor} drawnWith={fresh()} regions={NO_REGIONS} />
    );
    // What the canvas draws with, a new object every 200 ms: each a change
    // the count waits on, never 600 ms apart.
    for (let step = 0; step < 15; step += 1) {
      await wait(200);
      view.rerender(
        <PageReadMeter
          editor={editor}
          drawnWith={fresh()}
          regions={NO_REGIONS}
        />
      );
    }
    await settle();
    expect(countWithStages).toHaveBeenCalled();
    expect(meter().getAttribute("aria-label")).toBe("3 of 500 reads");
  });
});

describe("a page changing all the while its counts are slow", () => {
  /**
   * Render the meter, and a way to give it a new `drawnWith` every 100 ms
   * for `ms`.
   */
  function changingMeter(): (ms: number) => Promise<void> {
    const fresh = () => ({ ...drawnWith }) as CountedDrawing;
    const view = render(
      <PageReadMeter editor={editor} drawnWith={fresh()} regions={NO_REGIONS} />
    );
    return async ms => {
      for (let elapsed = 0; elapsed < ms; elapsed += 100) {
        await wait(100);
        view.rerender(
          <PageReadMeter
            editor={editor}
            drawnWith={fresh()}
            regions={NO_REGIONS}
          />
        );
      }
    };
  }

  it("makes one count at a time, and shows the first that answers", async () => {
    let making = 0;
    let most = 0;
    countWithStages.mockImplementation(
      () =>
        new Promise<PageReadReport>(resolve => {
          making += 1;
          most = Math.max(most, making);
          // Each count takes five seconds.
          setTimeout(() => {
            making -= 1;
            resolve(counted);
          }, 5000);
        })
    );
    const changeFor = changingMeter();
    await changeFor(8000);
    // Started at three seconds, the cap on the wait, it answers at eight.
    expect(meter().getAttribute("aria-label")).toBe("3 of 500 reads");
    await changeFor(12_000);
    expect(most).toBe(1);
    // One count, then one after each answer for the changes made meanwhile.
    expect(countWithStages.mock.calls.length).toBeLessThanOrEqual(6);
  });

  it("says the count could not be made within twenty seconds of the first change, when none answers", async () => {
    countWithStages.mockImplementation(
      () => new Promise<PageReadReport>(() => undefined)
    );
    await changingMeter()(19_900);
    // One count, waited on rather than started over.
    expect(countWithStages).toHaveBeenCalledTimes(1);
    expect(meter().getAttribute("aria-label")).toBe("Counting page reads");
    await wait(100);
    expect(meter().getAttribute("aria-label")).toBe(
      "Couldn't count page reads. Retry"
    );
  });

  it("starts no count after giving up, however the page changes, until Retry aborts the one given up on", async () => {
    countWithStages.mockImplementation(
      () => new Promise<PageReadReport>(() => undefined)
    );
    const changeFor = changingMeter();
    await changeFor(5000);
    // The count, begun at three seconds, drawing the page: the draw it was
    // handed, begun and held, as one whose block never settles is.
    const [[givenUp]] = countWithStages.mock.calls as [
      [{ draw: (element: React.ReactElement) => Promise<void> }],
    ];
    const drawing = givenUp.draw(<div />);
    const ended = vi.fn();
    drawing.then(ended, ended);
    // Once the renderer has loaded and the draw has begun.
    await vi.waitFor(() => expect(draws).toHaveLength(1));
    expect(draws[0]?.ended).toBe("drawing");
    await changeFor(15_000);
    expect(meter().getAttribute("aria-label")).toBe(
      "Couldn't count page reads. Retry"
    );
    // A minute more of changes: still the one count, given up on, and its
    // draw still held.
    await changeFor(60_000);
    expect(countWithStages).toHaveBeenCalledTimes(1);
    expect(meter().getAttribute("aria-label")).toBe(
      "Couldn't count page reads. Retry"
    );
    expect(draws[0]?.signal?.aborted).toBe(false);
    expect(ended).not.toHaveBeenCalled();
    fireEvent.click(meter());
    // Retry aborts the draw in flight: its signal fires, its stream is
    // aborted, and the draw ends rejected.
    expect(draws[0]?.signal?.aborted).toBe(true);
    await expect(drawing).rejects.toThrow();
    expect(draws[0]?.ended).toBe("aborted");
    await wait(0);
    expect(countWithStages).toHaveBeenCalledTimes(2);
  });
});

describe("a count given up on that answers after all", () => {
  /** A count answering 25 seconds after it begins. */
  function lateCount(): void {
    countWithStages.mockImplementation(
      () =>
        new Promise<PageReadReport>(resolve => {
          setTimeout(() => resolve(counted), 25_000);
        })
    );
  }

  it("is shown where the page has not changed since it began", async () => {
    lateCount();
    render(
      <PageReadMeter
        editor={editor}
        drawnWith={drawnWith}
        regions={NO_REGIONS}
      />
    );
    await wait(20_000);
    expect(meter().getAttribute("aria-label")).toBe(
      "Couldn't count page reads. Retry"
    );
    // Begun at 600 ms, it answers at 25.6 s.
    await wait(5600);
    expect(meter().getAttribute("aria-label")).toBe("3 of 500 reads");
  });

  it("is not shown where the page changed since it began", async () => {
    lateCount();
    const fresh = () => ({ ...drawnWith }) as CountedDrawing;
    const view = render(
      <PageReadMeter editor={editor} drawnWith={fresh()} regions={NO_REGIONS} />
    );
    await wait(1000);
    // A change after the count began, at 600 ms.
    view.rerender(
      <PageReadMeter editor={editor} drawnWith={fresh()} regions={NO_REGIONS} />
    );
    await wait(30_000);
    expect(countWithStages).toHaveBeenCalledTimes(1);
    expect(meter().getAttribute("aria-label")).toBe(
      "Couldn't count page reads. Retry"
    );
  });
});
