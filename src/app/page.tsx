import { redirect } from "next/navigation";
import { getNotes, getCategories } from "@/lib/db";
import { getAuthUserId } from "@/lib/auth";
import { Header } from "@/components/notes/header";
import { NotesPageClient } from "@/components/notes/notes-page-client";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const userId = await getAuthUserId();
  if (!userId) {
    redirect("/login");
  }

  const [notes, categories] = await Promise.all([
    getNotes(userId),
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
