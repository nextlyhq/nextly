// @vitest-environment jsdom

/**
 * When the editor's meter counts a page, and what it says when it cannot.
 *
 * The count is made once the page has gone two seconds without a change,
 * when the browser is idle, and an edit stops a count being made: a count
 * draws the whole page, which must not compete with an author at work. Two
 * ways a count could never land are held here: a count that fails, which
 * must be said with a way to count again rather than left counting;
 * and an editor that renders with nothing changed, which must not put the
 * count off. A count that never answers is a failed one too, once it has had
 * its while from when it began. The
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

/**
 * The requests made to the bindings route, each held until its signal
 * aborts, and how many were outstanding at most at once.
 */
const routeAsks = vi.hoisted(() => ({
  made: [] as { signal: AbortSignal | undefined }[],
  outstanding: 0,
  most: 0,
}));

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
  writePluginRoute: ({ signal }: { signal?: AbortSignal }) => {
    routeAsks.made.push({ signal });
    routeAsks.outstanding += 1;
    routeAsks.most = Math.max(routeAsks.most, routeAsks.outstanding);
    return new Promise((_resolve, reject) => {
      signal?.addEventListener(
        "abort",
        () => {
          routeAsks.outstanding -= 1;
          reject(signal.reason);
        },
        { once: true }
      );
    });
  },
}));

import {
  PageReadMeter,
  usePageDataCount,
  type PageDataCountInputs,
} from "./page-read-meter";

/**
 * The page counted, as Page settings shows it: at every level, counting
 * included, so each step of the count can be read off it.
 */
function Counted(
  props: Omit<PageDataCountInputs, "counts">
): React.JSX.Element | null {
  const count = usePageDataCount({ ...props, counts: true });
  return <PageReadMeter count={count} place="settings" />;
}

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
  routeAsks.made.length = 0;
  routeAsks.outstanding = 0;
  routeAsks.most = 0;
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
      <Counted editor={editor} drawnWith={drawnWith} regions={NO_REGIONS} />
    );
    expect(meter().getAttribute("aria-label")).toBe(
      "Page data: counting. What's this?"
    );
    await wait(2000);
    await settle();
    expect(countWithStages).toHaveBeenCalledTimes(1);
    // Said, in the meter's place, its name and its tooltip the same words.
    expect(meter().getAttribute("aria-label")).toBe(
      "Page data: couldn't count. Retry"
    );
    expect(meter().getAttribute("title")).toBe(
      "Page data: couldn't count. Retry"
    );
    expect(meter().getAttribute("data-standing")).toBe("failed");
    // It stays said: no count is made again on its own.
    await wait(5000);
    expect(countWithStages).toHaveBeenCalledTimes(1);
    expect(meter().getAttribute("data-standing")).toBe("failed");

    fireEvent.click(meter());
    expect(meter().getAttribute("aria-label")).toBe(
      "Page data: counting. What's this?"
    );
    // At once, not after the moment the page is given to settle.
    await wait(0);
    await settle();
    expect(countWithStages).toHaveBeenCalledTimes(2);
    expect(meter().getAttribute("aria-label")).toBe(
      "Page data: 3 of 500, within the limit. What's this?"
    );
  });
});

describe("a count that never answers", () => {
  it("is said as one that could not be made, once it has had its while", async () => {
    countWithStages
      .mockReturnValueOnce(new Promise<never>(() => undefined))
      .mockResolvedValueOnce(counted);
    render(
      <Counted editor={editor} drawnWith={drawnWith} regions={NO_REGIONS} />
    );
    await wait(2000);
    expect(countWithStages).toHaveBeenCalledTimes(1);
    // Still counting well into its while: a slow count is not a failed one.
    await wait(15_000);
    expect(meter().getAttribute("aria-label")).toBe(
      "Page data: counting. What's this?"
    );
    await wait(5_000);
    expect(meter().getAttribute("aria-label")).toBe(
      "Page data: couldn't count. Retry"
    );
    fireEvent.click(meter());
    await wait(0);
    await settle();
    expect(meter().getAttribute("aria-label")).toBe(
      "Page data: 3 of 500, within the limit. What's this?"
    );
  });
});

describe("an editor that renders more often than the count waits", () => {
  it("has its page counted within the wait, the form's identity new each render", async () => {
    countWithStages.mockResolvedValue(counted);
    const view = render(
      <Counted editor={editor} drawnWith={drawnWith} regions={NO_REGIONS} />
    );
    // Rendered again every 200 ms, the page itself unchanged.
    for (let step = 0; step < 3; step += 1) {
      await wait(200);
      view.rerender(
        <Counted editor={editor} drawnWith={drawnWith} regions={NO_REGIONS} />
      );
    }
    await wait(1400);
    await settle();
    // Two seconds after the page was drawn, once.
    expect(countWithStages).toHaveBeenCalledTimes(1);
    expect(meter().getAttribute("aria-label")).toBe(
      "Page data: 3 of 500, within the limit. What's this?"
    );
  });

  it("has its page counted only once its inputs stop changing, and then at once", async () => {
    countWithStages.mockResolvedValue(counted);
    const fresh = () => ({ ...drawnWith }) as CountedDrawing;
    const view = render(
      <Counted editor={editor} drawnWith={fresh()} regions={NO_REGIONS} />
    );
    // What the canvas draws with, a new object every 200 ms for three
    // seconds: an author at work, so nothing is drawn to count meanwhile.
    for (let step = 0; step < 15; step += 1) {
      await wait(200);
      view.rerender(
        <Counted editor={editor} drawnWith={fresh()} regions={NO_REGIONS} />
      );
    }
    expect(countWithStages).not.toHaveBeenCalled();
    // Two seconds after the last change, counted once.
    await wait(2000);
    await settle();
    expect(countWithStages).toHaveBeenCalledTimes(1);
    expect(meter().getAttribute("aria-label")).toBe(
      "Page data: 3 of 500, within the limit. What's this?"
    );
  });

  it("waits for the browser to be idle once the page has rested", async () => {
    countWithStages.mockResolvedValue(counted);
    const idle: Array<() => void> = [];
    const asked = vi.fn((run: () => void) => {
      idle.push(run);
      return idle.length;
    });
    vi.stubGlobal("requestIdleCallback", asked);
    vi.stubGlobal("cancelIdleCallback", () => undefined);
    try {
      render(
        <Counted editor={editor} drawnWith={drawnWith} regions={NO_REGIONS} />
      );
      await wait(2000);
      // Rested, the count is handed to the browser's idle time, not made,
      // with a second's limit so a busy page is still counted.
      expect(asked).toHaveBeenCalledTimes(1);
      expect(asked).toHaveBeenCalledWith(expect.any(Function), {
        timeout: 1000,
      });
      expect(countWithStages).not.toHaveBeenCalled();
      act(() => idle[0]?.());
      await settle();
      expect(countWithStages).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
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
      <Counted editor={editor} drawnWith={fresh()} regions={NO_REGIONS} />
    );
    return async ms => {
      for (let elapsed = 0; elapsed < ms; elapsed += 100) {
        await wait(100);
        view.rerender(
          <Counted editor={editor} drawnWith={fresh()} regions={NO_REGIONS} />
        );
      }
    };
  }

  it("counts nothing while the page keeps changing, however long", async () => {
    countWithStages.mockResolvedValue(counted);
    await changingMeter()(20_000);
    expect(countWithStages).not.toHaveBeenCalled();
    expect(meter().getAttribute("aria-label")).toBe(
      "Page data: counting. What's this?"
    );
    // Once it rests, the count is made.
    await wait(2000);
    await settle();
    expect(countWithStages).toHaveBeenCalledTimes(1);
    expect(meter().getAttribute("aria-label")).toBe(
      "Page data: 3 of 500, within the limit. What's this?"
    );
  });

  it("stops a count being made when the page changes, and counts again once it rests", async () => {
    // Each count draws the page, held as a draw is while it renders, and
    // answers five seconds after it begins.
    countWithStages.mockImplementation(
      ({ draw }: { draw: (element: React.ReactElement) => Promise<void> }) =>
        new Promise<PageReadReport>(resolve => {
          draw(<div />).catch(() => undefined);
          setTimeout(() => resolve(counted), 5000);
        })
    );
    const changeFor = changingMeter();
    await wait(2000);
    expect(countWithStages).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(draws).toHaveLength(1));
    // The author goes on working a second into the count: its draw stops.
    await changeFor(1000);
    expect(draws[0]?.signal?.aborted).toBe(true);
    // Not counted again until the page has rested two seconds.
    await wait(1999);
    expect(countWithStages).toHaveBeenCalledTimes(1);
    await wait(1);
    expect(countWithStages).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => expect(draws).toHaveLength(2));
    expect(draws[1]?.signal?.aborted).toBe(false);
    await wait(5000);
    expect(meter().getAttribute("aria-label")).toBe(
      "Page data: 3 of 500, within the limit. What's this?"
    );
  });

  it("says the count could not be made twenty seconds after it began, when it never answers", async () => {
    countWithStages.mockImplementation(
      () => new Promise<PageReadReport>(() => undefined)
    );
    // Changing for five seconds, then resting: the count begins at seven,
    // and its twenty seconds count from there, not from the first change.
    await changingMeter()(5000);
    await wait(2000);
    expect(countWithStages).toHaveBeenCalledTimes(1);
    await wait(19_900);
    expect(meter().getAttribute("aria-label")).toBe(
      "Page data: counting. What's this?"
    );
    await wait(100);
    expect(meter().getAttribute("aria-label")).toBe(
      "Page data: couldn't count. Retry"
    );
  });

  /** A count that never answers, its draw begun and held; the draw. */
  async function givenUpDraw(): Promise<{
    drawing: Promise<void>;
    ended: ReturnType<typeof vi.fn>;
  }> {
    await wait(2000);
    // The count, begun at two seconds, drawing the page: the draw it was
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
    await wait(20_000);
    expect(meter().getAttribute("aria-label")).toBe(
      "Page data: couldn't count. Retry"
    );
    return { drawing, ended };
  }

  it("starts no count after giving up until Retry, which aborts the one given up on", async () => {
    countWithStages.mockImplementation(
      () => new Promise<PageReadReport>(() => undefined)
    );
    changingMeter();
    const { drawing, ended } = await givenUpDraw();
    // A minute more, the page unchanged: still the one count, its draw held
    // in case it answers after all.
    await wait(60_000);
    expect(countWithStages).toHaveBeenCalledTimes(1);
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

  it("stops the draw of a count given up on once the page changes, and counts again only on Retry", async () => {
    countWithStages.mockImplementation(
      () => new Promise<PageReadReport>(() => undefined)
    );
    const changeFor = changingMeter();
    const { drawing } = await givenUpDraw();
    // The author goes on working: the stalled draw is stopped, so it never
    // finishes under their hands, and no new count is begun.
    await changeFor(60_000);
    expect(draws[0]?.signal?.aborted).toBe(true);
    await expect(drawing).rejects.toThrow();
    expect(countWithStages).toHaveBeenCalledTimes(1);
    expect(meter().getAttribute("aria-label")).toBe(
      "Page data: couldn't count. Retry"
    );
    fireEvent.click(meter());
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
      <Counted editor={editor} drawnWith={drawnWith} regions={NO_REGIONS} />
    );
    // Begun at two seconds, given up on at twenty-two.
    await wait(22_000);
    expect(meter().getAttribute("aria-label")).toBe(
      "Page data: couldn't count. Retry"
    );
    // It answers at twenty-seven, the page unchanged since it began.
    await wait(5000);
    expect(meter().getAttribute("aria-label")).toBe(
      "Page data: 3 of 500, within the limit. What's this?"
    );
  });

  it("goes on counting after its late answer is shown", async () => {
    lateCount();
    const fresh = () => ({ ...drawnWith }) as CountedDrawing;
    const view = render(
      <Counted editor={editor} drawnWith={fresh()} regions={NO_REGIONS} />
    );
    await wait(27_000);
    expect(meter().getAttribute("aria-label")).toBe(
      "Page data: 3 of 500, within the limit. What's this?"
    );
    view.rerender(
      <Counted editor={editor} drawnWith={fresh()} regions={NO_REGIONS} />
    );
    await wait(2000);
    expect(countWithStages).toHaveBeenCalledTimes(2);
  });

  it("is not shown where the page changed since it began", async () => {
    lateCount();
    const fresh = () => ({ ...drawnWith }) as CountedDrawing;
    const view = render(
      <Counted editor={editor} drawnWith={fresh()} regions={NO_REGIONS} />
    );
    // Begun at two seconds and given up on at twenty-two.
    await wait(22_000);
    // A change after the count began, before its answer at twenty-seven.
    view.rerender(
      <Counted editor={editor} drawnWith={fresh()} regions={NO_REGIONS} />
    );
    await wait(10_000);
    expect(countWithStages).toHaveBeenCalledTimes(1);
    expect(meter().getAttribute("aria-label")).toBe(
      "Page data: couldn't count. Retry"
    );
  });
});

describe("the count's request to the bindings route", () => {
  /** A page whose heading is bound to its title, so the route is asked. */
  const bound = {
    ...document,
    nodes: [
      {
        id: "h",
        type: "core/heading",
        version: 1,
        props: { text: "Own text" },
        bindings: { text: { $bind: "title" } },
      },
    ],
  };

  /** What the count numbered `index` reads the page's bindings with. */
  function readBindingsOf(
    index: number
  ): (
    ask: { documents: readonly unknown[] },
    allowance: number
  ) => Promise<unknown> {
    const call = countWithStages.mock.calls[index] as [
      {
        readBindings: (
          ask: { documents: readonly unknown[] },
          allowance: number
        ) => Promise<unknown>;
      },
    ];
    return call[0].readBindings;
  }

  it("is aborted by Retry, and only one is ever outstanding", async () => {
    countWithStages.mockImplementation(
      () => new Promise<PageReadReport>(() => undefined)
    );
    render(
      <Counted editor={editor} drawnWith={drawnWith} regions={NO_REGIONS} />
    );
    await wait(2000);
    // The count's bindings read, its request held by the route.
    const reading = readBindingsOf(0)({ documents: [bound] }, 500);
    const ended = vi.fn();
    reading.then(ended, ended);
    await vi.waitFor(() => expect(routeAsks.made).toHaveLength(1));
    await wait(20_000);
    expect(meter().getAttribute("aria-label")).toBe(
      "Page data: couldn't count. Retry"
    );
    expect(routeAsks.made[0]?.signal?.aborted).toBe(false);
    expect(ended).not.toHaveBeenCalled();
    fireEvent.click(meter());
    // Retry aborts the request in flight, and the read ends rejected.
    expect(routeAsks.made[0]?.signal?.aborted).toBe(true);
    await expect(reading).rejects.toThrow();
    expect(routeAsks.outstanding).toBe(0);
    await wait(0);
    expect(countWithStages).toHaveBeenCalledTimes(2);
    // The next count asks the route afresh, the aborted ask not kept.
    readBindingsOf(1)({ documents: [bound] }, 500).catch(() => undefined);
    await vi.waitFor(() => expect(routeAsks.made).toHaveLength(2));
    expect(routeAsks.most).toBe(1);
  });
});

describe("a count stopped by a change that then fails", () => {
  it("reads as counting, not failed, while the count after the change is made", async () => {
    countWithStages
      // Drawing the page until the change stops it, and failing then.
      .mockImplementationOnce(
        async ({
          draw,
        }: {
          draw: (element: React.ReactElement) => Promise<void>;
        }) => {
          await draw(<div />);
          return counted;
        }
      )
      .mockImplementationOnce(
        () =>
          new Promise<PageReadReport>(resolve => {
            setTimeout(() => resolve(counted), 1000);
          })
      );
    const fresh = () => ({ ...drawnWith }) as CountedDrawing;
    const view = render(
      <Counted editor={editor} drawnWith={fresh()} regions={NO_REGIONS} />
    );
    await wait(2000);
    await vi.waitFor(() => expect(draws).toHaveLength(1));
    // Changed while the first count, begun at two seconds, is being made:
    // it is stopped, and its failure is not the meter's to say.
    view.rerender(
      <Counted editor={editor} drawnWith={fresh()} regions={NO_REGIONS} />
    );
    await settle();
    expect(meter().getAttribute("aria-label")).toBe(
      "Page data: counting. What's this?"
    );
    await wait(2000);
    expect(countWithStages).toHaveBeenCalledTimes(2);
    expect(meter().getAttribute("aria-label")).toBe(
      "Page data: counting. What's this?"
    );
    await wait(1000);
    expect(meter().getAttribute("aria-label")).toBe(
      "Page data: 3 of 500, within the limit. What's this?"
    );
  });
});

describe("a count stopped by an edit that answers anyway", () => {
  it("is never shown, even once a later count is given up on", async () => {
    countWithStages
      // Takes no notice of the abort, and answers 25 seconds on.
      .mockImplementationOnce(
        () =>
          new Promise<PageReadReport>(resolve => {
            setTimeout(() => resolve(counted), 25_000);
          })
      )
      // Never answers.
      .mockImplementationOnce(
        () => new Promise<PageReadReport>(() => undefined)
      );
    const fresh = () => ({ ...drawnWith }) as CountedDrawing;
    const view = render(
      <Counted editor={editor} drawnWith={fresh()} regions={NO_REGIONS} />
    );
    // The first count begins at two seconds; an edit at 2.5 stops it.
    await wait(2500);
    view.rerender(
      <Counted editor={editor} drawnWith={fresh()} regions={NO_REGIONS} />
    );
    // The second begins at 4.5 and is given up on at 24.5.
    await wait(22_100);
    expect(countWithStages).toHaveBeenCalledTimes(2);
    expect(meter().getAttribute("aria-label")).toBe(
      "Page data: couldn't count. Retry"
    );
    // The first answers at 27, of a page that has changed since: not shown.
    await wait(3000);
    expect(meter().getAttribute("aria-label")).toBe(
      "Page data: couldn't count. Retry"
    );
  });
});

describe("a meter that closes", () => {
  it("starts no count once it has gone", async () => {
    countWithStages.mockResolvedValue(counted);
    const view = render(
      <Counted editor={editor} drawnWith={drawnWith} regions={NO_REGIONS} />
    );
    await wait(1000);
    view.unmount();
    await wait(5000);
    expect(countWithStages).not.toHaveBeenCalled();
  });
});

describe("a document that is not a page", () => {
  it("is never counted, and draws no meter", async () => {
    countWithStages.mockResolvedValue(counted);
    function NotCounted(): React.JSX.Element | null {
      const count = usePageDataCount({
        counts: false,
        editor,
        drawnWith,
        regions: NO_REGIONS,
      });
      return <PageReadMeter count={count} place="settings" />;
    }
    const view = render(<NotCounted />);
    await wait(5000);
    expect(countWithStages).not.toHaveBeenCalled();
    expect(view.container.innerHTML).toBe("");
  });
});
