"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Plus, Loader2 } from "lucide-react";

export function QuickAddDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const handleCreate = async () => {
    if (!title.trim()) return;

    setIsCreating(true);

    // Close sheet immediately for snappy feel
    setOpen(false);

    try {
      const response = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          content: content.trim() || " ", // API requires content
        }),
      });

      if (response.ok) {
        const note = await response.json();
        // Navigate to the new note for continued editing
        router.push(`/notes/${note.id}`);
        router.refresh();
      }
    } catch (error) {
      console.error("Failed to create note:", error);
      // Reopen sheet on error
      setOpen(true);
    } finally {
      setIsCreating(false);
      setTitle("");
      setContent("");
    }
  };

  // Allow Enter in title to create (if there's a title)
  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && title.trim() && !e.shiftKey) {
      e.preventDefault();
      handleCreate();
    }
  };

  // Cmd/Ctrl+Enter in content to create
  const handleContentKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && title.trim()) {
      e.preventDefault();
      handleCreate();
    }
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          size="icon"
          className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-lg z-50"
          disabled={isCreating}
        >
          {isCreating ? (
            <Loader2 className="h-6 w-6 animate-spin" />
          ) : (
            <Plus className="h-6 w-6" />
          )}
          <span className="sr-only">Create new note</span>
        </Button>
      </SheetTrigger>
      <SheetContent side="bottom" className="h-[70vh] rounded-t-xl">
        <SheetHeader>
          <SheetTitle>New Note</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4 pb-4 flex-1 overflow-hidden">
          <Input
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={handleTitleKeyDown}
            className="text-lg font-medium"
            autoFocus
          />
          <Textarea
            placeholder="Start writing... (Cmd+Enter to save)"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleContentKeyDown}
            className="flex-1 resize-none min-h-[200px]"
          />
          <Button
            onClick={handleCreate}
            disabled={!title.trim() || isCreating}
            className="w-full"
          >
            {isCreating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              "Create Note"
            )}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
