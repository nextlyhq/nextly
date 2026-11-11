/**
 * The sample forms seed, against an in-memory store that answers the same
 * Direct API shapes the playground's Nextly does.
 *
 * What separates a correct seed from a plausible broken one is that it writes
 * submissions only to a form it created in that run: a re-run adds nothing, a
 * contributor's own form with a sample's slug gets no sample rows (even with
 * no submissions of its own), and a run that loses the race to create a form
 * adds nothing to it. A seed that checked for existing submissions instead
 * would pass a first-run test and fill a contributor's empty form with fake
 * answers.
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
  const calls: Array<[string, string, string]> = [];
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
      // A form's slug is unique, as the forms collection declares it.
      if (
        collection === FORMS_COLLECTION &&
        (rows.get(collection) ?? []).some(r => r.slug === data.slug)
      ) {
        throw Object.assign(new Error("Duplicate."), { code: "DUPLICATE" });
      }
      const row = { ...data, id: `id-${next++}`, _rev: 1 };
      rows.set(collection, [...(rows.get(collection) ?? []), row]);
      calls.push([
        "create",
        collection,
        typeof data.status === "string" ? data.status : "",
      ]);
      return { item: { id: row.id, _rev: row._rev } };
    },
    async update({ collection, id, data }) {
      const row = (rows.get(collection) ?? []).find(r => r.id === id);
      if (!row) throw new Error(`No ${collection} ${id}`);
      // Every update names the version it changes, as the Direct API requires.
      if (data._rev !== row._rev) {
        throw Object.assign(new Error("Stale."), { code: "CONFLICT" });
      }
      Object.assign(row, { ...data, _rev: Number(row._rev) + 1 });
      calls.push([
        "update",
        collection,
        typeof data.status === "string" ? data.status : "",
      ]);
      return { item: row };
    },
  };
  const uploads: string[] = [];
  const upload = async (file: { name: string }) => {
    uploads.push(file.name);
    return `media-${uploads.length}`;
  };
  return { store, upload, rows, uploads, calls };
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

  it("leaves a contributor's own form with a sample's slug untouched", async () => {
    const { store, upload, rows } = memoryStore();
    // A contributor made their own empty `contact` form, with other fields.
    const contact = await store.create({
      collection: FORMS_COLLECTION,
      data: { slug: "contact", name: "My contact form" },
    });

    await seedSampleForms(store, upload, NOW);

    const contactRows = (rows.get(SUBMISSIONS_COLLECTION) ?? []).filter(
      s => s.form === contact.item.id
    );
    expect(contactRows).toEqual([]);
    const forms = (rows.get(FORMS_COLLECTION) ?? []).filter(
      f => f.slug === "contact"
    );
    expect(forms.map(f => f.name)).toEqual(["My contact form"]);
  });

  it("adds nothing to a form another run created first", async () => {
    const { store, upload, rows } = memoryStore();
    // Another run creates `contact` between this run's find and its create.
    const racing: SampleFormsStore = {
      ...store,
      async find(args) {
        const answer = await store.find(args);
        if (args.collection === FORMS_COLLECTION) {
          await store
            .create({
              collection: FORMS_COLLECTION,
              data: { slug: args.where.slug.equals, name: "Other run" },
            })
            .catch(() => undefined);
        }
        return answer;
      },
    };

    const result = await seedSampleForms(racing, upload, NOW);

    expect(result).toEqual({ formsCreated: 0, submissionsCreated: 0 });
    expect(rows.get(SUBMISSIONS_COLLECTION) ?? []).toEqual([]);
  });

  it("closes the closed form after it was live, as an author would", async () => {
    const { store, upload, calls } = memoryStore();
    await seedSampleForms(store, upload, NOW);

    const closed = SAMPLE_FORMS.filter(f => f.status === "closed");
    expect(closed.length).toBeGreaterThan(0);
    const formCalls = calls.filter(c => c[1] === FORMS_COLLECTION);
    expect(formCalls.filter(c => c[0] === "update")).toEqual(
      closed.map(() => ["update", FORMS_COLLECTION, "closed"])
    );
    // Never created closed: a form created closed has no first-published time.
    expect(formCalls.some(c => c[0] === "create" && c[2] === "closed")).toBe(
      false
    );
  });

  it("names a message on every enabled notification, so each can send", () => {
    // Named, so `flatMap` reads one element type across the forms' differing
    // notification tuples (one form has none).
    type SampleNotification =
      (typeof SAMPLE_FORMS)[number]["notifications"][number];
    const enabled = SAMPLE_FORMS.flatMap(
      (f): readonly SampleNotification[] => f.notifications
    ).filter(n => n.enabled);
    expect(enabled.length).toBeGreaterThan(0);
    for (const n of enabled) {
      expect(n.templateSlug, n.id).toBe(
        n.recipientType === "field" ? "forms-confirmation" : "forms-submission"
      );
    }
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
