/**
 * What every way in answers about access, on MySQL.
 *
 * The suite is `access-every-way-in/suite.ts`: its header says what is
 * pinned, which rows are asked and why, and why each dialect runs in a file of
 * its own.
 */
// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { describeEveryWayIn } from "./access-every-way-in/suite";

describeEveryWayIn("mysql");
