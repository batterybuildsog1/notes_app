import { redirect } from "next/navigation";
import { getNotesWithEntities, getCategories } from "@/lib/db";
import { getAuthUserId } from "@/lib/auth";
import { AppShell } from "@/components/notes/app-shell";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const userId = await getAuthUserId();
  if (!userId) {
    redirect("/login");
  }

  const [notes, categories] = await Promise.all([
    getNotesWithEntities(userId, undefined, undefined, { limit: 50 }),
    getCategories(userId),
  ]);

  return <AppShell initialNotes={notes} categories={categories} />;
}
