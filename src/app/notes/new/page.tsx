import { redirect } from "next/navigation";
import { getAuthUserId } from "@/lib/auth";
import { Header } from "@/components/notes/header";
import { NoteEditor } from "@/components/notes/note-editor";

export const dynamic = "force-dynamic";

export default async function NewNotePage() {
  const userId = await getAuthUserId();
  if (!userId) {
    redirect("/login");
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container py-6 px-4 max-w-4xl">
        <h1 className="text-2xl font-bold mb-6">New Note</h1>
        <NoteEditor />
      </main>
    </div>
  );
}
