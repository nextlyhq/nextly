import { readItem } from "../lib/read";

// A page whose only data is the cached read, so the build prerenders it and
// later requests are served the stored render until its tag expires.
export default async function Page() {
  const item = await readItem();
  return <p id="value">{item.value}</p>;
}
