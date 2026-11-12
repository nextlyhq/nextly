/**
 * A template's SEO panel's reading of the plugin's route: the type's
 * variables and pages, and every level of one page's answer with the design
 * as it is being edited. Read once as the panel opens, then again a moment
 * after the design or the previewed page stops changing.
 *
 * @module admin/use-template-context
 */
import { writePluginRoute } from "@nextlyhq/plugin-sdk/admin";
import { useEffect, useRef, useState } from "react";

import { SEO_PLUGIN_NAME } from "../tab/contract";
import {
  SEO_TEMPLATE_PATH,
  type TemplateContext,
  type TemplateRequest,
} from "../template/contract";

/** How long the design stays unchanged before it is read again. */
const SETTLE_MS = 300;

/** The route's last answer, and whether a read is under way or failed. */
export interface TemplateContextState {
  context: TemplateContext | undefined;
  status: "ready" | "loading" | "failed";
}

/**
 * One read of the route, told to the panel unless it was stopped: a read
 * overtaken by a newer request says nothing.
 */
async function readInto(
  body: TemplateRequest,
  signal: AbortSignal,
  tell: (next: (was: TemplateContextState) => TemplateContextState) => void
): Promise<void> {
  tell(was => ({ context: was.context, status: "loading" }));
  let answer: TemplateContext | undefined;
  try {
    answer = await writePluginRoute<TemplateContext>({
      plugin: SEO_PLUGIN_NAME,
      path: SEO_TEMPLATE_PATH,
      body,
      signal,
    });
  } catch {
    // The last answer stays on screen, said to be out of date.
    if (!signal.aborted) {
      tell(was => ({ context: was.context, status: "failed" }));
    }
    return;
  }
  if (!signal.aborted && answer !== undefined) {
    const read = answer;
    tell(() => ({ context: read, status: "ready" }));
  }
}

export function useTemplateContext(
  request: TemplateRequest | null
): TemplateContextState {
  const [state, setState] = useState<TemplateContextState>({
    context: undefined,
    status: "loading",
  });
  // Whether the first read has gone: every later one waits for the design
  // to settle.
  const first = useRef(true);
  const key = request === null ? null : JSON.stringify(request);
  useEffect(() => {
    if (key === null) return undefined;
    const stop = new AbortController();
    const wait = first.current ? 0 : SETTLE_MS;
    const timer = setTimeout(() => {
      first.current = false;
      void readInto(JSON.parse(key) as TemplateRequest, stop.signal, setState);
    }, wait);
    return () => {
      clearTimeout(timer);
      stop.abort();
    };
  }, [key]);
  return state;
}
