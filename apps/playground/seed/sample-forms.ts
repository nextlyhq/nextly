/**
 * Sample forms and submissions for the playground, so the Forms screens can be
 * reviewed, captured and tested against data that looks like a real site's.
 *
 * ## What it seeds
 *
 * Five forms, chosen so every Forms screen has something to show:
 *
 * - **Contact us**: a short form with a select and a consent checkbox, and the
 *   two spam submissions the Spam tab needs.
 * - **Job application**: a file field (a CV), a phone, a URL, a number, a date
 *   and a radio, so a submission's page shows files and every value kind.
 * - **Meetup sign-up**: questions shown only when another answer allows them,
 *   and a hidden field, so the builder's conditions and Preview have work to do.
 * - **Spring newsletter offer**: closed, with its closed message.
 * - **Customer feedback survey**: a draft, with no submissions.
 *
 * Submissions cover New, Read, Archived and Spam, spread over the last few
 * days, with notes on some, so the list's tabs and filters all have rows.
 *
 * ## Contributor harness only
 *
 * None of this reaches a user's site: `create-nextly-app` templates seed their
 * own content. Addresses use the reserved `example.com` and `.test` domains, so
 * a notification that does go out reaches nobody.
 *
 * ## Idempotent, and never touches a form it did not make
 *
 * A form is matched by its slug and created only when missing, and its sample
 * submissions are written only by the run that created it:
 *
 * - a form that already exists, whoever made it, is left exactly as it is, so
 *   a contributor's own `contact` form never receives sample rows;
 * - two runs that overlap (the dev wrapper's boot and a manual `db:seed`) race
 *   on the form's unique slug, and only the one whose create wins writes the
 *   submissions, so the samples are never doubled.
 *
 * A run stopped part-way leaves its form with some of its samples, and later
 * runs leave that form alone. Delete the form (or run `pnpm db:reset`) to seed
 * it again.
 *
 * ## The notifications send
 *
 * Each enabled notification names the form builder's starter message for its
 * kind ("Form submission" for the team, "Form confirmation" for the visitor),
 * which the plugin registers in Settings › Email, so the samples' emails render
 * on a fresh playground. A closed form is created live and then closed, as an
 * author would close it, so it has a first-published time and the site shows
 * its closed message rather than hiding it as never published.
 *
 * @module seed/sample-forms
 */

/** The collections the form builder plugin registers in the playground. */
export const FORMS_COLLECTION = "forms";
export const SUBMISSIONS_COLLECTION = "form-submissions";

/** The Direct API calls the seed uses, narrowed so a test can stand in. */
export interface SampleFormsStore {
  find(args: {
    collection: string;
    where: Record<string, { equals: unknown }>;
    limit: number;
  }): Promise<{ items: Array<{ id?: unknown }>; meta: { total: number } }>;
  create(args: {
    collection: string;
    data: Record<string, unknown>;
  }): Promise<{ item: { id?: unknown; _rev?: unknown } }>;
  update(args: {
    collection: string;
    id: string;
    data: Record<string, unknown>;
  }): Promise<unknown>;
}

/**
 * The form builder's starter messages, by slug. Written here rather than
 * imported because the plugin does not export them; the slugs are the
 * plugin's published template identifiers.
 */
const TEAM_MESSAGE = "forms-submission";
const VISITOR_MESSAGE = "forms-confirmation";

/** Uploads one file to the Media library and returns its id. */
export type UploadFile = (file: {
  name: string;
  mimetype: string;
  data: Buffer;
}) => Promise<string>;

export interface SampleFormsResult {
  formsCreated: number;
  submissionsCreated: number;
}

type Option = { label: string; value: string };

/** Options whose stored value is the label in kebab case, as the builder makes. */
function options(...labels: string[]): Option[] {
  return labels.map(label => ({
    label,
    value: label.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  }));
}

/** A condition that shows a field only when another field has a value. */
function showWhen(field: string, value: unknown) {
  return {
    enabled: true,
    action: "show",
    operator: "AND",
    conditions: [{ field, comparison: "equals", value }],
  };
}

export const SAMPLE_FORMS = [
  {
    name: "Contact us",
    slug: "contact",
    description: "The main contact form in the site footer and on /contact.",
    status: "published",
    fields: [
      {
        type: "text",
        name: "full_name",
        label: "Full name",
        required: true,
        admin: { width: "50%" },
      },
      {
        type: "email",
        name: "email",
        label: "Email",
        required: true,
        admin: { width: "50%" },
      },
      {
        type: "text",
        name: "company",
        label: "Company",
        admin: { width: "50%" },
      },
      {
        type: "select",
        name: "topic",
        label: "What is it about?",
        required: true,
        options: options("Sales", "Support", "Partnership", "Press"),
        admin: { width: "50%" },
      },
      {
        type: "textarea",
        name: "message",
        label: "Message",
        required: true,
        placeholder: "How can we help?",
      },
      {
        type: "checkbox",
        name: "consent",
        label: "I agree to the privacy policy",
        required: true,
      },
    ],
    settings: {
      submitButtonText: "Send message",
      confirmationType: "message",
      successMessage:
        "Thanks, we got your message and will reply within one working day.",
      allowMultipleSubmissions: true,
      honeypotEnabled: true,
    },
    notifications: [
      {
        id: "contact-team",
        name: "Team inbox",
        enabled: true,
        recipientType: "static",
        templateSlug: TEAM_MESSAGE,
        to: "hello@acme.test",
        cc: [],
        bcc: [],
        replyTo: "{{email}}",
      },
      {
        id: "contact-sales",
        name: "Sales leads",
        enabled: true,
        recipientType: "static",
        templateSlug: TEAM_MESSAGE,
        to: "sales@acme.test",
        cc: [],
        bcc: [],
        replyTo: "{{email}}",
        condition: { field: "topic", comparison: "equals", value: "sales" },
      },
      {
        id: "contact-thanks",
        name: "Thank-you to visitor",
        enabled: false,
        recipientType: "field",
        templateSlug: VISITOR_MESSAGE,
        to: "{{email}}",
        cc: [],
        bcc: [],
      },
    ],
  },
  {
    name: "Job application",
    slug: "job-application",
    description: "Careers page. CVs are attached to the hiring team's email.",
    status: "published",
    fields: [
      {
        type: "text",
        name: "full_name",
        label: "Full name",
        required: true,
        admin: { width: "50%" },
      },
      {
        type: "email",
        name: "email",
        label: "Email",
        required: true,
        admin: { width: "50%" },
      },
      { type: "phone", name: "phone", label: "Phone", admin: { width: "50%" } },
      {
        type: "select",
        name: "role",
        label: "Role",
        required: true,
        options: options(
          "Frontend engineer",
          "Backend engineer",
          "Product designer",
          "Customer success"
        ),
        admin: { width: "50%" },
      },
      {
        type: "url",
        name: "linkedin",
        label: "LinkedIn or portfolio",
        placeholder: "https://",
      },
      {
        type: "number",
        name: "years",
        label: "Years of experience",
        admin: { width: "50%" },
      },
      {
        type: "date",
        name: "start_date",
        label: "Earliest start date",
        admin: { width: "50%" },
      },
      {
        type: "radio",
        name: "relocate",
        label: "Open to relocating?",
        options: options("Yes", "No", "Remote only"),
      },
      {
        type: "file",
        name: "cv",
        label: "CV",
        required: true,
        accept: "application/pdf",
        maxFileSize: 5_000_000,
        attachToEmail: true,
        helpText: "PDF, up to 5 MB",
      },
      {
        type: "textarea",
        name: "cover_letter",
        label: "Why this role?",
        helpText: "A few lines is plenty.",
      },
      {
        type: "checkbox",
        name: "keep_details",
        label: "Keep my details for 12 months for future roles",
      },
    ],
    settings: {
      submitButtonText: "Apply",
      confirmationType: "message",
      successMessage:
        "Thanks for applying. We read every application and will reply within two weeks.",
      allowMultipleSubmissions: false,
      honeypotEnabled: true,
    },
    notifications: [
      {
        id: "jobs-hiring",
        name: "Hiring team",
        enabled: true,
        recipientType: "static",
        templateSlug: TEAM_MESSAGE,
        to: "jobs@acme.test",
        cc: [],
        bcc: ["hr-archive@acme.test"],
        replyTo: "{{email}}",
      },
      {
        id: "jobs-engineering",
        name: "Engineering lead",
        enabled: true,
        recipientType: "static",
        templateSlug: TEAM_MESSAGE,
        to: "eng-lead@acme.test",
        cc: [],
        bcc: [],
        condition: { field: "role", comparison: "contains", value: "engineer" },
      },
    ],
  },
  {
    name: "Meetup sign-up",
    slug: "meetup-signup",
    description:
      "Community meetup. Dietary and guest questions show only when they apply.",
    status: "published",
    fields: [
      {
        type: "text",
        name: "full_name",
        label: "Full name",
        required: true,
        admin: { width: "50%" },
      },
      {
        type: "email",
        name: "email",
        label: "Email",
        required: true,
        admin: { width: "50%" },
      },
      {
        type: "radio",
        name: "attendance",
        label: "How will you join?",
        required: true,
        options: options("In person", "Online"),
      },
      {
        type: "select",
        name: "dietary",
        label: "Dietary needs",
        options: options("None", "Vegetarian", "Vegan", "Halal", "Gluten-free"),
        conditionalLogic: showWhen("attendance", "in-person"),
        admin: { width: "50%" },
      },
      {
        type: "checkbox",
        name: "plus_one",
        label: "I'm bringing a guest",
        conditionalLogic: showWhen("attendance", "in-person"),
        admin: { width: "50%" },
      },
      {
        type: "text",
        name: "guest_name",
        label: "Guest's name",
        conditionalLogic: showWhen("plus_one", true),
      },
      {
        type: "select",
        name: "track",
        label: "Which talk interests you most?",
        options: options(
          "Building with plugins",
          "Schema and migrations",
          "Page Builder deep dive"
        ),
      },
      {
        type: "checkbox",
        name: "access_needs",
        label: "I have accessibility needs",
      },
      {
        type: "textarea",
        name: "access_details",
        label: "Tell us what would help",
        conditionalLogic: showWhen("access_needs", true),
      },
      {
        type: "hidden",
        name: "source",
        label: "Source",
        defaultValue: "website",
      },
    ],
    settings: {
      submitButtonText: "Save my seat",
      confirmationType: "message",
      successMessage:
        "You're on the list. We'll email the venue details a week before.",
      allowMultipleSubmissions: false,
      honeypotEnabled: true,
    },
    notifications: [
      {
        id: "meetup-confirm",
        name: "Confirmation to attendee",
        enabled: true,
        recipientType: "field",
        templateSlug: VISITOR_MESSAGE,
        to: "{{email}}",
        cc: [],
        bcc: [],
      },
      {
        id: "meetup-access",
        name: "Access needs to organisers",
        enabled: true,
        recipientType: "static",
        templateSlug: TEAM_MESSAGE,
        to: "events@acme.test",
        cc: [],
        bcc: [],
        replyTo: "{{email}}",
        condition: { field: "access_needs", comparison: "equals", value: true },
      },
    ],
  },
  {
    name: "Spring newsletter offer",
    slug: "spring-offer",
    status: "closed",
    closedMessage:
      "This offer ended on 30 April. Sign up to the newsletter in the footer for the next one.",
    fields: [{ type: "email", name: "email", label: "Email", required: true }],
    settings: {
      submitButtonText: "Get the offer",
      confirmationType: "message",
      successMessage: "Check your inbox.",
    },
    notifications: [],
  },
  {
    name: "Customer feedback survey",
    slug: "feedback-survey",
    status: "draft",
    fields: [
      {
        type: "radio",
        name: "score",
        label: "How likely are you to recommend us?",
        required: true,
        options: options("0-6", "7-8", "9-10"),
      },
      {
        type: "textarea",
        name: "why",
        label: "What's the main reason for your score?",
      },
    ],
    settings: {
      submitButtonText: "Send feedback",
      confirmationType: "message",
      successMessage: "Thank you!",
    },
    notifications: [],
  },
] as const;

const FIRST = [
  "Ayesha",
  "Bilal",
  "Sara",
  "Omar",
  "Hina",
  "Daniel",
  "Maria",
  "Usman",
  "Fatima",
  "James",
  "Zainab",
  "Ali",
  "Priya",
  "Tom",
  "Noor",
  "Lena",
];
const LAST = [
  "Khan",
  "Ahmed",
  "Malik",
  "Smith",
  "Rossi",
  "Iqbal",
  "Chen",
  "Hussain",
  "Garcia",
  "Butt",
  "Novak",
  "Shah",
];
const BROWSERS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
];
const MESSAGES = [
  "We're a 40-person agency moving client sites off WordPress. Could we get a demo of the Page Builder next week?",
  "The admin shows a blank screen at /admin after upgrading. Details are in our GitHub issue.",
  "We'd love to include Nextly in our headless CMS comparison. Who should we talk to?",
  "Is there a plan for a hosted version? Our client needs SSO.",
  "Can a form send its submissions to a CRM as well as by email?",
];
const SPAM = {
  full_name: "Best SEO Services",
  email: "seo-offers@example.com",
  company: "",
  topic: "sales",
  message:
    "We will put your website on the first page of Google! Cheap price, act now.",
  consent: true,
};

/** A person for row `i`, the same on every run so screenshots stay stable. */
function person(i: number) {
  const first = FIRST[i % FIRST.length];
  const last = LAST[(i * 5) % LAST.length];
  return {
    full_name: `${first} ${last}`,
    email: `${first}.${last}@example.com`.toLowerCase(),
  };
}

/** New for the most recent few, then mostly Read with some Archived. */
function statusFor(i: number): "new" | "read" | "archived" {
  if (i < 4 || i % 4 === 0) return "new";
  return i % 9 === 0 ? "archived" : "read";
}

/** A minimal one-page PDF, so the CV field holds a real file. */
function samplePdf(): Buffer {
  return Buffer.from(
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"
  );
}

interface SampleSubmission {
  data: Record<string, unknown>;
  status: "new" | "read" | "archived" | "spam";
  spamReason?: string;
  notes?: string;
  ipAddress: string;
  userAgent: string;
  /** Hours before `now` it was submitted. */
  hoursAgo: number;
}

/**
 * The submissions for one form, deterministic so the same rows appear on every
 * fresh playground. `cvIds` are the uploaded CVs the job application rows use.
 */
function sampleSubmissions(
  slug: string,
  cvIds: readonly string[] = []
): SampleSubmission[] {
  const counts: Record<string, number> = {
    contact: 18,
    "job-application": 11,
    "meetup-signup": 12,
  };
  const count = counts[slug] ?? 0;
  const rows: SampleSubmission[] = [];
  for (let i = 0; i < count; i++) {
    const meta = {
      ipAddress: `203.0.113.${(i * 37) % 250}`,
      userAgent: BROWSERS[i % BROWSERS.length],
      hoursAgo: i * 9 + 1,
    };
    if (slug === "contact" && (i === 7 || i === 13)) {
      rows.push({
        ...meta,
        data: { ...SPAM },
        status: "spam",
        spamReason: i === 7 ? "honeypot" : "rate_limit",
      });
      continue;
    }
    const status = statusFor(i);
    const notes =
      status === "read" && i % 5 === 2
        ? "Replied by email; follow up on Thursday."
        : undefined;
    rows.push({ ...meta, status, notes, data: answersFor(slug, i, cvIds) });
  }
  return rows;
}

/** One form's answers for row `i`, chosen by the form's slug. */
function answersFor(
  slug: string,
  i: number,
  cvIds: readonly string[]
): Record<string, unknown> {
  if (slug === "contact") return contactAnswers(i);
  if (slug === "job-application") return jobAnswers(i, cvIds);
  return meetupAnswers(i);
}

function contactAnswers(i: number): Record<string, unknown> {
  return {
    ...person(i),
    company:
      i % 3 === 0
        ? ""
        : ["Northwind", "Bluebird Studio", "Kite Labs", "Orbit Digital"][i % 4],
    topic: ["sales", "support", "partnership", "press"][i % 4],
    message: MESSAGES[i % MESSAGES.length],
    consent: true,
  };
}

function jobAnswers(
  i: number,
  cvIds: readonly string[]
): Record<string, unknown> {
  const who = person(i + 20);
  return {
    ...who,
    phone: `+1 555 01${String(i).padStart(2, "0")}`,
    role: [
      "frontend-engineer",
      "backend-engineer",
      "product-designer",
      "customer-success",
    ][i % 4],
    linkedin: `https://www.linkedin.com/in/${who.full_name.toLowerCase().replace(/ /g, "-")}`,
    years: (i % 9) + 1,
    start_date: `2026-12-${String((i % 27) + 1).padStart(2, "0")}`,
    relocate: ["yes", "no", "remote-only"][i % 3],
    cv: cvIds.length > 0 ? cvIds[i % cvIds.length] : null,
    cover_letter: [
      "I've shipped two design systems in React and want to work on developer tools.",
      "Five years running Node services at scale; the plugin model is what I like building.",
      "I support 200 B2B customers today and like turning their questions into docs.",
    ][i % 3],
    keep_details: i % 3 !== 0,
  };
}

/**
 * Meetup answers follow the form's conditions, so a field a condition hides is
 * absent rather than answered.
 */
function meetupAnswers(i: number): Record<string, unknown> {
  const inPerson = i % 3 !== 2;
  const guest = inPerson && i % 4 === 0;
  const access = i % 5 === 1;
  return {
    ...person(i + 40),
    attendance: inPerson ? "in-person" : "online",
    ...(inPerson
      ? {
          dietary: ["none", "vegetarian", "halal", "vegan"][i % 4],
          plus_one: guest,
        }
      : {}),
    ...(guest ? { guest_name: person(i + 60).full_name } : {}),
    track: [
      "building-with-plugins",
      "schema-and-migrations",
      "page-builder-deep-dive",
    ][i % 3],
    access_needs: access,
    ...(access ? { access_details: "Step-free access, please." } : {}),
    source: "website",
  };
}

/**
 * Seed the sample forms and their submissions. Safe to run on every boot.
 *
 * CVs are uploaded only when the job application's submissions are about to be
 * written, so a playground that already has them uploads nothing.
 */
export async function seedSampleForms(
  store: SampleFormsStore,
  upload: UploadFile,
  now: Date = new Date()
): Promise<SampleFormsResult> {
  const result: SampleFormsResult = { formsCreated: 0, submissionsCreated: 0 };

  for (const form of SAMPLE_FORMS) {
    const found = await store.find({
      collection: FORMS_COLLECTION,
      where: { slug: { equals: form.slug } },
      limit: 1,
    });
    // Already there, whoever made it: left exactly as it is.
    if (found.items.length > 0) continue;

    const formId = await createForm(store, form);
    // Another run made it first, between the find and the create.
    if (formId === undefined) continue;
    result.formsCreated++;

    if (sampleSubmissions(form.slug).length === 0) continue;

    const cvIds =
      form.slug === "job-application" ? await uploadCvs(upload) : [];
    for (const row of sampleSubmissions(form.slug, cvIds)) {
      await store.create({
        collection: SUBMISSIONS_COLLECTION,
        data: {
          form: formId,
          data: row.data,
          status: row.status,
          spamReason: row.spamReason ?? null,
          notes: row.notes,
          ipAddress: row.ipAddress,
          userAgent: row.userAgent,
          // Kept because a Direct API create may name its own submittedAt;
          // a visitor's submission over HTTP always gets the server's time.
          submittedAt: new Date(now.getTime() - row.hoursAgo * 3_600_000),
        },
      });
      result.submissionsCreated++;
    }
  }
  return result;
}

/**
 * Create one sample form and return its id, or undefined when another run
 * created it first (its slug is unique, so the loser's create is refused as a
 * duplicate). A closed form is created live and then closed, so it carries the
 * first-published time a form closed by its author has.
 */
async function createForm(
  store: SampleFormsStore,
  form: (typeof SAMPLE_FORMS)[number]
): Promise<string | undefined> {
  const closed = form.status === "closed";
  let id: string;
  let rev: unknown;
  try {
    const created = await store.create({
      collection: FORMS_COLLECTION,
      data: {
        ...structuredClone(form),
        status: closed ? "published" : form.status,
      },
    });
    id = String(created.item.id);
    rev = created.item._rev;
  } catch (error) {
    if (isDuplicate(error)) return undefined;
    throw error;
  }
  if (closed) {
    await store.update({
      collection: FORMS_COLLECTION,
      id,
      // The version just created, as every update names the version it
      // changes, so it cannot overwrite an edit made in between.
      data: { status: "closed", _rev: rev },
    });
  }
  return id;
}

/** Whether a create was refused because the row is already there. */
function isDuplicate(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "DUPLICATE"
  );
}

async function uploadCvs(upload: UploadFile): Promise<string[]> {
  const ids: string[] = [];
  for (const name of [
    "cv-hina-rossi.pdf",
    "cv-daniel-butt.pdf",
    "cv-maria-malik.pdf",
  ]) {
    ids.push(
      await upload({ name, mimetype: "application/pdf", data: samplePdf() })
    );
  }
  return ids;
}
