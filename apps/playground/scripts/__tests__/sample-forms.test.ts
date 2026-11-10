/**
 * The sample forms seed, against an in-memory store that answers the same
 * Direct API shapes the playground's Nextly does.
 *
 * What separates a correct seed from a plausible broken one is that a re-run
 * adds nothing and that a form which already has submissions (an author's own)
 * gets none of the samples. A seed that only checks the form's slug would pass
 * a first-run test and double every submission on the next boot.
 */
import { describe, expect, it } from "vitest";

import {
  FORMS_COLLECTION,
  SAMPLE_FORMS,
  SUBMISSIONS_COLLECTION,
  seedSampleForms,
  type SampleFormsStore,
} from "../../seed/sample-forms";

type Row = Record<string, unknown> & { id: string };

/** A store keeping rows per collection and filtering by one equals clause. */
function memoryStore() {
  const rows = new Map<string, Row[]>();
  let next = 1;
  const store: SampleFormsStore = {
    async find({ collection, where, limit }) {
      const [[field, clause]] = Object.entries(where);
      const matches = (rows.get(collection) ?? []).filter(
        row => row[field] === clause.equals
      );
      return {
        items: matches.slice(0, limit).map(row => ({ id: row.id })),
        meta: { total: matches.length },
      };
    },
    async create({ collection, data }) {
      const row = { ...data, id: `id-${next++}` };
      rows.set(collection, [...(rows.get(collection) ?? []), row]);
      return { item: { id: row.id } };
    },
  };
  const uploads: string[] = [];
  const upload = async (file: { name: string }) => {
    uploads.push(file.name);
    return `media-${uploads.length}`;
  };
  return { store, upload, rows, uploads };
}

const NOW = new Date("2026-11-10T12:00:00Z");

describe("seedSampleForms", () => {
  it("creates the five forms and submissions in every status", async () => {
    const { store, upload, rows } = memoryStore();
    const result = await seedSampleForms(store, upload, NOW);

    const forms = rows.get(FORMS_COLLECTION) ?? [];
    expect(forms.map(f => f.slug)).toEqual(SAMPLE_FORMS.map(f => f.slug));
    expect(new Set(forms.map(f => f.status))).toEqual(
      new Set(["published", "closed", "draft"])
    );

    const submissions = rows.get(SUBMISSIONS_COLLECTION) ?? [];
    expect(result).toEqual({
      formsCreated: 5,
      submissionsCreated: submissions.length,
    });
    expect(new Set(submissions.map(s => s.status))).toEqual(
      new Set(["new", "read", "archived", "spam"])
    );
    // Every submission names a form the seed created.
    const formIds = new Set(forms.map(f => f.id));
    expect(submissions.every(s => formIds.has(s.form as string))).toBe(true);
  });

  it("adds nothing on a second run", async () => {
    const { store, upload, rows, uploads } = memoryStore();
    await seedSampleForms(store, upload, NOW);
    const before = {
      forms: rows.get(FORMS_COLLECTION)?.length,
      submissions: rows.get(SUBMISSIONS_COLLECTION)?.length,
      uploads: uploads.length,
    };

    const again = await seedSampleForms(store, upload, NOW);

    expect(again).toEqual({ formsCreated: 0, submissionsCreated: 0 });
    expect({
      forms: rows.get(FORMS_COLLECTION)?.length,
      submissions: rows.get(SUBMISSIONS_COLLECTION)?.length,
      uploads: uploads.length,
    }).toEqual(before);
  });

  it("leaves a form that already has submissions alone", async () => {
    const { store, upload, rows } = memoryStore();
    // An author made the contact form and submitted it once by hand.
    const contact = await store.create({
      collection: FORMS_COLLECTION,
      data: { slug: "contact", name: "Contact us" },
    });
    await store.create({
      collection: SUBMISSIONS_COLLECTION,
      data: { form: contact.item.id, data: { full_name: "Author" } },
    });

    await seedSampleForms(store, upload, NOW);

    const contactRows = (rows.get(SUBMISSIONS_COLLECTION) ?? []).filter(
      s => s.form === contact.item.id
    );
    expect(contactRows).toHaveLength(1);
    // The author's form is reused, not duplicated.
    expect(
      (rows.get(FORMS_COLLECTION) ?? []).filter(f => f.slug === "contact")
    ).toHaveLength(1);
  });

  it("gives the job applications real uploaded CVs", async () => {
    const { store, upload, rows, uploads } = memoryStore();
    await seedSampleForms(store, upload, NOW);

    const job = (rows.get(FORMS_COLLECTION) ?? []).find(
      f => f.slug === "job-application"
    );
    const applications = (rows.get(SUBMISSIONS_COLLECTION) ?? []).filter(
      s => s.form === job?.id
    );
    expect(uploads.length).toBeGreaterThan(0);
    const uploaded = new Set(uploads.map((_, i) => `media-${i + 1}`));
    expect(
      applications.every(a =>
        uploaded.has((a.data as Record<string, unknown>).cv as string)
      )
    ).toBe(true);
  });

  it("answers only the meetup questions the form's conditions show", async () => {
    const { store, upload, rows } = memoryStore();
    await seedSampleForms(store, upload, NOW);

    const meetup = (rows.get(FORMS_COLLECTION) ?? []).find(
      f => f.slug === "meetup-signup"
    );
    const answers = (rows.get(SUBMISSIONS_COLLECTION) ?? [])
      .filter(s => s.form === meetup?.id)
      .map(s => s.data as Record<string, unknown>);

    expect(answers.length).toBeGreaterThan(0);
    for (const a of answers) {
      // Dietary needs and the guest question are shown only to people coming in person.
      if (a.attendance !== "in-person") {
        expect(a).not.toHaveProperty("dietary");
        expect(a).not.toHaveProperty("plus_one");
      }
      if (a.plus_one !== true) expect(a).not.toHaveProperty("guest_name");
      if (a.access_needs !== true)
        expect(a).not.toHaveProperty("access_details");
    }
    // Both branches occur, so the loop above is not satisfied by absence.
    expect(answers.some(a => a.attendance === "online")).toBe(true);
    expect(answers.some(a => typeof a.guest_name === "string")).toBe(true);
  });

  it("names only fields each form has, in its conditions and notifications", () => {
    for (const form of SAMPLE_FORMS) {
      const names = new Set<string>(form.fields.map(f => f.name));
      expect(names.size).toBe(form.fields.length);
      for (const field of form.fields) {
        const logic = (
          field as {
            conditionalLogic?: { conditions: Array<{ field: string }> };
          }
        ).conditionalLogic;
        for (const c of logic?.conditions ?? [])
          expect(names).toContain(c.field);
      }
      for (const n of form.notifications) {
        const condition = (n as { condition?: { field: string } }).condition;
        if (condition) expect(names).toContain(condition.field);
      }
    }
  });
});
