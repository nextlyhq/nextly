import { connection } from "next/server";

import { readItemUseCache } from "../../../lib/read-use-cache";

export async function GET() {
  await connection();
  return Response.json(await readItemUseCache());
}
