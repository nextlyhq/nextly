import { isPlainRecord } from "@nextlyhq/blocks-engine";
import type { HookContext } from "nextly";
import { defineCollection, json, text } from "nextly/config";

import { classIdsUsedBy } from "../class-usage";
import { blocks } from "../fields/blocksHelper";
/**
 * There is no page-level custom CSS field.
 *
 * One existed, gated by its own permission, and nothing ever rendered what it
 * stored: no renderer read the value and nothing sanitised it. A permission
 * around a field implies its safety was considered, so the next change to add
 * the missing render call would have had every reason to assume the text was
 * already clean. Removing the field removes that implication along with it.
 *
 * Reinstating it means writing the sanitiser first — a stylesheet needs its
 * selectors scoped and its properties allow-listed, which is a different job
 * from the value-level checks the rich-text path performs.
 */

/**
 * There is no builder Edit-view path any more.
 *
 * This named a full-screen edit view a host could register for a builder-only
 * collection. The view is gone with the editor that backed it, and the constant
 * went with it rather than being kept pointing at a component nothing exports —
 * a registry path is a STRING, so an unresolvable one fails at render time in
 * the admin rather than at build time here.
 */

/**
 * The plugin-owned `pages` collection. A page is built from blocks.
 *
 * The FIELD decides how an entry is edited, and nothing decides it per entry.
 * This previously carried a stored `editorMode` select beside both a blocks
 * field and a rich-text one, either of which an entry could use.
 *
 * Three things were wrong with that, and only the first is cosmetic:
 *
 * A UI preference was stored as CONTENT. `editorMode` was a real column, so it
 * travelled in API responses and exports, could be set by any writer, and formed
 * part of the document a consumer reads.
 *
 * Both editors' content persisted at once. What hid one of them was
 * `admin.condition`, which reaches the admin form and nothing else, so both
 * columns stayed real and writable. An entry could hold a block document AND
 * rich text with only one rendered, and switching neither migrated nor warned.
 *
 * And it applied HERE only. A collection built in the schema builder gets a
 * blocks field and no switcher, so one capability behaved differently depending
 * on who declared the collection.
 */
export function pagesCollection() {
  return defineCollection({
    slug: "pages",
    labels: { singular: "Page", plural: "Pages" },
    fields: [
      text({ name: "title", required: true }),
      text({ name: "slug", required: true, unique: true }),
      // Named `content` because that is what the retired choice called its
      // builder arm: a page already holding a block document keeps rendering
      // rather than reading as empty against a field with a new name.
      blocks({ name: "content", label: "Page Builder" }),
      // Which named classes this page's document references, derived from the
      // document rather than authored. It answers "how many places is this
      // class used" for the class library, where an author needs the number
      // BEFORE renaming or deleting rather than after.
      //
      // Derived and stored rather than computed on demand: a class is
      // referenced by id from inside each page's document, so counting live
      // means opening every page of the site on every read. Stored, the count
      // is an aggregate over this one small field.
      //
      // On the PAGE rather than in a per-class tally, because this shape is
      // idempotent: writing it again produces the same list, so a save that was
      // missed costs nothing once the page is touched again and one applied
      // twice costs nothing at all. A per-class counter maintained by increment
      // and decrement is permanently wrong after a single miss, and the number
      // gives no sign of it.
      //
      // Hidden because it is bookkeeping, not content: an author neither writes
      // it nor needs to read it, and a field they can edit is one that can
      // disagree with the document it describes.
      //
      // `hidden` governs what the admin UI RENDERS and denies no write, so it
      // is not what keeps the two in agreement. The hook below is: it derives
      // the value or removes the key on every path, so a value supplied by any
      // caller is replaced rather than stored.
      json({
        name: "usedClasses",
        label: "Referenced classes",
        admin: {
          hidden: true,
          description:
            "Derived from this page's blocks: the ids of every named class it references. Maintained automatically; editing it cannot change what the page renders.",
        },
      }),
    ],
    status: true,
    admin: { useAsTitle: "title" },

    hooks: {
      // Kept DERIVED on every write, beside the field it maintains, so the two
      // cannot drift into different files and different opinions.
      //
      // `beforeChange` rather than an `after*` phase, and the reason is that
      // the record lives on this row: written before, it is part of the SAME
      // write as the document it describes, so there is no window in which a
      // page is saved and its record is not. An `after*` phase would need a
      // second write, which can fail on its own and leave exactly that window
      // open — and a stale record is the failure mode this whole design is
      // arranged to avoid, because a confidently wrong count is worse than a
      // slow one.
      //
      // Safe on a `before*` phase only while this cannot fail the write, and
      // that is arranged here rather than assumed of the derivation.
      // `classIdsUsedBy` answers rather than throwing for every shape that
      // reaches STORAGE, and a table of those shapes is asserted beside it. An
      // in-process caller can still hand over an object that throws on being
      // read, which storage cannot produce, so the catch below closes the
      // remaining distance rather than trusting the range.
      //
      // It reads `originalData` on a patch that omits the document, which the
      // update paths supply from the row this write is changing. That makes the
      // stored document the authority for a write that does not carry one, so
      // this field cannot be set to anything the hook did not derive — and a
      // list computed elsewhere from a document that has since been replaced is
      // recomputed rather than believed.
      beforeChange: [
        (context: HookContext) => {
          const { data } = context;
          if (!isPlainRecord(data)) return data;
          try {
            // Every path either DERIVES the value or REMOVES it, and there is
            // no path that lets one through. A value this hook did not compute
            // is unverified whoever sent it, and the field is reachable by
            // anyone who may update the page: `admin.hidden` governs what the
            // admin UI renders and denies no write, so hiding it never made it
            // unwritable.
            //
            // Removing the key is what "leave the record as it is" means on a
            // partial update — an absent field is not written, so the stored
            // list stands. Assigning an empty list instead would RECORD that
            // the page references nothing, and under-counting is the direction
            // that gets a live class deleted.
            if ("content" in data) {
              // The document is part of this write, so it is the authority.
              data.usedClasses = classIdsUsedBy(data.content);
            } else if (context.operation === "create") {
              // A page created without a document references nothing, and that
              // is a derivation rather than an absence of one.
              data.usedClasses = [];
            } else if (isPlainRecord(context.originalData)) {
              // A patch that does not carry the document — a title-only save,
              // or a rebuild writing this field alone. The stored document is
              // read in the same operation as this write, so a list derived
              // from a document that has since changed is replaced by one
              // derived from what is actually stored, rather than accepted.
              data.usedClasses = classIdsUsedBy(context.originalData.content);
            } else {
              delete data.usedClasses;
            }
          } catch {
            // Nothing readable can be derived, so nothing is written. Reachable
            // from a caller that constructs the document in process and hands
            // over an accessor that throws; a stored document cannot do this.
            delete data.usedClasses;
          }
          return data;
        },
      ],
    },
  });
}
