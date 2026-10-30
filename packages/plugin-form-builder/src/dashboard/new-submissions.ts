/**
 * What the New form submissions card and its header part read: the
 * submissions whose status is "new", on the forms the reader may read, newest
 * first, each made into the row the card draws.
 *
 * Every read goes through the services a widget's `load`, `shows` and
 * `summary.count` are handed, which core binds to the reader, so nothing here
 * reads as the system. The card's total and the header's count come from one
 * filter (`newSubmissionsWhere`), so the two cannot disagree.
 *
 * Reads the collections by their declared slugs: core renames a plugin's own
 * collections on the way in, for a site that renamed them.
 *
 * @module dashboard/new-submissions
 */

import type { WidgetReadServices } from "nextly";

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
const NEW_STATUS = "new";

/** The admin's root, which a row's link and the list's link start from. */
const ADMIN_ROOT = "/admin";

/** The most forms one read answers, the widget reads' own cap. */
const FORM_PAGE = 50;

/**
 * The most pages of forms read for the filter: 1,000 forms. Past that, the
 * later forms' submissions are left out of the card and the count, never
 * shown: what is missed is a reader's own, not someone else's.
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

/** Field names and labels that mark a form's name field, compared as letters only. */
const NAME_KEYS: ReadonlySet<string> = new Set([
  "name",
  "fullname",
  "yourname",
]);

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

/**
 * The ids of every form the reader may read, in pages of `FORM_PAGE`, by id.
 * A form a read rule keeps from them is never among them.
 */
export async function readableFormIds(
  services: Pick<WidgetReadServices, "find">,
  forms: string,
  signal?: AbortSignal
): Promise<string[]> {
  const ids: string[] = [];
  let after: string | undefined;
  for (let page = 0; page < MAX_FORM_PAGES; page += 1) {
    const { items } = await services.find(forms, {
      ...(after === undefined
        ? {}
        : { where: { id: { greater_than: after } } }),
      sort: "id",
      limit: FORM_PAGE,
      select: ["id"],
      status: "all",
      ...(signal === undefined ? {} : { signal }),
    });
    const pageIds = items.flatMap(item =>
      typeof item.id === "string" ? [item.id] : []
    );
    ids.push(...pageIds);
    after = pageIds.at(-1);
    if (items.length < FORM_PAGE || after === undefined) break;
  }
  return ids;
}

/** The new submissions of the forms named: what the card lists and the header counts. */
export function newSubmissionsWhere(formIds: readonly string[]): {
  status: { equals: string };
  form: { in: string[] };
} {
  return { status: { equals: NEW_STATUS }, form: { in: [...formIds] } };
}

/** How many new submissions the reader may read: the header's count. */
export async function countNewSubmissions(
  services: Pick<WidgetReadServices, "find" | "count">,
  collections: SubmissionsCollections,
  signal?: AbortSignal
): Promise<number> {
  const formIds = await readableFormIds(services, collections.forms, signal);
  if (formIds.length === 0) return 0;
  return services.count(collections.submissions, {
    where: newSubmissionsWhere(formIds),
    status: "all",
    ...(signal === undefined ? {} : { signal }),
  });
}

/** The card's data: the newest new submissions the card holds, and how many there are. */
export async function readNewSubmissions(
  services: Pick<WidgetReadServices, "find">,
  collections: SubmissionsCollections,
  read: NewSubmissionsRead
): Promise<NewSubmissionsData> {
  const signal = read.signal === undefined ? {} : { signal: read.signal };
  const allHref = `${ADMIN_ROOT}/collections/${read.submissionsPath}`;
  const formIds = await readableFormIds(
    services,
    collections.forms,
    read.signal
  );
  if (formIds.length === 0) return { items: [], total: 0, allHref };
  const found = await services.find(collections.submissions, {
    where: newSubmissionsWhere(formIds),
    sort: "-submittedAt",
    limit: read.limit,
    select: SUBMISSION_FIELDS,
    status: "all",
    total: true,
    ...signal,
  });
  const forms = await formsOf(services, collections.forms, found.items, signal);
  return {
    items: found.items.map(item =>
      submissionRow(item, forms.get(formIdOf(item.form) ?? ""), allHref)
    ),
    total: found.total ?? found.items.length,
    ...(found.atLeast === true ? { atLeast: true as const } : {}),
    allHref,
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

/** The first line of a text answer, trimmed, or `undefined` for none. */
export function firstLine(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value
    .split(/\r?\n/)
    .map(part => part.trim())
    .find(part => part !== "");
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
