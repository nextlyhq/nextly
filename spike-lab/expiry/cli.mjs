// The CLI stand-in: a separate process with no Next.js runtime. It writes the
// data, then, with --expire, asks each instance's expire route to expire the
// tag (mechanism b), and prints how long each call took.
import { writeFileSync } from "node:fs";

const [value, ...flags] = process.argv.slice(2);
writeFileSync(
  process.env.LAB_DATA,
  JSON.stringify({ value, writtenAt: Date.now() })
);
// --ledger: record the expiry in the shared ledger directly, as a writer with
// the app's database but no route to call would.
if (flags.includes("--ledger")) {
  const { recordExpiry } = await import("./cache-handler.mjs");
  const t0 = performance.now();
  recordExpiry(["item"]);
  console.log(`ledger write in ${(performance.now() - t0).toFixed(2)} ms`);
}
if (flags.includes("--expire")) {
  for (const port of (process.env.LAB_PORTS ?? "3200").split(",")) {
    const t0 = performance.now();
    const res = await fetch(`http://localhost:${port}/api/expire`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-lab-secret": process.env.LAB_SECRET,
      },
      body: JSON.stringify({ tags: ["item"] }),
    });
    console.log(
      `expire :${port} -> ${res.status} in ${(performance.now() - t0).toFixed(1)} ms`
    );
  }
}
