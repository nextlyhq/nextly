/**
 * The provided-checks route: every registered page check provider's
 * findings about the page being edited, for the editor's Page checks list.
 *
 * Each provider runs here, on the server, as the person asking (`access`),
 * who must be able to change pages of the collection: the findings are about
 * a page they are editing. A provider that throws or takes too long is
 * answered as not run, with no findings, so one broken provider never hides
 * the others' or the built-in checks. What a provider answers is kept only
 * where it is a well-formed finding, with its words capped, since another
 * plugin's code wrote it.
 *
 * @module page-checks-provided-route
 */
import type {
  PageCheckFinding,
  PageCheckFix,
  PageCheckProvider,
} from "@nextlyhq/plugin-sdk/blocks";
import { NextlyError, type PluginRouteContext } from "@nextlyhq/plugin-sdk";
import { respondList } from "nextly";
import { z } from "nextly/zod";

import { parsedWith } from "./composition-route-kit";
import { asServiceCaller } from "./library-route";
import {
  PROVIDED_CHECKS_ROUTE_PATH,
  type ProvidedChecksItem,
  type ProvidedChecksRequest,
} from "./page-checks-provided-contract";

/** How long one provider may take before it is answered as not run. */
const PROVIDER_TIMEOUT_MS = 10_000;

/** At most this many findings are kept from one provider. */
const MAX_FINDINGS = 200;

/** A finding's words are cut to this many characters. */
const MAX_WORDS = 500;

/** The request body, parsed at the boundary. */
const REQUEST = z.object({
  collection: z.string().min(1).max(200),
  entryId: z.string().min(1).max(200).nullable(),
  locale: z.string().min(1).max(50).optional(),
  document: z.unknown(),
});

/** A string with something in it, cut to the length kept, or undefined. */
function words(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed.slice(0, MAX_WORDS);
}

/** A fix as a provider gave it, where it is one of the two kinds. */
function fixOf(value: unknown): PageCheckFix | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const fix = value as Record<string, unknown>;
  const settingsTab = words(fix.settingsTab);
  if (settingsTab !== undefined) return { settingsTab };
  const id = words(fix.id);
  const { tab } = fix;
  if (id === undefined) return undefined;
  return tab === "content" || tab === "style" || tab === "advanced"
    ? { tab, id }
    : undefined;
}

/** A finding as a provider gave it, or undefined where it is not one. */
function findingOf(value: unknown): PageCheckFinding | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const finding = value as Record<string, unknown>;
  const what = words(finding.what);
  const why = words(finding.why);
  const todo = words(finding.todo);
  if (what === undefined || why === undefined || todo === undefined) {
    return undefined;
  }
  const nodeId = words(finding.nodeId);
  const part = words(finding.part);
  const fix = fixOf(finding.fix);
  return {
    what,
    why,
    todo,
    ...(nodeId === undefined ? {} : { nodeId }),
    ...(part === undefined ? {} : { part }),
    ...(fix === undefined ? {} : { fix }),
  };
}

/** A provider's answer, or that it didn't run in time or threw. */
async function answerOf(
  provider: PageCheckProvider,
  page: ProvidedChecksRequest,
  access: Parameters<PageCheckProvider["check"]>[1]["access"]
): Promise<ProvidedChecksItem> {
  const notRun: ProvidedChecksItem = {
    provider: provider.id,
    group: provider.group,
    ran: false,
    findings: [],
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const found = await Promise.race([
      provider.check(page, { access }),
      new Promise<"late">(resolve => {
        timer = setTimeout(() => resolve("late"), PROVIDER_TIMEOUT_MS);
      }),
    ]);
    if (found === "late" || !Array.isArray(found)) return notRun;
    const findings = found
      .slice(0, MAX_FINDINGS)
      .flatMap((each: unknown) => findingOf(each) ?? []);
    return { ...notRun, ran: true, findings };
  } catch {
    return notRun;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Whether the caller may change pages of the collection asked about. */
async function mayCheck(
  ctx: PluginRouteContext,
  collection: string
): Promise<boolean> {
  if (ctx.user === null || ctx.caller === null) return false;
  return ctx.caller.can("update", collection, { anyEntry: true });
}

/**
 * The route declaration. Authenticated, with no permission of its own: the
 * collection asked about is judged for the caller in the handler.
 */
export function providedChecksRoute(
  providers: () => readonly PageCheckProvider[]
): {
  method: "POST";
  checksAccess: true;
  path: string;
  handler: (req: Request, ctx: PluginRouteContext) => Promise<Response>;
} {
  return {
    method: "POST",
    path: PROVIDED_CHECKS_ROUTE_PATH,
    checksAccess: true, // The handler judges each caller.
    handler: async (req, ctx) => {
      const body: unknown = await req.json().catch(() => null);
      const page = parsedWith(body, REQUEST);
      if (!(await mayCheck(ctx, page.collection))) {
        throw NextlyError.forbidden({
          logContext: {
            reason: "page-checks-not-granted",
            collection: page.collection,
          },
        });
      }
      const access = asServiceCaller(ctx) as Parameters<
        PageCheckProvider["check"]
      >[1]["access"];
      const items = await Promise.all(
        providers().map(provider => answerOf(provider, page, access))
      );
      return respondList([...items], {
        total: items.length,
        page: 1,
        limit: Math.max(items.length, 1),
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      });
    },
  };
}
