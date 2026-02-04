import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getNoteById, getNotes } from "@/lib/db";
import { getAuthUserId } from "@/lib/auth";
import { Header } from "@/components/notes/header";
import { NoteEditor } from "@/components/notes/note-editor";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft } from "lucide-react";
import { DeleteNoteButton } from "./delete-button";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function NotePage({ params }: PageProps) {
  const userId = await getAuthUserId();
  if (!userId) {
    redirect("/login");
  }

  const { id } = await params;
  if (!id) {
    notFound();
  }

  const note = await getNoteById(id, userId);

  if (!note) {
    notFound();
  }

  // Get related notes (same category) - keep this feature
  let relatedNotes: Awaited<ReturnType<typeof getNotes>> = [];
  if (note.category) {
    const allNotes = await getNotes(userId, undefined, note.category);
    relatedNotes = allNotes.filter((n) => n.id !== note.id).slice(0, 3);
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container py-6 px-4 max-w-4xl">
        {/* Header with back and delete buttons */}
        <div className="flex items-center justify-between gap-4 mb-6">
          <Link href="/">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
          </Link>
          <DeleteNoteButton noteId={note.id} />
        </div>

        {/* Inline editable note - Evernote style */}
        <NoteEditor note={note} inline />

        {/* Related notes section */}
        {relatedNotes.length > 0 && (
          <section className="mt-12">
            <h2 className="text-lg font-semibold mb-4">Related Notes</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {relatedNotes.map((relatedNote) => (
                <Link key={relatedNote.id} href={`/notes/${relatedNote.id}`}>
                  <Card className="hover:bg-accent/50 transition-colors">
                    <CardContent className="pt-4">
                      <h3 className="font-medium line-clamp-1">
                        {relatedNote.title}
                      </h3>
                      <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                        {relatedNote.content.slice(0, 100)}...
                      </p>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
