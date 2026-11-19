// @vitest-environment jsdom

/**
 * Playing one block's animation once on the canvas.
 *
 * jsdom runs no CSS, so the block's animations are stood in for by what a
 * browser answers: none while the block's gates are closed, and one, newly
 * made, each time the playing mark opens them. Each case is written against a
 * plausible wrong version: one that leaves the gates open after the run ends
 * (the block would then follow the scroll again), one that lets an earlier
 * run's end close a later one's gates, one that plays where reduced motion is
 * asked for, and one that finds a same-id node outside the canvas.
 *
 * @module appear-replay.test
 */
import { NODE_ID_ATTRIBUTE } from "@nextlyhq/blocks-react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CANVAS_ROOT_CLASS } from "../shell-state";

import { APPEAR_PLAYING_ATTRIBUTE, playAppear } from "./appear-replay";

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

/** One run of an animation, ended by the test. */
interface Run {
  readonly animation: Animation;
  readonly finish: () => void;
  readonly cancel: () => void;
}

function run(): Run {
  let finish = (): void => {};
  let cancel = (): void => {};
  const finished = new Promise<Animation>((resolve, reject) => {
    finish = () => resolve(animation);
    cancel = () => reject(new Error("AbortError"));
  });
  const animation = { finished } as unknown as Animation;
  return { animation, finish, cancel };
}

/**
 * A canvas holding block `id`, which animates whenever it carries the
 * playing mark (a new run each time the mark is put back), and nothing when
 * `animates` is false.
 */
function canvasWith(
  id: string,
  { animates = true }: { animates?: boolean } = {}
): { block: HTMLElement; runs: Run[] } {
  const canvas = document.createElement("div");
  canvas.className = CANVAS_ROOT_CLASS;
  const page = document.createElement("div");
  page.className = "nx-pb-page";
  const block = document.createElement("section");
  block.setAttribute(NODE_ID_ATTRIBUTE, id);
  page.append(block);
  canvas.append(page);
  document.body.append(canvas);
  const runs: Run[] = [];
  let shown: Run | undefined;
  block.getAnimations = () => {
    const playing = block.hasAttribute(APPEAR_PLAYING_ATTRIBUTE) && animates;
    if (!playing) shown = undefined;
    else if (shown === undefined) {
      shown = run();
      runs.push(shown);
    }
    return shown === undefined ? [] : [shown.animation];
  };
  return { block, runs };
}

function motionPreference(reduced: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: reduced && query.includes("prefers-reduced-motion: reduce"),
      media: query,
    }))
  );
}

/** Lets the runs' promises settle. */
async function settled(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
}

describe("playAppear", () => {
  it("plays the block once, then shows it in its final state again", async () => {
    motionPreference(false);
    const { block, runs } = canvasWith("a");

    expect(playAppear(document, "a")).toBe(true);
    expect(block.hasAttribute(APPEAR_PLAYING_ATTRIBUTE)).toBe(true);
    expect(runs).toHaveLength(1);

    runs[0]?.finish();
    await settled();
    expect(block.hasAttribute(APPEAR_PLAYING_ATTRIBUTE)).toBe(false);
  });

  it("starts over when played again, and the first run's end leaves the second be", async () => {
    motionPreference(false);
    const { block, runs } = canvasWith("a");

    playAppear(document, "a");
    expect(playAppear(document, "a")).toBe(true);
    // A new run, not the first carried on.
    expect(runs).toHaveLength(2);

    // The first run was cut short by the second play.
    runs[0]?.cancel();
    await settled();
    expect(block.hasAttribute(APPEAR_PLAYING_ATTRIBUTE)).toBe(true);

    runs[1]?.finish();
    await settled();
    expect(block.hasAttribute(APPEAR_PLAYING_ATTRIBUTE)).toBe(false);
  });

  it("closes the gates again when a run is cut short", async () => {
    motionPreference(false);
    const { block, runs } = canvasWith("a");

    playAppear(document, "a");
    runs[0]?.cancel();
    await settled();
    expect(block.hasAttribute(APPEAR_PLAYING_ATTRIBUTE)).toBe(false);
  });

  it("leaves a block with no animation still and unmarked", () => {
    motionPreference(false);
    const { block } = canvasWith("a", { animates: false });

    expect(playAppear(document, "a")).toBe(false);
    expect(block.hasAttribute(APPEAR_PLAYING_ATTRIBUTE)).toBe(false);
  });

  it("plays nothing where the window asks for reduced motion", () => {
    motionPreference(true);
    const { block, runs } = canvasWith("a");

    expect(playAppear(document, "a")).toBe(false);
    expect(block.hasAttribute(APPEAR_PLAYING_ATTRIBUTE)).toBe(false);
    expect(runs).toHaveLength(0);
  });

  it("finds the block in the canvas, not a same-id node outside it", () => {
    motionPreference(false);
    const outside = document.createElement("section");
    outside.setAttribute(NODE_ID_ATTRIBUTE, "a");
    document.body.append(outside);
    const { block, runs } = canvasWith("a");

    expect(playAppear(document, "a")).toBe(true);
    expect(block.hasAttribute(APPEAR_PLAYING_ATTRIBUTE)).toBe(true);
    expect(outside.hasAttribute(APPEAR_PLAYING_ATTRIBUTE)).toBe(false);
    expect(runs).toHaveLength(1);
  });

  it("answers false for a block not drawn", () => {
    motionPreference(false);
    canvasWith("a");
    expect(playAppear(document, "missing")).toBe(false);
  });
});
