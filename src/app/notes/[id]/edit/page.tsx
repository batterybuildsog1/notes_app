import { notFound, redirect } from "next/navigation";
import { getNoteById, getCategories } from "@/lib/db";
import { getAuthUserId } from "@/lib/auth";
import { Header } from "@/components/notes/header";
import { NoteEditor } from "@/components/notes/note-editor";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EditNotePage({ params }: PageProps) {
  const userId = await getAuthUserId();
  if (!userId) {
    redirect("/login");
  }

  const { id } = await params;
  if (!id) {
    notFound();
  }

  const [note, categories] = await Promise.all([
    getNoteById(id, userId),
    getCategories(userId),
  ]);

  if (!note) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container py-6 px-4 max-w-4xl">
        <NoteEditor note={note} categories={categories} />
      </main>
    </div>
  );
}
