"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { X, Save, ArrowLeft, Check, Loader2 } from "lucide-react";
import type { Note } from "@/lib/db";

interface NoteEditorProps {
  note?: Note;
  inline?: boolean;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

export function NoteEditor({ note, inline = false }: NoteEditorProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
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

  // Auto-save function with optimistic UI
  const performAutoSave = useCallback(async () => {
    // Only auto-save if we have an existing note (editing mode)
    // For new notes, require manual save first
    if (!currentNoteId) return;
    if (!title.trim() || !content.trim()) return;

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
  }, [currentNoteId, title, content, tags]);

  // Debounced auto-save effect
  useEffect(() => {
    if (!currentNoteId) return; // Only auto-save existing notes

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

  const handleSave = async () => {
    if (!title.trim() || !content.trim()) return;

    setIsLoading(true);
    setSaveStatus("saving");

    try {
      const url = currentNoteId ? `/api/notes/${currentNoteId}` : "/api/notes";
      const method = currentNoteId ? "PUT" : "POST";

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          content,
          tags: tags.length > 0 ? tags : null,
        }),
      });

      if (response.ok) {
        const savedNote = await response.json();
        lastSavedRef.current = { title, content };
        setHasUnsavedChanges(false);
        setSaveStatus("saved");

        // If this was a new note, update the ID for auto-save
        if (!currentNoteId) {
          setCurrentNoteId(savedNote.id);
          // For inline editing: update URL to note page (not /edit)
          window.history.replaceState(null, "", `/notes/${savedNote.id}`);
        }

        // For inline mode, stay on page. For new notes, navigate to the note
        if (!inline && !currentNoteId) {
          router.push(`/notes/${savedNote.id}`);
        }
        router.refresh();
      } else {
        setSaveStatus("error");
      }
    } catch (error) {
      console.error("Error saving note:", error);
      setSaveStatus("error");
    } finally {
      setIsLoading(false);
    }
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
          {hasUnsavedChanges && saveStatus === "idle" && currentNoteId && (
            <span className="text-sm text-muted-foreground">Unsaved changes</span>
          )}
          {/* Only show save button for new notes */}
          {!currentNoteId && (
            <Button onClick={handleSave} disabled={isLoading || !title.trim() || !content.trim()}>
              <Save className="h-4 w-4 mr-2" />
              {isLoading ? "Saving..." : "Save"}
            </Button>
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
