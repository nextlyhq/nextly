/**
 * The nested process a group kill must reach.
 *
 * Stands in for the Tailwind CLI, which `nextly-build-admin-css` runs as its own
 * child — so killing only the wrapper leaves this alive and reparented to init.
 * It reports both ends of its life through the filesystem rather than through a
 * pid, because a pid lookup needs a process table this suite cannot assume.
 */
import { writeFileSync } from "node:fs";

const [startedPath, finishedPath, sleepMs] = process.argv.slice(2);

writeFileSync(startedPath, "started");
setTimeout(() => writeFileSync(finishedPath, "finished"), Number(sleepMs));
