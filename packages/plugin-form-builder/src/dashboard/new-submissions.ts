/**
 * What the New form submissions card and its header part read: the
 * submissions whose status is "new", on the forms the reader may read, newest
 * first, each made into the row the card draws.
 *
 * Every read goes through the services a widget's `load`, `shows` and
 * `summary.count` are handed, which core binds to the reader, so nothing here
 * reads as the system. The header's count is the card's own read asked for no
 * rows (`readNewSubmissions` with a `limit` of 0), so the two cannot disagree.
 *
 * Reads the collections by their declared slugs: core renames a plugin's own
 * collections on the way in, for a site that renamed them.
 *
 * @module dashboard/new-submissions
 */

import type { WidgetReadServices } from "@nextlyhq/plugin-sdk";

/** The widget's id, the one core's default names. */
export const NEW_SUBMISSIONS_WIDGET_ID = "form-builder/new-submissions";

/** The collections the card reads, as the plugin declares and installs them. */
export interface SubmissionsCollections {
  /** The forms collection's slug. */
  forms: string;
  /** The submissions collection's slug. */
  submissions: string;
}

/** One new submission, as the card draws it. */
export interface NewSubmissionRow {
  id: string;
  /** The submitter's name or email, or "Submission" where the form has neither answered. */
  title: string;
  /** The form's name, where the reader may read it. */
  form?: string;
  /** The first line of the first text answer not already the title. */
  excerpt?: string;
  /** When it was submitted, as an ISO string. */
  at?: string;
  /** The submission, in the admin. */
  href: string;
}

/** The card's data: the rows its size holds, how many new submissions there are, and their list. */
export interface NewSubmissionsData {
  items: NewSubmissionRow[];
  /** How many new submissions the reader may read, in all. */
  total: number;
  /** `total` is a floor: there are at least this many. */
  atLeast?: true;
  /** Every submission, in the admin. */
  allHref: string;
  /**
   * The submissions collection's slug as the site installed it, the one a
   * row is marked read in when it is opened.
   */
  collection: string;
}

/** What a read is asked with beyond its collections. */
export interface NewSubmissionsRead {
  /** The most rows the card draws. */
  limit: number;
  signal?: AbortSignal;
  /** The submissions slug the admin knows them by: the site's, where it renamed it. */
  submissionsPath: string;
}

/** The status a submission arrives with, and keeps until someone opens it. */
export const NEW_STATUS = "new";

/** The admin's root, which a row's link and the list's link start from. */
const ADMIN_ROOT = "/admin";

/** The most forms one read answers, the widget reads' own cap. */
const FORM_PAGE = 50;

/**
 * The most pages of forms read for the filter: 1,000 forms. Past that, the
 * later forms' submissions are left out of the card and the count, never
 * shown: what is missed is a reader's own, not someone else's. The count then
 * says it is a floor (`atLeast`), so nobody reads it as every one.
 */
const MAX_FORM_PAGES = 20;

/** The submission fields a row is made from; no other is asked for. */
const SUBMISSION_FIELDS = [
  "id",
  "form",
  "data",
  "submittedAt",
  "createdAt",
] as const;

/** The form fields a row is made from. */
const FORM_FIELDS = ["id", "name", "fields"] as const;

/**
 * Field names and labels that mark a form's name field, compared as letters
 * only (`lettersOf`), so case, spaces, underscores, hyphens and camelCase do
 * not matter: `firstName`, `first_name` and "First name" are all "firstname".
 */
const NAME_KEYS: ReadonlySet<string> = new Set([
  "name",
  "fullname",
  "firstname",
  "yourname",
  "yourfullname",
  "yourfirstname",
]);

/**
 * The most characters of an answer or a name a row carries. A form may leave
 * a field's length open, so a visitor's answer can be any length; the card
 * draws one line, and the rest would only weigh down its data and the page.
 */
const MAX_ROW_TEXT = 140;

/** The answer types whose first line a row may show under its title. */
const TEXT_TYPES: ReadonlySet<string> = new Set(["text", "textarea"]);

/** One row a read service answered. */
type Row = { readonly [field: string]: unknown };

/** One field of a form, as far as a row reads it. */
interface FormFieldShape {
  type: string;
  name: string;
  label?: string;
}

/** The forms the reader may read, by id, and whether that is every one of them. */
export interface ReadableForms {
  ids: string[];
  /** `false` when the scan stopped at its budget with forms still unread. */
  complete: boolean;
}

/** Up to `limit` ids of forms the reader may read, by id, after `after`. */
async function formIdPage(
  services: Pick<WidgetReadServices, "find">,
  forms: string,
  page: { after: string | undefined; limit: number; signal?: AbortSignal }
): Promise<string[]> {
  const { items } = await services.find(forms, {
    ...(page.after === undefined
      ? {}
      : { where: { id: { greater_than: page.after } } }),
    sort: "id",
    limit: page.limit,
    select: ["id"],
    status: "all",
    ...(page.signal === undefined ? {} : { signal: page.signal }),
  });
  return items.flatMap(item => (typeof item.id === "string" ? [item.id] : []));
}

/**
 * The ids of the forms the reader may read, in pages of `FORM_PAGE`, by id,
 * at most `MAX_FORM_PAGES` of them. A form a read rule keeps from them is
 * never among them. Where the budget is spent, one more id says whether any
 * form was left out.
 */
export async function readableFormIds(
  services: Pick<WidgetReadServices, "find">,
  forms: string,
  signal?: AbortSignal
): Promise<ReadableForms> {
  const ids: string[] = [];
  let after: string | undefined;
  for (let page = 0; page < MAX_FORM_PAGES; page += 1) {
    const pageIds = await formIdPage(services, forms, {
      after,
      limit: FORM_PAGE,
      signal,
    });
    ids.push(...pageIds);
    after = pageIds.at(-1);
    if (pageIds.length < FORM_PAGE) return { ids, complete: true };
  }
  const beyond = await formIdPage(services, forms, { after, limit: 1, signal });
  return { ids, complete: beyond.length === 0 };
}

/** The new submissions of the forms named: what the card lists and the header counts. */
function newSubmissionsWhere(formIds: readonly string[]): {
  status: { equals: string };
  form: { in: string[] };
} {
  return { status: { equals: NEW_STATUS }, form: { in: [...formIds] } };
}

/**
 * The card's data: the newest new submissions the card holds, and how many
 * there are. Asked with a `limit` of 0 it reads no rows and still counts
 * them, which is the header's count.
 */
export async function readNewSubmissions(
  services: Pick<WidgetReadServices, "find">,
  collections: SubmissionsCollections,
  read: NewSubmissionsRead
): Promise<NewSubmissionsData> {
  const signal = read.signal === undefined ? {} : { signal: read.signal };
  const allHref = `${ADMIN_ROOT}/collections/${read.submissionsPath}`;
  const collection = read.submissionsPath;
  const readable = await readableFormIds(
    services,
    collections.forms,
    read.signal
  );
  if (readable.ids.length === 0) {
    return { items: [], total: 0, allHref, collection };
  }
  const found = await services.find(collections.submissions, {
    where: newSubmissionsWhere(readable.ids),
    sort: "-submittedAt",
    limit: read.limit,
    select: SUBMISSION_FIELDS,
    status: "all",
    total: true,
    // Each row's form as the id it stores: the forms drawn are read once,
    // below, so expanding them here would read them twice.
    depth: 0,
    ...signal,
  });
  const forms = await formsOf(services, collections.forms, found.items, signal);
  return {
    items: found.items.map(item =>
      submissionRow(item, forms.get(formIdOf(item.form) ?? ""), allHref)
    ),
    total: found.total ?? found.items.length,
    // A floor where the read counted only so far, or where forms past the
    // scan's budget were left out of it.
    ...(found.atLeast === true || !readable.complete
      ? { atLeast: true as const }
      : {}),
    allHref,
    collection,
  };
}

/** The forms of the submissions drawn, by id: one read, of those forms only. */
async function formsOf(
  services: Pick<WidgetReadServices, "find">,
  forms: string,
  submissions: readonly Row[],
  signal: { signal?: AbortSignal }
): Promise<ReadonlyMap<string, Row>> {
  const ids = [
    ...new Set(submissions.flatMap(row => formIdOf(row.form) ?? [])),
  ];
  if (ids.length === 0) return new Map();
  const { items } = await services.find(forms, {
    where: { id: { in: ids } },
    limit: ids.length,
    select: FORM_FIELDS,
    status: "all",
    ...signal,
  });
  return new Map(
    items.flatMap((item): [string, Row][] =>
      typeof item.id === "string" ? [[item.id, item]] : []
    )
  );
}

/**
 * One submission as its row: who sent it, which form and what it opens with,
 * and when. `form` is absent where the reader may not read it, and every value
 * comes from a field the read answered, so a field kept from the reader is a
 * part of the row left out, never guessed.
 */
export function submissionRow(
  submission: Row,
  form: Row | undefined,
  allHref: string
): NewSubmissionRow {
  const id = typeof submission.id === "string" ? submission.id : "";
  const answers = recordOf(submission.data);
  const fields = fieldsOf(form?.fields);
  const nameField = fields.find(isNameField);
  const emailField = fields.find(field => field.type === "email");
  const titleField = [nameField, emailField].find(
    field => field !== undefined && firstLine(answers[field.name]) !== undefined
  );
  const title =
    titleField === undefined ? undefined : firstLine(answers[titleField.name]);
  const excerpt = fields
    .filter(field => TEXT_TYPES.has(field.type) && field !== titleField)
    .map(field => firstLine(answers[field.name]))
    .find(line => line !== undefined);
  const formName = firstLine(form?.name);
  const at =
    instantOf(submission.submittedAt) ?? instantOf(submission.createdAt);
  return {
    id,
    title: title ?? "Submission",
    ...(formName === undefined ? {} : { form: formName }),
    ...(excerpt === undefined ? {} : { excerpt }),
    ...(at === undefined ? {} : { at }),
    href: `${allHref}/${encodeURIComponent(id)}`,
  };
}

/** Whether a form field asks for the submitter's name, by its name or its label. */
function isNameField(field: FormFieldShape): boolean {
  return (
    field.type === "text" &&
    (NAME_KEYS.has(lettersOf(field.name)) ||
      NAME_KEYS.has(lettersOf(field.label ?? "")))
  );
}

/** A name or label as its letters alone, lower case: "Full name" is "fullname". */
function lettersOf(text: string): string {
  return text.toLowerCase().replace(/[^a-z]/g, "");
}

/**
 * The first line of a text answer, trimmed and held to `MAX_ROW_TEXT`
 * characters, or `undefined` for none.
 */
export function firstLine(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const line = value
    .split(/\r?\n/)
    .map(part => part.trim())
    .find(part => part !== "");
  return line === undefined ? undefined : clipped(line);
}

/**
 * `text` cut to its first `MAX_ROW_TEXT` characters with an ellipsis, where it
 * is longer. Counted in whole characters, so an emoji is never split in two.
 */
function clipped(text: string): string {
  const characters = Array.from(text);
  if (characters.length <= MAX_ROW_TEXT) return text;
  return `${characters.slice(0, MAX_ROW_TEXT).join("").trimEnd()}…`;
}

/** A relationship's id, whether the read answered the id or the related row. */
function formIdOf(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null && "id" in value) {
    const { id } = value;
    return typeof id === "string" ? id : undefined;
  }
  return undefined;
}

/** A JSON column's value, which some dialects answer as its text. */
function parsedJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

/** A submission's answers, by field name. */
function recordOf(value: unknown): Readonly<Record<string, unknown>> {
  const parsed = parsedJson(value);
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

/** A form's fields, as far as a row reads them; any other entry is skipped. */
function fieldsOf(value: unknown): FormFieldShape[] {
  const parsed = parsedJson(value);
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((entry: unknown): FormFieldShape[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const { type, name, label } = entry as Record<string, unknown>;
    if (typeof type !== "string" || typeof name !== "string") return [];
    return [{ type, name, ...(typeof label === "string" ? { label } : {}) }];
  });
}

/** A date as an ISO string, or `undefined` when it is not one. */
function instantOf(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? undefined : at.toISOString();
}
