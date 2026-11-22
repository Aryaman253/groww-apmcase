import { redirect } from "next/navigation";

/** Runs are created by a POST (server action), never on GET — avoids prefetch creating drafts. */
export default function NewRunPage() {
  redirect("/pay");
}
