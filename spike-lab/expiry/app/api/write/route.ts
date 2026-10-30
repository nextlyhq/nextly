import { writeFile } from "node:fs/promises";

import { revalidateTag } from "next/cache";

// A write inside a request: the data changes, then its tag expires.
export async function POST(request: Request) {
  const { value } = (await request.json()) as { value: string };
  await writeFile(
    process.env.LAB_DATA!,
    JSON.stringify({ value, writtenAt: Date.now() })
  );
  revalidateTag("item", { expire: 0 });
  return Response.json({ ok: true });
}
