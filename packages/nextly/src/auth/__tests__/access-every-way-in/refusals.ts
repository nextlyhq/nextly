/**
 * How each refusal in the table is answered, beside whether it is one.
 *
 * `answers-today.txt` records a refused cell's status and nothing else. A
 * refusal also has a code, a body of some shape and a message, and a request
 * naming one entry is answered either as a missing entry would be or
 * differently. Those are recorded here, cell by cell, for the doors that
 * answer with a status, and rendered to `refusals-today.txt`, so a change to
 * how any refusal is answered shows as a diff of that file.
 *
 * The doors run one cell at a time, so one slot holds the cell being asked.
 */
import { NextlyError } from "../../../errors/nextly-error";

/** The body shapes a refusal arrives in. */
export type Shape =
  /** `{ error: { code, message, requestId } }`, the canonical body. */
  | "error"
  /** `{ data: { success: false, statusCode, message, error } }`. */
  | "data"
  /** `{ success: false, error: { code, message } }`. */
  | "limit"
  /** `{ success: false, statusCode, message, error }`. */
  | "bare"
  /** A thrown error, at a door that calls rather than requests. */
  | "thrown"
  /** No body at all. */
  | "empty"
  | "other";

export interface Refusal {
  status: number;
  code: string;
  shape: Shape;
  message: string;
  /**
   * For a request naming one entry: `same` where it was answered exactly as
   * the same request for an entry that does not exist, else that answer.
   */
  missing?: string;
}

let current: Refusal | undefined;

/** Clears the slot before a cell is asked. */
export function beginCell(): void {
  current = undefined;
}

/** The refusal noted while the cell was asked, if any, clearing the slot. */
export function takeRefusal(): Refusal | undefined {
  const noted = current;
  current = undefined;
  return noted;
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

/** What a body carries, apart from the status and the missing comparison. */
type Read = Omit<Refusal, "status" | "missing">;

/** A body carrying nothing a client could read as a refusal. */
const UNREADABLE: Read = { shape: "other", code: "-", message: "" };

/**
 * One shape's reading: its code, and the first of the places that shape puts
 * its message that holds one.
 */
const reads = (shape: Shape, code: unknown, ...message: unknown[]): Read => ({
  shape,
  code: text(code) || "-",
  message: message.map(text).find(found => found !== "") ?? "",
});

/** A body's shape, code and message, as a client reading it would find them. */
function readBody(body: unknown): Read {
  if (body === undefined) return { ...UNREADABLE, shape: "empty" };
  if (!isObject(body)) return UNREADABLE;
  if (isObject(body.error)) {
    const shape = body.success === false ? "limit" : "error";
    return reads(shape, body.error.code, body.error.message);
  }
  if (isObject(body.data) && body.data.success === false) {
    return reads("data", body.data.code, body.data.error, body.data.message);
  }
  if (body.success === false) {
    return reads("bare", body.code, body.error, body.message);
  }
  return UNREADABLE;
}

async function bodyOf(res: Response): Promise<unknown> {
  const raw = await res.clone().text();
  if (raw === "") return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

/** A refusal as one response answers it, or nothing for a success. */
export async function refusalOf(res: Response): Promise<Refusal | undefined> {
  if (res.status < 400) return undefined;
  return { status: res.status, ...readBody(await bodyOf(res)) };
}

/** Notes the response a door answered with, where it is a refusal. */
export async function noteResponse(res: Response): Promise<void> {
  const refusal = await refusalOf(res);
  if (refusal) current = refusal;
}

/** A refusal as a thrown error carries it. */
export function refusalFromError(error: unknown): Refusal {
  const status = (error as { statusCode?: unknown }).statusCode;
  return {
    status: typeof status === "number" ? status : 0,
    code: NextlyError.is(error) ? error.code : "-",
    shape: "thrown",
    message: NextlyError.is(error) ? error.publicMessage : "",
  };
}

/** Notes the error a door's call threw. */
export function noteError(error: unknown): void {
  current = refusalFromError(error);
}

/**
 * Notes an error that reached the door's caller, unless the door already
 * noted it, with what it compared it against.
 */
export function noteUncaught(error: unknown): void {
  if (!current) noteError(error);
}

/** Notes a refusal a door read from a probe's reply. */
export function noteRefusal(refusal: Refusal): void {
  current = refusal;
}

/** The body as compared with a missing entry's: everything but its request id. */
async function comparable(res: Response): Promise<string> {
  const strip = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(strip)
      : isObject(value)
        ? Object.fromEntries(
            Object.entries(value)
              .filter(([key]) => key !== "requestId")
              .map(([key, inner]) => [key, strip(inner)])
          )
        : value;
  return `${res.status} ${JSON.stringify(strip(await bodyOf(res)))}`;
}

/**
 * Notes how the noted refusal compares with the same request for an entry
 * that does not exist: `same`, or that request's own answer.
 */
export async function noteMissing(
  refused: Response,
  missing: Response
): Promise<void> {
  if (!current) return;
  const [a, b] = await Promise.all([comparable(refused), comparable(missing)]);
  if (a === b) {
    current.missing = "same";
    return;
  }
  const answered = await refusalOf(missing);
  current.missing = answered
    ? `${answered.status} ${answered.code}`
    : `${missing.status}`;
}

/**
 * As {@link noteMissing}, from the refusal the same request for an entry that
 * does not exist was answered with: `same` where it matches the noted one,
 * `found` where that request was not refused at all, else its own answer.
 */
export function noteMissingRefusal(answered: Refusal | undefined): void {
  if (!current) return;
  if (!answered) {
    current.missing = "found";
    return;
  }
  current.missing =
    answered.status === current.status &&
    answered.code === current.code &&
    answered.shape === current.shape &&
    answered.message === current.message
      ? "same"
      : `${answered.status} ${answered.code}`;
}

/** As {@link noteMissingRefusal}, for a door that calls and catches. */
export function noteMissingError(missing: unknown): void {
  noteMissingRefusal(
    missing === undefined ? undefined : refusalFromError(missing)
  );
}

/**
 * Whether a refusal's message names something internal: a permission spelled
 * as stored (`update-posts`), or the target's own slug, where the caller's
 * words would be its label.
 */
export function namesInternals(message: string, slug: string): boolean {
  if (
    /\b(create|read|update|delete|publish|unpublish|manage)-[a-z]/.test(message)
  ) {
    return true;
  }
  return slug !== "" && new RegExp(`\\b${slug}\\b`).test(message);
}

/**
 * One refusal as a recorded line: what it is answered for, then its status,
 * code and body shape, whether its message names something internal (judged
 * against `slug`, the target's own, where there is one), how it compares with
 * a missing entry's, and the message. Every file that records refusals writes
 * its lines with this, so all of them read one way.
 */
export function formatRefusal(label: string, r: Refusal, slug = ""): string {
  const leak = namesInternals(r.message, slug) ? " NAMES-INTERNALS" : "";
  const missing = r.missing ? `  missing=${r.missing}` : "";
  return `${label}  ${r.status} ${r.code} ${r.shape}${leak}${missing}  | ${r.message}`;
}

/** The refusals file: one line per refused cell at a door that has a status. */
export function renderRefusals(
  refusals: ReadonlyMap<string, { refusal: Refusal; slug: string }>
): string {
  const lines = [...refusals.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([cell, { refusal, slug }]) => formatRefusal(cell, refusal, slug));
  return `${lines.join("\n")}\n`;
}
