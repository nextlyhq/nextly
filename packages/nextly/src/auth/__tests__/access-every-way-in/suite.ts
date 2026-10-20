/**
 * What every way in answers about access, for one table of cases.
 *
 * The same caller asking the same thing of the same target can reach Nextly
 * through many doors: the REST API the admin uses, the Direct API, the
 * website's rendering path, plugin routes and services, relationship
 * population, the entity readers behind versions, translations, locks, widgets
 * and the dashboard, the system-resource readers, and the schema builder's
 * collection list. This suite sends one table of cases through all of them, so
 * moving a door onto a different decision can be checked row by row.
 *
 * Where a door writes (REST, the Direct API and a plugin service), the
 * target's table is also read whole before and after the write, and the
 * suite checks that a write the door did not allow left it exactly as it was,
 * and that one it allowed changed it. An answer alone cannot show a door that
 * refuses only after it has written.
 *
 * Two tests read the same answers:
 *
 * - **Today's answers** (characterization). Every row's answer at every door
 *   is pinned in `answers-today.txt`, disagreements included. It documents
 *   behaviour; it does not endorse it. Every dialect must give the same
 *   answers, so the one file is the expectation for all of them. When a change
 *   moves an answer on purpose, rerun with `-u`, and the diff of that file is
 *   the record of what moved.
 * - **One answer** (conformance). Each row has one answer, worked out in
 *   `table.ts` (`oneAnswer`) from the composition the access design states:
 *   the permission first, then a code rule that can only narrow; super-admin
 *   past every collection and Single rule; no key with super-admin authority;
 *   a plugin's person judged by the rule alone; and a visitor judged by a
 *   Public role that does not exist yet and so holds nothing. A door listed in
 *   {@link NOT_YET_ONE_ANSWER} is not yet expected to give it everywhere: the
 *   cells where it disagrees are listed BY HAND in `known-disagreements.txt`,
 *   and run as expected failures named `NOT YET ONE ANSWER`, so each is
 *   watched failing. Every other cell must give the one answer. The list is
 *   kept apart from the answers on purpose: accepting a new answer with `-u`
 *   never makes a new disagreement acceptable, and a cell that starts agreeing
 *   fails the run until it is taken off the list. Nothing is skipped.
 *
 * **Which rows.** The callers, rules, actions and targets are crossed in full,
 * and each row is sent to every door that can ask it (`table.ts`, `asks`). A
 * door with no way to name a caller or a target is left out of that row, and
 * the answer file shows `.` there. Publish and unpublish are each asked of a
 * collection, since they need permissions of their own, and each is judged on
 * top of the update rule. Without the access-control service, the read of a collection, a Single and a
 * related row is asked by a visitor, a user with and without the permission
 * and a role-based key, under no rule, a rule returning `true`, one returning
 * `false` and one returning `null`: the callers and rules whose answer a
 * missing service can change. Some rows join this table later (`table.ts`,
 * `joinsLater`).
 *
 * **Without the service.** Lookups that ask the container per call are shown
 * no service. The Direct API's gates took the service when the instance
 * booted, so for that door the gates are built without it, as a boot without
 * the service builds them.
 *
 * **One dialect per file.** Each dialect runs in a file of its own, which
 * Vitest gives a fresh module graph, and shares one booted instance across
 * every row, so the cases of one dialect are seeded once and a failure names
 * the dialect it came from.
 *
 * **What a cell says.** `A` allowed, `R` refused, an HTTP status for a refusal
 * or failure that carried one, `E` a failure that carried none, `=<value>` a
 * check that answered something other than a boolean, and `.` not asked.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  getConfiguredTestDialects,
  type TestDialect,
} from "../../../plugins/test-nextly";

import { ask } from "./doors";
import {
  doorsAsking,
  oneAnswer,
  renderAnswers,
  rowKey,
  rows,
  verdictOf,
  type Answer,
  type Door,
  type Row,
} from "./table";
import { boot, type World } from "./world";

/**
 * The ways in that do not yet give the one answer.
 *
 * A door is removed from this list when it moves onto the one decision; from
 * then on every row it asks must give the one answer. Until then, each of its
 * rows that disagrees is an expected failure named `NOT YET ONE ANSWER`.
 */
const NOT_YET_ONE_ANSWER: ReadonlySet<Door> = new Set<Door>([
  "rest",
  "direct",
  "website",
  "route",
  "can",
  "service",
  "entity",
  "schema",
  "population",
  "system",
]);

const ANSWERS_FILE = join(__dirname, "answers-today.txt");
const DISAGREEMENTS_FILE = join(__dirname, "known-disagreements.txt");

/** One cell of the table: a row at a door, as the disagreements file names it. */
const cellKey = (row: Row, door: Door) => `${rowKey(row)} at ${door}`;

/**
 * The cells allowed to disagree with the one answer for now, as listed by hand.
 * Blank lines and lines starting with `#` are ignored.
 */
function knownDisagreements(): Set<string> {
  return new Set(
    readFileSync(DISAGREEMENTS_FILE, "utf8")
      .split("\n")
      .map(line => line.trim())
      .filter(line => line !== "" && !line.startsWith("#"))
  );
}

/** The whole suite for one dialect, skipped when that dialect is not set up. */
export function describeEveryWayIn(dialect: TestDialect): void {
  const configured = getConfiguredTestDialects().includes(dialect);
  const title = `every way in, one table of access cases (${dialect})`;
  (configured ? describe : describe.skip)(title, () => {
    const known = knownDisagreements();
    let world: World | undefined;
    const answers = new Map<string, Map<Door, Answer>>();
    // For each write a door was asked to make: the cell, its answer, and
    // whether the write reached the database.
    const writes: {
      cell: string;
      answer: Answer;
      landed: boolean;
      done: boolean;
    }[] = [];

    beforeAll(async () => {
      // A rule that throws is reported by the doors that catch it.
      vi.spyOn(console, "error").mockImplementation(() => {});
      world = await boot(dialect);
      for (const row of rows()) {
        const byDoor = new Map<Door, Answer>();
        for (const door of doorsAsking(row)) {
          const { answer, landed, done } = await ask(world, row, door);
          byDoor.set(door, answer);
          if (landed !== undefined && done !== undefined) {
            writes.push({ cell: cellKey(row, door), answer, landed, done });
          }
        }
        answers.set(rowKey(row), byDoor);
      }
    }, 900_000);

    afterAll(async () => {
      vi.restoreAllMocks();
      await world?.t.destroy();
    });

    describe("today's answers", () => {
      it("are the answers the file records, for every row at every door", async () => {
        await expect(renderAnswers(answers)).toMatchFileSnapshot(ANSWERS_FILE);
      });
    });

    describe("what a write leaves behind", () => {
      // Where a door writes, its answer is compared with the target's table,
      // read whole before and after: a door that refuses after the write has
      // happened would otherwise pass on its answer alone.
      const allowed = () => writes.filter(w => w.answer === "A");
      const notAllowed = () => writes.filter(w => w.answer !== "A");

      it("is nothing, wherever the write was not allowed", () => {
        // POPULATION CONTROL: refusals were watched, so `[]` is not vacuous.
        expect(notAllowed().length).toBeGreaterThan(0);
        expect(notAllowed().filter(w => w.landed)).toEqual([]);
      });

      it("is the write, wherever it was allowed", () => {
        // The control for the check above: a write that lands is seen, so
        // the comparison can tell a written table from an untouched one.
        expect(allowed().length).toBeGreaterThan(0);
        expect(allowed().filter(w => !w.done)).toEqual([]);
      });
    });

    describe("one answer", () => {
      it("lists only disagreements of cells this table asks, at doors not yet moved", () => {
        const asked = new Set(
          rows().flatMap(row =>
            doorsAsking(row).map(door => cellKey(row, door))
          )
        );
        const stale = [...known].filter(
          cell =>
            !asked.has(cell) ||
            !NOT_YET_ONE_ANSWER.has(
              cell.slice(cell.lastIndexOf(" ") + 1) as Door
            )
        );
        expect(stale).toEqual([]);
      });

      for (const row of rows()) {
        const expected = oneAnswer(row);
        for (const door of doorsAsking(row)) {
          const name = `${cellKey(row, door)} is ${expected}`;
          const disagrees = known.has(cellKey(row, door));
          const check = () => {
            const answer = answers.get(rowKey(row))?.get(door);
            expect(answer, "the door was asked").toBeDefined();
            expect(verdictOf(answer ?? ".")).toBe(expected);
          };
          if (NOT_YET_ONE_ANSWER.has(door) && disagrees) {
            it.fails(`NOT YET ONE ANSWER: ${name}`, check);
          } else {
            it(name, check);
          }
        }
      }
    });
  });
}
