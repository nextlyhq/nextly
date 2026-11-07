/**
 * The site code route: where the code every published page carries is read,
 * checked and saved.
 *
 * Under the site settings permission: who may change the site's settings
 * may add code to it. A save is a signed-in
 * person's alone, never an API key's, so a leaked key cannot put script on
 * every page. Each save is judged on the server whatever the client checked:
 * the sanitiser (`sanitise`) turns what was written into entries, refusing
 * anything off its list with a reason, and the code is checked against the
 * site's Content Security Policy, the one the site declared to the plugin and
 * the one the editor's browser read from the site. Code a policy would block
 * is saved only once the person has seen exactly those findings and said so.
 * Every save writes an audit row holding hashes, sizes and counts, never the
 * code; the code itself is kept in the Single's versions.
 *
 * @module site-code/route
 * @experimental
 */
import {
  NextlyError,
  respondMutation,
  type PluginRoute,
  type PluginRouteContext,
} from "@nextlyhq/plugin-sdk";
import { z } from "nextly/zod";

import {
  asOverwrite,
  documentVersionOf,
  withVersionFrom,
} from "../document-version";
import {
  SITE_CODE_ROUTE_PATH,
  type SiteCodeChecked,
  type SiteCodePolicyChecked,
  type SiteCodeRead,
  type SiteCodeSaved,
  type SiteCodeSlotJudged,
} from "../library-contract";
import { sha256Hex } from "../sha256-hex";

import {
  checkSiteCodeAgainstCsp,
  cspHash,
  siteCodeFacts,
  siteCodePolicyAdditions,
  type CspCheck,
  type SiteCodeFacts,
} from "./csp";
import { describeSiteCode } from "./describe";
import {
  SITE_CODE_LIMITS,
  siteCodeScriptKind,
  type SiteCodeEntry,
} from "./rules";
import { sanitiseSiteCode, type SanitisedSiteCode } from "./sanitise";
import {
  SITE_CODE_SLUG,
  SITE_CODE_WRITE_CONTEXT,
  storedSiteCodeEntries,
} from "./storage";

/**
 * How a site tells the plugin about the policy its pages are served with, so
 * site code is checked against it before it is saved.
 *
 * @experimental
 */
export interface PageBuilderSiteCodeOptions {
  /**
   * The site's Content Security Policy, as its proxy or headers send it: a
   * header value, or a function read on each check. Share one function with
   * the proxy, so the policy checked is the policy sent. A `'nonce-…'` in it
   * stands for the site's per-request nonce.
   */
  readonly csp?: string | (() => string | Promise<string>);
  /** Whether the policy is sent as Report-Only, which blocks nothing. */
  readonly reportOnly?: boolean;
  /** Whether the site passes its nonce to `<SiteCode>`. */
  readonly siteNonce?: boolean;
}

/** The Direct API calls the route makes, stated structurally. */
export interface SiteCodeDirectApi {
  findSingle(args: {
    slug: string;
    depth: number;
    overrideAccess: true;
    createIfMissing: boolean;
    user: undefined;
    req: undefined;
  }): Promise<Record<string, unknown> | null>;
  updateSingle(args: {
    slug: string;
    data: Record<string, unknown>;
    overrideAccess: true;
    context: Record<string, unknown>;
    user: { id: string };
  }): Promise<unknown>;
}

/** What the route reads of its request's context. */
export type SiteCodeRouteContext = Pick<
  PluginRouteContext,
  "user" | "caller" | "audit"
> & {
  readonly self: { readonly singles: Record<string, string | undefined> };
};

/** What the route is handed. */
export interface SiteCodeRouteDeps {
  readonly nextly: () => Promise<SiteCodeDirectApi>;
  readonly options: PageBuilderSiteCodeOptions | undefined;
  /** The permission the route asks for: the site settings one. */
  readonly permission: string;
  /**
   * The name of the person with this id, for "Last changed by"; `null` when
   * it can't be read. Absent, no name is given.
   */
  readonly personName?: (id: string) => Promise<string | null>;
}

/** The audit kind a save writes. */
export const SITE_CODE_SAVED_AUDIT =
  "nextlyhq-plugin-page-builder.site-code-saved";

/** The keys a save's audit row holds: hashes, sizes and counts, never code. */
export const SITE_CODE_SAVED_METADATA = [
  "headSha256",
  "headSha256Before",
  "bodySha256",
  "bodySha256Before",
  "headChars",
  "bodyChars",
  "elements",
  "inlineScripts",
  "externalScripts",
  "scriptOrigins",
  "cspFindings",
  "cspOverridden",
] as const;

/** The longest a string an audit row keeps may be. */
const AUDIT_STRING_LIMIT = 256;

/**
 * The request a check or save sends. Each place's text is bounded at twice
 * what it may hold, so an oversized paste reaches the sanitiser, which says
 * how much it may be, while the request itself stays bounded.
 */
const SiteCodeBody = z.strictObject({
  head: z.string().max(SITE_CODE_LIMITS.slotChars * 2),
  body: z.string().max(SITE_CODE_LIMITS.slotChars * 2),
  dryRun: z.boolean().optional(),
  version: z.string().optional(),
  acknowledgeCsp: z.string().optional(),
  livePolicy: z
    .strictObject({
      policy: z.string().max(16_384),
      reportOnly: z.boolean(),
    })
    .optional(),
});
type SiteCodeBodyValue = z.infer<typeof SiteCodeBody>;

/** The site code Single's slug, renamed or not. */
function slugOf(ctx: SiteCodeRouteContext): string {
  return ctx.self.singles[SITE_CODE_SLUG] ?? SITE_CODE_SLUG;
}

/** The stored code, read past the Single's own permission with no identity. */
async function readStored(
  nextly: SiteCodeDirectApi,
  ctx: SiteCodeRouteContext
): Promise<Record<string, unknown> | null> {
  return nextly.findSingle({
    slug: slugOf(ctx),
    depth: 0,
    overrideAccess: true,
    createIfMissing: false,
    user: undefined,
    req: undefined,
  });
}

/** A stored text field, or empty. */
function textOf(doc: Record<string, unknown> | null, key: string): string {
  const value = doc?.[key];
  return typeof value === "string" ? value : "";
}

/** When a stored document was last saved, as an ISO date. */
function changedAtOf(doc: Record<string, unknown> | null): string | null {
  const value = doc?.updatedAt;
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * The name of the person who saved the code last, from its `user:<id>`
 * marker; `null` when there is none or the name can't be read, which never
 * fails the read.
 */
async function changedByOf(
  doc: Record<string, unknown> | null,
  deps: SiteCodeRouteDeps
): Promise<string | null> {
  const marker = textOf(doc, "changedBy");
  if (!marker.startsWith("user:") || deps.personName === undefined) {
    return null;
  }
  try {
    return await deps.personName(marker.slice("user:".length));
  } catch {
    return null;
  }
}

/** The site code as Settings reads it, to edit. */
async function readSiteCode(
  ctx: SiteCodeRouteContext,
  deps: SiteCodeRouteDeps
): Promise<Response> {
  const doc = await readStored(await deps.nextly(), ctx);
  return Response.json({
    head: textOf(doc, "headSource"),
    body: textOf(doc, "bodySource"),
    version: documentVersionOf(doc) ?? null,
    policyDeclared: deps.options?.csp !== undefined,
    // From the entries pages render, so the summary names what runs.
    described: {
      head: describeSiteCode(storedSiteCodeEntries(doc, "head")),
      body: describeSiteCode(storedSiteCodeEntries(doc, "body")),
    },
    changedAt: changedAtOf(doc),
    changedBy: await changedByOf(doc, deps),
  } satisfies SiteCodeRead);
}

/** A slot's sanitised result as the person is told it. */
function slotJudged(sanitised: SanitisedSiteCode): SiteCodeSlotJudged {
  return {
    refusals: sanitised.refusals,
    notes: sanitised.notes,
    elements: sanitised.entries.length,
  };
}

/** The declared policy, read now. */
async function declaredPolicy(
  options: PageBuilderSiteCodeOptions | undefined
): Promise<string | undefined> {
  const csp = options?.csp;
  return typeof csp === "function" ? await csp() : csp;
}

/** One policy to check against, as the route knows it. */
interface KnownPolicy {
  readonly source: SiteCodePolicyChecked["source"];
  readonly policy: string | undefined;
  readonly reportOnly: boolean;
}

/**
 * The check against one policy, and what to add to it where it blocks
 * something: the person is told exactly what the merge would add.
 */
async function policyChecked(
  known: KnownPolicy,
  entries: { head: SiteCodeEntry[]; body: SiteCodeEntry[] },
  facts: SiteCodeFacts,
  siteNonce: boolean
): Promise<SiteCodePolicyChecked> {
  const check: CspCheck = await checkSiteCodeAgainstCsp(
    {
      ...(known.policy === undefined ? {} : { policy: known.policy }),
      reportOnly: known.reportOnly,
      siteOrigin: facts.siteOrigin,
      siteNonce,
    },
    entries
  );
  const blocks =
    check.checked && check.findings.length > 0 && known.policy !== undefined;
  return {
    source: known.source,
    check,
    additions: blocks
      ? siteCodePolicyAdditions(known.policy ?? "", facts, { siteNonce })
      : [],
  };
}

/** The checks against each policy known: the declared one, and the live one. */
async function policyChecks(
  entries: { head: SiteCodeEntry[]; body: SiteCodeEntry[] },
  body: SiteCodeBodyValue,
  siteOrigin: string,
  options: PageBuilderSiteCodeOptions | undefined
): Promise<SiteCodePolicyChecked[]> {
  const siteNonce = options?.siteNonce === true;
  const facts = await siteCodeFacts(
    [...entries.head, ...entries.body],
    siteOrigin
  );
  const known: KnownPolicy[] = [
    {
      source: "declared",
      policy: await declaredPolicy(options),
      reportOnly: options?.reportOnly === true,
    },
  ];
  if (body.livePolicy !== undefined) {
    known.push({
      source: "live",
      policy: body.livePolicy.policy,
      reportOnly: body.livePolicy.reportOnly,
    });
  }
  return Promise.all(
    known.map(policy => policyChecked(policy, entries, facts, siteNonce))
  );
}

/**
 * The findings an acknowledgement covers: the blocks an enforced policy
 * makes. A Report-Only policy blocks nothing, so its warnings are shown in
 * the check and never asked to be acknowledged.
 */
function findingsOf(checks: readonly SiteCodePolicyChecked[]): unknown[] {
  return checks.flatMap(({ source, check }) =>
    check.checked
      ? check.findings
          .filter(finding => finding.level === "error")
          .map(finding => ({ source, finding }))
      : []
  );
}

/** The code judged and checked, as a dry run answers it. */
interface Judged {
  readonly checked: SiteCodeChecked;
  readonly entries: { head: SiteCodeEntry[]; body: SiteCodeEntry[] };
  readonly findings: number;
}

/**
 * The site's own origin, which `'self'` and site paths stand for: the
 * origin the editor's request came from, which is the site's, the admin
 * being served from it.
 */
function siteOriginOf(req: Request): string {
  return req.headers.get("origin") ?? new URL(req.url).origin;
}

/** The code sanitised and checked against each policy known. */
async function judge(
  body: SiteCodeBodyValue,
  req: Request,
  options: PageBuilderSiteCodeOptions | undefined
): Promise<Judged> {
  const head = sanitiseSiteCode(body.head, "head");
  const bodyEnd = sanitiseSiteCode(body.body, "body");
  const entries = { head: [...head.entries], body: [...bodyEnd.entries] };
  const csp = await policyChecks(entries, body, siteOriginOf(req), options);
  const findings = findingsOf(csp);
  return {
    checked: {
      head: slotJudged(head),
      body: slotJudged(bodyEnd),
      csp,
      // The key names exactly these findings, so an acknowledgement given
      // for one set never covers another.
      cspKey:
        findings.length === 0 ? null : await cspHash(JSON.stringify(findings)),
    },
    entries,
    findings: findings.length,
  };
}

/** Refuse a save of code that can't be stored, or a policy finding unseen. */
function refuseUnsaveable(judged: Judged, body: SiteCodeBodyValue): void {
  const errors = [
    ...judged.checked.head.refusals.map(message => ({
      path: "head",
      code: "SITE_CODE_REFUSED",
      message,
    })),
    ...judged.checked.body.refusals.map(message => ({
      path: "body",
      code: "SITE_CODE_REFUSED",
      message,
    })),
  ];
  const { cspKey } = judged.checked;
  if (cspKey !== null && body.acknowledgeCsp !== cspKey) {
    errors.push({
      path: "acknowledgeCsp",
      code: "SITE_CODE_BLOCKED_BY_CSP",
      message:
        "The site's Content Security Policy would block some of this code. Check it again, and save it only once you have seen what is blocked.",
    });
  }
  if (errors.length > 0) throw NextlyError.validation({ errors });
}

/** The origins the code loads scripts from, as one audit value. */
function scriptOriginsOf(facts: SiteCodeFacts): string {
  const origins = new Set<string>();
  for (const load of facts.loads) {
    if (load.kind !== "script") continue;
    try {
      origins.add(new URL(load.url, facts.siteOrigin).origin);
    } catch {
      // A URL the rules let through is always readable against the site.
    }
  }
  const listed = [...origins].join(",");
  return listed.length <= AUDIT_STRING_LIMIT
    ? listed
    : `${origins.size} origins`;
}

/** What a save's audit row holds. */
async function auditMetadata(
  body: SiteCodeBodyValue,
  before: Record<string, unknown> | null,
  judged: Judged,
  siteOrigin: string
): Promise<Record<string, string | number | boolean>> {
  const all = [...judged.entries.head, ...judged.entries.body];
  const facts = await siteCodeFacts(all, siteOrigin);
  return {
    headSha256: await sha256Hex(body.head),
    headSha256Before: await sha256Hex(textOf(before, "headSource")),
    bodySha256: await sha256Hex(body.body),
    bodySha256Before: await sha256Hex(textOf(before, "bodySource")),
    headChars: body.head.length,
    bodyChars: body.body.length,
    elements: all.length,
    // Counted from the code's own entries: the loader is not the site's code.
    inlineScripts: all.filter(
      entry =>
        entry.tag === "script" &&
        entry.attrs.src === undefined &&
        siteCodeScriptKind(entry.attrs.type) !== "data"
    ).length,
    externalScripts: all.filter(
      entry => entry.tag === "script" && entry.attrs.src !== undefined
    ).length,
    scriptOrigins: scriptOriginsOf(facts),
    cspFindings: judged.findings,
    cspOverridden: judged.findings > 0,
  };
}

/** Whether a stored document holds any site code. */
function holdsCode(doc: Record<string, unknown> | null): boolean {
  return textOf(doc, "headSource") !== "" || textOf(doc, "bodySource") !== "";
}

/**
 * The write's data with the version it was made from. A save names the
 * version it read. One that names none says it read none stored: it is made
 * against the version of the Single as it is now, created empty if missing,
 * and refused when code is stored by then. Two such saves at once are made
 * against the same version, so the second is refused as stale rather than
 * replacing the first.
 */
async function versionedWrite(
  data: Record<string, unknown>,
  version: string | undefined,
  nextly: SiteCodeDirectApi,
  ctx: SiteCodeRouteContext
): Promise<Record<string, unknown>> {
  if (version !== undefined) return withVersionFrom(data, version);
  const now = await nextly.findSingle({
    slug: slugOf(ctx),
    depth: 0,
    overrideAccess: true,
    createIfMissing: true,
    user: undefined,
    req: undefined,
  });
  if (holdsCode(now)) {
    throw NextlyError.validation({
      errors: [
        {
          path: "version",
          code: "VERSION_REQUIRED",
          message:
            "Site code is already saved: read it again, and save naming the version you read.",
        },
      ],
    });
  }
  // A server that issues no versions has none to be stale against.
  const current = documentVersionOf(now);
  return current === undefined
    ? asOverwrite(data)
    : withVersionFrom(data, current);
}

/** Parse a request's body, refusing one that is not a site code request. */
async function bodyOf(req: Request): Promise<SiteCodeBodyValue> {
  const parsed = SiteCodeBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    throw NextlyError.validation({
      errors: parsed.error.issues.map(issue => ({
        path: issue.path.join(".") || "body",
        code: "INVALID_VALUE",
        message: issue.message,
      })),
    });
  }
  return parsed.data;
}

/**
 * Check the site's code, or save it. The preconditions run first, before
 * anything is read or written: a person, not a key, and a valid request.
 */
async function changeSiteCode(
  req: Request,
  ctx: SiteCodeRouteContext,
  deps: SiteCodeRouteDeps
): Promise<Response> {
  if (ctx.caller?.authMethod !== "session" || ctx.user === null) {
    throw NextlyError.personOnly({
      doing: "change the site's code",
      logContext: { reason: "site-code-api-key" },
    });
  }
  const userId = ctx.user.id;
  const body = await bodyOf(req);
  const judged = await judge(body, req, deps.options);
  if (body.dryRun === true) {
    return respondMutation<SiteCodeChecked>(
      "Nothing was saved: this is what the site code comes to.",
      judged.checked
    );
  }
  refuseUnsaveable(judged, body);
  const nextly = await deps.nextly();
  const before = await readStored(nextly, ctx);
  const saved = await nextly.updateSingle({
    slug: slugOf(ctx),
    data: await versionedWrite(
      {
        headSource: body.head,
        bodySource: body.body,
        head: judged.entries.head,
        body: judged.entries.body,
        changedBy: `user:${userId}`,
      },
      body.version,
      nextly,
      ctx
    ),
    overrideAccess: true,
    context: { ...SITE_CODE_WRITE_CONTEXT },
    user: { id: userId },
  });
  await ctx.audit?.write({
    kind: SITE_CODE_SAVED_AUDIT,
    actorUserId: userId,
    request: req,
    metadata: await auditMetadata(body, before, judged, siteOriginOf(req)),
  });
  return respondMutation<SiteCodeSaved>(
    "The site code was saved. It runs on every published page.",
    // The version this write made, from its own answer: a read made after it
    // could already be someone else's save.
    { ...judged.checked, version: documentVersionOf(saved) ?? null }
  );
}

/** The site code routes: read, and check or save. */
export function siteCodeRoutes(deps: SiteCodeRouteDeps): PluginRoute[] {
  return [
    {
      method: "GET",
      path: SITE_CODE_ROUTE_PATH,
      requiredPermission: deps.permission,
      handler: (_req, ctx) => readSiteCode(ctx, deps),
    },
    {
      method: "POST",
      path: SITE_CODE_ROUTE_PATH,
      requiredPermission: deps.permission,
      handler: (req, ctx) => changeSiteCode(req, ctx, deps),
    },
  ];
}
