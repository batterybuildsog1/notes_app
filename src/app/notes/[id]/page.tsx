import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { getNoteById, getNotes } from "@/lib/db";
import { getAuthUserId } from "@/lib/auth";
import { Header } from "@/components/notes/header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, Edit, Calendar, Tag, Folder } from "lucide-react";
import { DeleteNoteButton } from "./delete-button";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ id: string }>;
}

function formatDate(date: Date | string): string {
  const d = new Date(date);
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
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

  // Get related notes (same category)
  let relatedNotes: Awaited<ReturnType<typeof getNotes>> = [];
  if (note.category) {
    const allNotes = await getNotes(userId, undefined, note.category);
    relatedNotes = allNotes.filter((n) => n.id !== note.id).slice(0, 3);
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container py-6 px-4 max-w-4xl">
        <div className="flex items-center justify-between gap-4 mb-6">
          <Link href="/">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
          </Link>
          <div className="flex gap-2">
            <DeleteNoteButton noteId={note.id} />
            <Link href={`/notes/${note.id}/edit`}>
              <Button size="sm">
                <Edit className="h-4 w-4 mr-2" />
                Edit
              </Button>
            </Link>
          </div>
        </div>

        <article className="space-y-6">
          <header className="space-y-4">
            <h1 className="text-3xl font-bold">{note.title}</h1>

            <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
              <div className="flex items-center gap-1">
                <Calendar className="h-4 w-4" />
                {formatDate(note.display_updated_at || note.updated_at)}
              </div>
              {note.category && (
                <div className="flex items-center gap-1">
                  <Folder className="h-4 w-4" />
                  <Badge variant="secondary">{note.category}</Badge>
                </div>
              )}
              {note.priority && (
                <Badge
                  variant={
                    note.priority === "high"
                      ? "destructive"
                      : note.priority === "medium"
                      ? "default"
                      : "outline"
                  }
                >
                  {note.priority}
                </Badge>
              )}
            </div>

            {note.tags && note.tags.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <Tag className="h-4 w-4 text-muted-foreground" />
                {note.tags.map((tag) => (
                  <Badge key={tag} variant="outline">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </header>

          <div className="prose prose-neutral dark:prose-invert max-w-none">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeSanitize]}
            >
              {note.content}
            </ReactMarkdown>
          </div>
        </article>

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
