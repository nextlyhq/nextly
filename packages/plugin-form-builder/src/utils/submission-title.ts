/**
 * Who sent a submission, as the admin names it: the first answer to a text
 * field named or labelled as a name, else the first email address answered,
 * else none. One rule, read by the write seam (which keeps it as the
 * submission's title, the admin's breadcrumb and list name) and by the
 * submission's page.
 *
 * @module utils/submission-title
 */

/**
 * The longest title kept, in characters. The title is a display copy of an
 * answer, stored as a text column, which MySQL holds to 255 characters; an
 * answer has no such limit, so a longer one is shortened here rather than
 * refusing the submission it names.
 */
const TITLE_MAX = 200;

/**
 * The title a submission is stored with: who sent it, shortened to
 * TITLE_MAX characters with an ellipsis, or none.
 */
export function submissionTitleOf(
  fields: readonly NamedField[],
  data: Record<string, unknown>
): string | undefined {
  const sender = senderOf(fields, data);
  if (sender === undefined) return undefined;
  // By code point, so a character outside the basic plane is never split.
  const characters = Array.from(sender);
  return characters.length <= TITLE_MAX
    ? sender
    : `${characters
        .slice(0, TITLE_MAX - 1)
        .join("")
        .trimEnd()}…`;
}

/** A field as this needs it: its name, label and type. */
interface NamedField {
  name: string;
  label?: string;
  type: string;
}

export function senderOf(
  fields: readonly NamedField[],
  data: Record<string, unknown>
): string | undefined {
  const answer = (name: string) => {
    const value = data[name];
    return typeof value === "string" ? value.trim() : "";
  };
  const named = fields.find(
    field =>
      field.type === "text" &&
      /name/i.test(`${field.name} ${field.label ?? ""}`) &&
      answer(field.name)
  );
  if (named) return answer(named.name);
  const email = fields.find(
    field => field.type === "email" && answer(field.name)
  );
  return email ? answer(email.name) : undefined;
}
