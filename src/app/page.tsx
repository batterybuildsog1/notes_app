import { getNotes, getCategories } from "@/lib/db";
import { Header } from "@/components/notes/header";
import { NotesPageClient } from "@/components/notes/notes-page-client";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [notes, categories] = await Promise.all([getNotes(), getCategories()]);

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container py-6 px-4">
        <NotesPageClient initialNotes={notes} categories={categories} />
      </main>
    </div>
  );
}
