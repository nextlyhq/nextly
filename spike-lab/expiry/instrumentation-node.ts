import { writeFile } from "node:fs/promises";

import { revalidateTag } from "next/cache";

// A write made inside the server process but outside any request, on a timer,
// as an in-process scheduler would make it. It records what revalidateTag does
// there.
async function timerWrite(): Promise<void> {
  await writeFile(
    process.env.LAB_DATA!,
    JSON.stringify({ value: "timer-write", writtenAt: Date.now() })
  );
  try {
    revalidateTag("item", { expire: 0 });
    console.log("LAB timer: revalidateTag returned");
  } catch (error) {
    console.log(`LAB timer: revalidateTag threw: ${(error as Error).message}`);
  }
}

export function startTimerWrite(): void {
  setTimeout(
    () => {
      timerWrite().catch((error: unknown) => {
        console.log(`LAB timer: the write failed: ${String(error)}`);
      });
    },
    Number(process.env.LAB_TIMER_DELAY_MS ?? 8000)
  );
}
