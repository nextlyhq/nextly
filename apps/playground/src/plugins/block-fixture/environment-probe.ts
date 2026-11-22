"use client";

/**
 * The block fixture's environment probe: block code that measures itself,
 * reads the viewport and listens to the window, as a plugin block adapting to
 * its width does. e2e/tests/plugin-block-frame-environment.spec.ts reads what
 * it found from its element, and counts its listeners on each window.
 *
 * It asks `useBlockEnvironment()` for its window, and writes down whether its
 * own node's `ownerDocument` and `defaultView` agree, so the spec can tell the
 * canvas frame's answer from the admin's.
 *
 * Written with `createElement` rather than JSX, like `blocks.ts`, because the
 * config imports it through that file.
 */
import { useBlockEnvironment } from "@nextlyhq/blocks-react/environment";
import { createElement, useEffect, useState, type ReactElement } from "react";

/**
 * The media query the probe asks. With the playground's default devices,
 * Desktop and the e2e suite's 1440px admin window answer no, and Tablet and
 * Mobile answer yes; the spec reads each device's width from its label.
 */
const PROBE_QUERY = "(max-width: 1100px)";

/**
 * The property marking the probe's `resize` listener, so a spec counting a
 * window's listeners can tell the probe's from everything else's. A property
 * rather than the function's name, which a production build minifies.
 */
const PROBE_LISTENER_MARK = "nextlyFixtureProbe";

/** What the probe found, written onto its element as `data-*` attributes. */
interface Reading {
  /** The window's `innerWidth`. */
  innerWidth: number;
  /** Its own element's width, measured. */
  selfWidth: number;
  /** Whether {@link PROBE_QUERY} matches in that window. */
  narrow: boolean;
  /** How many `resize` events this mount has heard. */
  resizes: number;
  /** Whether its node's `ownerDocument` is the hook's document. */
  sameDocument: boolean;
  /** Whether its node's `defaultView` is the hook's window. */
  sameWindow: boolean;
  /** Whether that window is a frame inside another page. */
  framed: boolean;
}

/** The element's attributes for a reading; none before the first one. */
function attributesOf(
  reading: Reading | undefined
): Record<string, string> | undefined {
  if (reading === undefined) return undefined;
  return {
    "data-inner-width": String(reading.innerWidth),
    "data-self-width": String(reading.selfWidth),
    "data-narrow": String(reading.narrow),
    "data-resizes": String(reading.resizes),
    "data-same-document": String(reading.sameDocument),
    "data-same-window": String(reading.sameWindow),
    "data-framed": String(reading.framed),
  };
}

/** The probe itself: one paragraph, measured and listening once mounted. */
export function EnvironmentProbe(): ReactElement {
  const environment = useBlockEnvironment();
  // Its element as state, through a callback ref, so the effect below runs
  // once the element exists and again if React replaces it.
  const [own, setOwn] = useState<HTMLParagraphElement | null>(null);
  const [reading, setReading] = useState<Reading | undefined>(undefined);

  useEffect(() => {
    if (environment === undefined || own === null) return;
    const view = environment.window;
    let resizes = 0;
    const measure = (): void => {
      setReading({
        innerWidth: view.innerWidth,
        selfWidth: Math.round(own.getBoundingClientRect().width),
        narrow: view.matchMedia(PROBE_QUERY).matches,
        resizes,
        sameDocument: own.ownerDocument === environment.document,
        sameWindow: own.ownerDocument.defaultView === view,
        framed: view.parent !== view,
      });
    };
    const onResize = (): void => {
      resizes += 1;
      measure();
    };
    Object.defineProperty(onResize, PROBE_LISTENER_MARK, { value: true });
    measure();
    view.addEventListener("resize", onResize);
    return () => view.removeEventListener("resize", onResize);
  }, [environment, own]);

  return createElement(
    "p",
    { ref: setOwn, "data-fixture-probe": "", ...attributesOf(reading) },
    reading === undefined ? "Measuring" : `${String(reading.innerWidth)}px wide`
  );
}
