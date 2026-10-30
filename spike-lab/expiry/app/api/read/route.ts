import { connection } from "next/server";

import { readItem } from "../../../lib/read";

export async function GET() {
  await connection();
  return Response.json(await readItem());
}
