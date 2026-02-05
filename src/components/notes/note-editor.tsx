"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { X, ArrowLeft, Check, Loader2 } from "lucide-react";
import type { Note } from "@/lib/db";

interface NoteEditorProps {
  note?: Note;
  inline?: boolean;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

export function NoteEditor({ note, inline = false }: NoteEditorProps) {
  const router = useRouter();
  const [title, setTitle] = useState(note?.title || "");
  const [content, setContent] = useState(note?.content || "");
  const [tags, setTags] = useState<string[]>(note?.tags || []);
  const [tagInput, setTagInput] = useState("");

  // Auto-save state
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [currentNoteId, setCurrentNoteId] = useState(note?.id);
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedRef = useRef({ title: note?.title || "", content: note?.content || "" });

  // Track if a creation request is already in-flight to prevent duplicates
  const isCreatingRef = useRef(false);

  // Auto-save function with optimistic UI (handles both create and update)
  const performAutoSave = useCallback(async () => {
    // Need at least a title to save
    if (!title.trim()) return;

    // For new notes: auto-create via POST
    if (!currentNoteId) {
      // Prevent duplicate creation requests
      if (isCreatingRef.current) return;
      isCreatingRef.current = true;

      setSaveStatus("saving");
      try {
        const response = await fetch("/api/notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            content,
            tags: tags.length > 0 ? tags : null,
          }),
        });

        if (response.ok) {
          const savedNote = await response.json();
          setCurrentNoteId(savedNote.id);
          lastSavedRef.current = { title, content };
          setHasUnsavedChanges(false);
          setSaveStatus("saved");
          setTimeout(() => setSaveStatus("idle"), 1500);
          // Update URL so refreshing stays on this note
          window.history.replaceState(null, "", `/notes/${savedNote.id}`);
          router.refresh();
        } else {
          setSaveStatus("error");
        }
      } catch {
        setSaveStatus("error");
      } finally {
        isCreatingRef.current = false;
      }
      return;
    }

    // For existing notes: auto-save via PUT
    // Skip if nothing changed
    if (title === lastSavedRef.current.title && content === lastSavedRef.current.content) {
      setHasUnsavedChanges(false);
      return;
    }

    // Optimistic: show saved immediately
    setSaveStatus("saved");
    lastSavedRef.current = { title, content };
    setHasUnsavedChanges(false);

    try {
      const response = await fetch(`/api/notes/${currentNoteId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          content,
          tags: tags.length > 0 ? tags : null,
        }),
      });

      if (response.ok) {
        // Reset to idle after 1.5 seconds
        setTimeout(() => setSaveStatus("idle"), 1500);
      } else {
        setSaveStatus("error");
      }
    } catch {
      setSaveStatus("error");
    }
  }, [currentNoteId, title, content, tags, router]);

  // Debounced auto-save effect (works for both new and existing notes)
  useEffect(() => {
    // For new notes: need at least a title to trigger auto-create
    if (!currentNoteId && !title.trim()) return;

    // Check if content changed
    const hasChanges = title !== lastSavedRef.current.title || content !== lastSavedRef.current.content;
    setHasUnsavedChanges(hasChanges);

    if (!hasChanges) return;

    // Clear existing timer
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    // Set new timer (500ms debounce for near-instant feel)
    autoSaveTimerRef.current = setTimeout(() => {
      performAutoSave();
    }, 500);

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [title, content, currentNoteId, performAutoSave]);

  // Warn on navigation with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = "";
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  const handleAddTag = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && tagInput.trim()) {
      e.preventDefault();
      if (!tags.includes(tagInput.trim())) {
        setTags([...tags, tagInput.trim()]);
      }
      setTagInput("");
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter((tag) => tag !== tagToRemove));
  };

  // Handle back navigation with unsaved changes warning
  const handleBack = () => {
    if (hasUnsavedChanges) {
      const confirmed = window.confirm("You have unsaved changes. Are you sure you want to leave?");
      if (!confirmed) return;
    }
    router.back();
  };

  return (
    <div className="space-y-4">
      {/* Header with save status and actions */}
      <div className="flex items-center justify-between gap-4">
        {!inline && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleBack}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
        )}
        <div className={`flex items-center gap-3 ${inline ? "ml-auto" : ""}`}>
          {/* Save status indicator */}
          {saveStatus === "saving" && (
            <span className="text-sm text-muted-foreground flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              Saving...
            </span>
          )}
          {saveStatus === "saved" && (
            <span className="text-sm text-green-600 flex items-center gap-1">
              <Check className="h-3 w-3" />
              Saved
            </span>
          )}
          {saveStatus === "error" && (
            <span className="text-sm text-red-600">Save failed</span>
          )}
          {hasUnsavedChanges && saveStatus === "idle" && (
            <span className="text-sm text-muted-foreground">Unsaved changes</span>
          )}
        </div>
      </div>

      {/* Title input */}
      <Input
        placeholder="Note title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="text-xl font-semibold border-none shadow-none focus-visible:ring-0 px-0"
      />

      {/* Tags section */}
      <div className="space-y-2">
        <div className="flex flex-wrap gap-1">
          {tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="gap-1">
              {tag}
              <button
                type="button"
                onClick={() => handleRemoveTag(tag)}
                className="ml-1 hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
        <Input
          placeholder="Add tags (press Enter)"
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={handleAddTag}
          className="max-w-xs"
        />
      </div>

      {/* Content textarea - simple and fast */}
      <Textarea
        placeholder="Start writing..."
        value={content}
        onChange={(e) => setContent(e.target.value)}
        className="min-h-[500px] resize-none font-mono text-base leading-relaxed"
      />
    </div>
  );
}
