import { redirect } from "next/navigation";
import { getNotesWithEntities, getCategories } from "@/lib/db";
import { getAuthUserId } from "@/lib/auth";
import { Header } from "@/components/notes/header";
import { NotesPageClient } from "@/components/notes/notes-page-client";

// ISR: Revalidate every 60 seconds for better performance
export const revalidate = 60;

export default async function HomePage() {
  const userId = await getAuthUserId();
  if (!userId) {
    redirect("/login");
  }

  const [notes, categories] = await Promise.all([
    getNotesWithEntities(userId, undefined, undefined, { limit: 30 }),
    getCategories(userId),
  ]);

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container py-4 px-3 md:py-6 md:px-4">
        <NotesPageClient initialNotes={notes} categories={categories} />
      </main>
    </div>
  );
}
