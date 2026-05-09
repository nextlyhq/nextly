import { redirect } from "next/navigation";

// The playground has no public frontend. Direct visits to / land on
// the admin panel — same flow as Payload's contributor-facing apps.
export default function Home() {
  redirect("/admin");
}
