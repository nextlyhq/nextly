/**
 * The two emails a form sends out of the box: one to the team, listing every
 * answer, and one confirming to the visitor that their submission arrived.
 *
 * A notification sends only with a message from Settings › Email, so without
 * these every new notification started unsendable and every new form sent
 * nothing until someone wrote an email for it. Registering them as the plugin's
 * own messages means a new notification has one to use from the start, while
 * a site still edits their wording and design in the Email hub like any other
 * message, where every email it sends lives.
 *
 * The bodies are Liquid: they loop over `_submission.answers`, the
 * submission's answers by label, built by `buildNotificationEmails`. Every value is escaped by the
 * engine, so an answer can never be read as markup.
 */
import type { PluginEmailTemplate } from "@nextlyhq/plugin-sdk";

import type { FormNotification } from "../types";

/** The team's email: every answer, so the inbox has the whole submission. */
export const FORM_SUBMISSION_TEMPLATE = "forms-submission";

/** The visitor's email: confirms the submission arrived, with a copy. */
export const FORM_CONFIRMATION_TEMPLATE = "forms-confirmation";

/** The answers as a two-column table, label then value, one row each. */
const ANSWERS_TABLE =
  `<table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%; border-collapse: collapse;">` +
  `{% for answer in _submission.answers %}<tr>` +
  `<td style="width: 40%; padding: 8px 16px 8px 0; vertical-align: top; font-weight: 600; overflow-wrap: anywhere;">{{ answer.label }}</td>` +
  `<td style="padding: 8px 0; vertical-align: top; overflow-wrap: anywhere;">{{ answer.value }}</td>` +
  `</tr>{% endfor %}</table>`;

/**
 * Shown where the table would be when no answer list was sent: the Email hub's
 * preview and Send test, whose sample data has a placeholder string for each
 * variable. A real send always carries a list, even an empty one, which
 * Liquid treats as present, so a sent email never shows this line.
 */
const PREVIEW_NOTE = `{% unless _submission.answers %}<p><em>Each answer appears here, its question then what was answered.</em></p>{% endunless %}`;

/** The answers as plain text, one per line, for mail clients that show text. */
const ANSWERS_TEXT = `{% for answer in _submission.answers %}{{ answer.label }}: {{ answer.value }}\n{% endfor %}`;

/** The variables both messages are sent with, as the Email hub lists them. */
const VARIABLES = [
  { name: "formName", description: "The form's name", required: true },
  {
    name: "_submission",
    description:
      "The submission: `_submission.answers` holds each answer as `label` and `value`, in the form's order, leaving out questions left blank or hidden by a condition; `_submission.id` is its id. It starts with an underscore, which no form field's name may, so it never meets a submitted field of the same name",
    required: true,
  },
];

/** The messages the plugin contributes to Settings › Email. */
export function formsEmailTemplates(): PluginEmailTemplate[] {
  return [
    {
      slug: FORM_SUBMISSION_TEMPLATE,
      name: "Form submission",
      description:
        "Sent to your team when someone submits a form, with every answer.",
      subject: "New submission: {{ formName }}",
      htmlContent: `<p>Someone submitted <strong>{{ formName }}</strong>.</p>${ANSWERS_TABLE}${PREVIEW_NOTE}`,
      plainTextContent: `Someone submitted {{ formName }}.\n\n${ANSWERS_TEXT}`,
      variables: VARIABLES,
      engine: "liquid",
    },
    {
      slug: FORM_CONFIRMATION_TEMPLATE,
      name: "Form confirmation",
      description:
        "Sent to the person who submitted a form, confirming it arrived, with a copy of their answers.",
      subject: "We received your submission",
      htmlContent:
        `<p>Thank you. We received your answers to <strong>{{ formName }}</strong> and will be in touch if we need anything else.</p>` +
        `<p>Here is a copy of what you sent:</p>${ANSWERS_TABLE}${PREVIEW_NOTE}`,
      plainTextContent:
        `Thank you. We received your answers to {{ formName }} and will be in touch if we need anything else.\n\n` +
        `Here is a copy of what you sent:\n\n${ANSWERS_TEXT}`,
      variables: VARIABLES,
      engine: "liquid",
    },
  ];
}

/**
 * The starter message for a notification's kind: the confirmation when it goes
 * to the visitor (the address in one of the form's fields), the team's email
 * otherwise.
 */
export function starterTemplateFor(
  recipientType: FormNotification["recipientType"]
): string {
  return recipientType === "field"
    ? FORM_CONFIRMATION_TEMPLATE
    : FORM_SUBMISSION_TEMPLATE;
}
