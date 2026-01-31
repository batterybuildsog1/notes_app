import { getNotes, getCategories } from "@/lib/db";
import { Header } from "@/components/notes/header";
import { NotesPageClient } from "@/components/notes/notes-page-client";

export const dynamic = "force-dynamic";

const DEFAULT_USER_ID = "default-user";

export default async function HomePage() {
  const [notes, categories] = await Promise.all([getNotes(DEFAULT_USER_ID), getCategories(DEFAULT_USER_ID)]);

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container py-6 px-4">
        <NotesPageClient initialNotes={notes} categories={categories} />
      </main>
    </div>
  );
}
