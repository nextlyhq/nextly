/**
 * Whether a person may delete ONE component, asked of core's own delete gate
 * for that row, without deleting it.
 *
 * Core offers no "may this caller delete this entry" question that names the
 * entry, and the type-level one (`caller.can` with `anyEntry`) answers yes for
 * a rule that limits deletes to some rows: a person it admits may still be
 * refused this one. So the question is asked the one way that is exact: a
 * real delete through the Direct API, made as the person, carrying a probe
 * token in its hook context. Core judges the delete's access, a rule's row
 * filter included, BEFORE any `beforeDelete` hook runs; the probe hook below,
 * registered on the component store ahead of every other hook of this
 * plugin, records the token and refuses. Reached, the gate let the person
 * through; refused before it, the gate did not.
 *
 * Nothing is ever deleted by a probe: the hook refuses every write carrying a
 * token, and a probe is only made for a collection the hook is registered on
 * in this process, so a delete that would get past it cannot be started.
 *
 * @module component-delete/probe
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import type { Nextly } from "nextly";

import type { PersonReads } from "../layout-removal/layout-references";

/** The hook-context key a probe carries its token under. */
const PROBE_CONTEXT_KEY = "pageBuilder.componentDeleteProbe";

/** The collections the probe hook is registered on, in this process. */
const probed = new Set<string>();

/** The tokens of probes that reached the hook: the gate let them through. */
const reached = new Set<string>();

/** The plugin context the probe hook needs, named structurally. */
export interface ProbeContext {
  hooks: {
    on(
      type: string,
      collection: string,
      handler: (context: unknown) => unknown
    ): void;
  };
}

/**
 * Register the probe hook on the component store, by its RESOLVED slug.
 * Registered before the plugin's other delete guards, so a probe is answered
 * by the gate alone and not by a guard about Layouts.
 */
export function registerDeleteProbe(
  ctx: ProbeContext,
  components: string
): void {
  probed.add(components);
  ctx.hooks.on("beforeDelete", components, context => {
    const token = (context as { context?: Record<string, unknown> }).context?.[
      PROBE_CONTEXT_KEY
    ];
    if (typeof token !== "string" || token === "") return;
    reached.add(token);
    throw NextlyError.conflict({
      reason: "state",
      logContext: { reason: "component-delete-probe" },
    });
  });
}

/**
 * Whether core's delete gate lets the person delete this component. `false`
 * when it refuses, when the component is gone or hidden from them, and when
 * the probe cannot be made here at all.
 */
export async function mayDeleteComponent(args: {
  readonly nextly: Pick<Nextly, "delete">;
  readonly components: string;
  readonly componentId: string;
  readonly asPerson: PersonReads;
}): Promise<boolean> {
  if (!probed.has(args.components)) return false;
  const token = globalThis.crypto.randomUUID();
  try {
    await args.nextly.delete({
      collection: args.components,
      id: args.componentId,
      ...args.asPerson,
      context: { [PROBE_CONTEXT_KEY]: token },
    });
    // The probe hook refuses every probe, so a delete that went through
    // proves nothing about the gate: the answer is no.
    return false;
  } catch {
    return reached.delete(token);
  }
}
