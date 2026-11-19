/**
 * A page's own code (`settings.code`), judged on the server on every write
 * that changes it, whatever the editor checked first.
 *
 * Code a page adds runs on the published page as site code does, so it is
 * held to exactly site code's rules: the person making the write must be
 * able to change the site's settings, an API key may never change it, what
 * the sanitiser can't store is refused by name, and code the site's declared
 * security policy would block is kept only where the author acknowledged
 * exactly those findings. A write that leaves the code as either stored form
 * holds it (a publish, a save of other changes) asks none of this.
 *
 * @module fields/page-code-judgement
 */
import { isPlainRecord } from "@nextlyhq/blocks-engine";
import type {
  PluginFieldIssue,
  PluginFieldValidateArgs,
} from "@nextlyhq/plugin-sdk";

import { formsChangedBy } from "../component-cycle-guard";
import {
  pageCodeOf,
  samePageCode,
  type HeldPageCode,
} from "../site-code/page-code";
import { judgeCode, type PageBuilderSiteCodeOptions } from "../site-code/route";

import type { JudgedField, StoredForms } from "./added-undefined-ids";
import { readStoredForms } from "./lock-baselines";

/** The issue code a refused change to page code carries. */
export const PAGE_CODE_REFUSED = "PAGE_CODE_REFUSED";

/** The permission a change to page code asks for: the site settings one. */
const PAGE_CODE_PERMISSION = {
  action: "manage",
  resource: "page-builder-site",
} as const;

/** What judging page code needs beyond the write. */
export interface PageCodeJudgeDeps {
  /** How the site declared its security policy, as site code reads it. */
  readonly options: PageBuilderSiteCodeOptions | undefined;
  /** The site's own origin, which `'self'` and site paths stand for. */
  readonly siteOrigin: () => string;
}

/**
 * Whether the write changes the page's code: whether it holds code other than
 * what either stored form holds. A stored value that can't be read counts as
 * a change, so a write that might add or remove code is judged rather than
 * let through.
 */
async function changesCode(
  written: HeldPageCode | null,
  stored: () => Promise<StoredForms>
): Promise<boolean> {
  const forms = await stored();
  if (!forms.readable) return true;
  const held = forms.forms.map(form => pageCodeOf(form));
  // A new page holds nothing yet: no code is no change.
  if (held.length === 0) return written !== null;
  return !held.some(code => samePageCode(code, written));
}

/**
 * The stored forms a write's code and CSS are compared with: the ones it
 * changes, as the reference check reads them (`formsChangedBy`). A
 * draft-only save is compared with the draft alone, so it can't put the
 * published code back over the draft's own unasked; a publish with both, so
 * promoting an approved draft asks nothing.
 */
export function changedFormsBaseline(
  args: JudgedField & Pick<PluginFieldValidateArgs, "data">
): () => Promise<StoredForms> {
  const status = (args.data as { status?: unknown } | undefined)?.status;
  return () =>
    readStoredForms(
      args.write,
      args.path,
      formsChangedBy(typeof status === "string" ? status : undefined),
      (args.field as { localized?: unknown } | undefined)?.localized === true
    );
}

/** Whether a blocks value is a page's, the one kind that keeps code. */
function isPage(value: unknown): boolean {
  if (typeof value === "string") {
    try {
      return isPage(JSON.parse(value) as unknown);
    } catch {
      return false;
    }
  }
  return isPlainRecord(value) && value.kind === "page";
}

/**
 * Whether the field is a page's own top-level field: no group, no row, and
 * not a field-group instance's, which is judged at the top of the instance.
 */
export function isTopLevel(args: JudgedField): boolean {
  if (args.write?.inFieldGroup === true) return false;
  return !args.path.includes(".") && !args.path.includes("[");
}

/** A refusal, at the field's path. */
function refusal(args: JudgedField, message: string): PluginFieldIssue {
  return { path: args.path, code: PAGE_CODE_REFUSED, message };
}

/** What a refused caller is told, for each reason. */
export interface CallerRefusalWords {
  /** The write doesn't say who is making it. */
  readonly nobody: string;
  /** It is made with an API key. */
  readonly apiKey: string;
  /** The person can't change the site's settings. */
  readonly notPermitted: string;
}

/**
 * Whether the write's caller may change what runs or draws on every visit
 * to a published page (page code, custom CSS): a person (or trusted code),
 * never an API key, holding the site settings permission. Answers the
 * refusal's words, or null where the caller may.
 */
export async function siteSettingsCallerRefusal(
  args: JudgedField,
  words: CallerRefusalWords
): Promise<string | null> {
  const caller = args.write?.caller;
  if (caller === undefined) return words.nobody;
  if (caller.kind === "apiKey") return words.apiKey;
  const may = await caller.can(
    PAGE_CODE_PERMISSION.action,
    PAGE_CODE_PERMISSION.resource
  );
  return may ? null : words.notPermitted;
}

/** What a caller refused a change to page code is told. */
const PAGE_CODE_CALLER_WORDS: CallerRefusalWords = {
  nobody:
    "This page's code can't be changed here: the write doesn't say who is making it.",
  apiKey:
    "An API key can't change a page's code. Sign in as someone who can change the site's settings.",
  notPermitted:
    "Only people who can change site settings can change a page's code.",
};

/**
 * The issues a write's page code raises: none where it leaves the code as
 * stored; otherwise who may change it, then what can't be stored, then what
 * the site's declared policy would block and was not acknowledged.
 */
export async function pageCodeIssues(
  value: unknown,
  args: JudgedField,
  label: string,
  /** Absent before the plugin's setup is installed: a change is refused. */
  deps: PageCodeJudgeDeps | undefined,
  stored: () => Promise<StoredForms>
): Promise<PluginFieldIssue[]> {
  const written = pageCodeOf(value);
  // Only a page's own top-level blocks field keeps code: one inside a group,
  // a repeater's row or a field-group instance could lose it to a write that
  // clears the group or drops the row or the instance, which no check of
  // this field sees, so none may hold any.
  if (!isTopLevel(args)) {
    return written === null
      ? []
      : [
          refusal(
            args,
            `${label}: page code is kept only on a page's own Page Builder field, at the top of the page, not inside a group, a list or a field group.`
          ),
        ];
  }
  // Only a page keeps code of its own: a collection template's, a saved
  // section's or a component's would run on every page drawn from it.
  if (written !== null && !isPage(value)) {
    return [
      refusal(
        args,
        `${label}: only a page keeps code of its own, not a collection template, a saved section or a component.`
      ),
    ];
  }
  if (!(await changesCode(written, stored))) return [];
  // The caller first, before anything about the code is read out.
  const refused = await siteSettingsCallerRefusal(args, PAGE_CODE_CALLER_WORDS);
  if (refused !== null) return [refusal(args, `${label}: ${refused}`)];
  // Before the plugin's setup is installed (a dev server's config reload
  // builds the field again), the site's policy isn't known to judge by.
  if (deps === undefined) {
    return [
      refusal(
        args,
        `${label}: this page's code can't be checked until the site has finished starting. Try again in a moment.`
      ),
    ];
  }
  if (written === null) return [];
  const judged = await judgeCode(
    { head: written.head, body: written.body },
    deps.siteOrigin(),
    deps.options,
    // Checked as the page's own, started by its own loader at the end of
    // the body, as the Code tab checks it.
    "page"
  );
  const issues = [
    ...judged.checked.head.refusals.map(message =>
      refusal(args, `${label} (head): ${message}`)
    ),
    ...judged.checked.body.refusals.map(message =>
      refusal(args, `${label} (end of body): ${message}`)
    ),
  ];
  const { cspKey } = judged.checked;
  if (cspKey !== null && written.acknowledgedCsp !== cspKey) {
    issues.push(
      refusal(
        args,
        `${label}: the site's Content Security Policy would block some of this page's code. Check it again, and save it only once you have seen what is blocked.`
      )
    );
  }
  return issues;
}
