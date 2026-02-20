"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { X, Check, Loader2, AlertCircle, Trash2, ArrowLeft } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { Note } from "@/lib/db";

interface NoteEditorProps {
  note?: Note;
  /** Callback when note is saved (title/content changed) — used by AppShell to update sidebar */
  onSave?: (note: { id: string; title: string; content: string; tags: string[] | null; updated_at: Date }) => void;
  /** Callback when note is deleted */
  onDelete?: (noteId: string) => void;
  /** Callback when a new note is created (returns the new note ID) */
  onCreate?: (note: Note) => void;
  /** Back navigation for mobile */
  onBack?: () => void;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

export function NoteEditor({ note, onSave, onDelete, onCreate, onBack }: NoteEditorProps) {
  const [title, setTitle] = useState(note?.title || "");
  const [content, setContent] = useState(note?.content || "");
  const [tags, setTags] = useState<string[]>(note?.tags || []);
  const [tagInput, setTagInput] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Auto-save state
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [currentNoteId, setCurrentNoteId] = useState(note?.id);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const periodicTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef({
    title: note?.title || "",
    content: note?.content || "",
    tags: JSON.stringify(note?.tags || []),
  });
  const isCreatingRef = useRef(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  // Keep current values in refs for sendBeacon/periodic save access
  const currentValuesRef = useRef({ title: note?.title || "", content: note?.content || "", tags: note?.tags || [] as string[] });
  const currentNoteIdRef = useRef(note?.id);

  // Sync note prop changes (when switching notes in sidebar)
  useEffect(() => {
    setTitle(note?.title || "");
    setContent(note?.content || "");
    setTags(note?.tags || []);
    setTagInput("");
    setCurrentNoteId(note?.id);
    currentNoteIdRef.current = note?.id;
    setSaveStatus("idle");
    isCreatingRef.current = false;
    lastSavedRef.current = {
      title: note?.title || "",
      content: note?.content || "",
      tags: JSON.stringify(note?.tags || []),
    };
    currentValuesRef.current = { title: note?.title || "", content: note?.content || "", tags: note?.tags || [] };
    // Focus title for new notes
    if (!note?.id) {
      setTimeout(() => titleInputRef.current?.focus(), 50);
    }
  // Only re-sync when switching to a different note (note?.id).
  // Content/title/tags changes from props (e.g. after save callbacks or background refresh)
  // must NOT overwrite the editor — local state is the source of truth while editing.
  // The key={activeNoteId} on NoteEditor already handles full remount on note switch.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.id]);

  // Keep refs in sync with state
  useEffect(() => {
    currentValuesRef.current = { title, content, tags };
  }, [title, content, tags]);

  useEffect(() => {
    currentNoteIdRef.current = currentNoteId;
  }, [currentNoteId]);

  const hasChanges = useCallback(() => {
    const saved = lastSavedRef.current;
    return (
      currentValuesRef.current.title !== saved.title ||
      currentValuesRef.current.content !== saved.content ||
      JSON.stringify(currentValuesRef.current.tags) !== saved.tags
    );
  }, []);

  // Core save function
  const performSave = useCallback(async () => {
    const { title: t, content: c, tags: tg } = currentValuesRef.current;
    const noteId = currentNoteIdRef.current;

    // For new notes: POST to create
    if (!noteId) {
      if (isCreatingRef.current) return;
      isCreatingRef.current = true;
      setSaveStatus("saving");
      try {
        const response = await fetch("/api/notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: t || "Untitled",
            content: c,
            tags: tg.length > 0 ? tg : null,
          }),
        });
        if (response.ok) {
          const savedNote = await response.json();
          setCurrentNoteId(savedNote.id);
          currentNoteIdRef.current = savedNote.id;
          lastSavedRef.current = { title: t, content: c, tags: JSON.stringify(tg) };
          setSaveStatus("saved");
          setTimeout(() => setSaveStatus("idle"), 1500);
          onCreate?.(savedNote);
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

    // For existing notes: check if changed
    if (!hasChanges()) return;

    setSaveStatus("saving");
    try {
      const response = await fetch(`/api/notes/${noteId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: t,
          content: c,
          tags: tg.length > 0 ? tg : null,
        }),
      });
      if (response.ok) {
        // Only update lastSaved after server confirms
        lastSavedRef.current = { title: t, content: c, tags: JSON.stringify(tg) };
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 1500);
        onSave?.({
          id: noteId,
          title: t,
          content: c,
          tags: tg.length > 0 ? tg : null,
          updated_at: new Date(),
        });
      } else {
        setSaveStatus("error");
        // Retry once after 2s
        retryTimerRef.current = setTimeout(async () => {
          try {
            const retryRes = await fetch(`/api/notes/${noteId}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ title: t, content: c, tags: tg.length > 0 ? tg : null }),
            });
            if (retryRes.ok) {
              lastSavedRef.current = { title: t, content: c, tags: JSON.stringify(tg) };
              setSaveStatus("saved");
              setTimeout(() => setSaveStatus("idle"), 1500);
              onSave?.({ id: noteId, title: t, content: c, tags: tg.length > 0 ? tg : null, updated_at: new Date() });
            }
          } catch {
            // Stay in error state — user can see the error indicator
          }
        }, 2000);
      }
    } catch {
      setSaveStatus("error");
      // Retry once after 2s
      retryTimerRef.current = setTimeout(async () => {
        try {
          const retryRes = await fetch(`/api/notes/${noteId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: t, content: c, tags: tg.length > 0 ? tg : null }),
          });
          if (retryRes.ok) {
            lastSavedRef.current = { title: t, content: c, tags: JSON.stringify(tg) };
            setSaveStatus("saved");
            setTimeout(() => setSaveStatus("idle"), 1500);
            onSave?.({ id: noteId, title: t, content: c, tags: tg.length > 0 ? tg : null, updated_at: new Date() });
          }
        } catch {
          // Stay in error state
        }
      }, 2000);
    }
  }, [hasChanges, onSave, onCreate]);

  // Debounced auto-save on content change (500ms)
  useEffect(() => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    if (!hasChanges() && currentNoteIdRef.current) return;
    // For new notes, don't auto-create until there's some content or title
    if (!currentNoteIdRef.current && !title.trim() && !content.trim()) return;

    autoSaveTimerRef.current = setTimeout(() => {
      performSave();
    }, 500);

    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    };
  }, [title, content, tags, performSave, hasChanges]);

  // Periodic save every 30s as safety net
  useEffect(() => {
    periodicTimerRef.current = setInterval(() => {
      if (hasChanges() && currentNoteIdRef.current) {
        performSave();
      }
    }, 5000);
    return () => {
      if (periodicTimerRef.current) clearInterval(periodicTimerRef.current);
    };
  }, [performSave, hasChanges]);

  // sendBeacon on beforeunload to flush pending saves
  useEffect(() => {
    const handleBeforeUnload = () => {
      const noteId = currentNoteIdRef.current;
      if (!noteId) return;
      const saved = lastSavedRef.current;
      const current = currentValuesRef.current;
      if (
        current.title === saved.title &&
        current.content === saved.content &&
        JSON.stringify(current.tags) === saved.tags
      ) return;

      // Use sendBeacon to flush the save
      const data = JSON.stringify({
        title: current.title,
        content: current.content,
        tags: current.tags.length > 0 ? current.tags : null,
      });
      navigator.sendBeacon(`/api/notes/${noteId}`, new Blob([data], { type: "application/json" }));
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  // Cleanup timers
  useEffect(() => {
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, []);

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

  const handleDelete = async () => {
    if (!currentNoteId) return;
    setIsDeleting(true);
    try {
      const response = await fetch(`/api/notes/${currentNoteId}`, { method: "DELETE" });
      if (response.ok) {
        onDelete?.(currentNoteId);
      }
    } catch (error) {
      console.error("Error deleting note:", error);
    } finally {
      setIsDeleting(false);
      setDeleteOpen(false);
    }
  };

  const handleManualRetry = () => {
    setSaveStatus("idle");
    performSave();
  };

  return (
    <div className="flex flex-col h-full">
      {/* Top bar with save status and actions */}
      <div className="flex items-center justify-between gap-4 px-4 py-2 border-b shrink-0">
        <div className="flex items-center gap-2 text-sm">
          {onBack && (
            <Button variant="ghost" size="sm" className="md:hidden h-8 w-8 p-0 mr-1" onClick={onBack}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
          {saveStatus === "saving" && (
            <span className="text-muted-foreground flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />
              Saving...
            </span>
          )}
          {saveStatus === "saved" && (
            <span className="text-green-600 flex items-center gap-1">
              <Check className="h-3 w-3" />
              Saved
            </span>
          )}
          {saveStatus === "error" && (
            <span className="text-red-600 flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />
              Save failed
              <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={handleManualRetry}>
                Retry
              </Button>
            </span>
          )}
        </div>
        {currentNoteId && (
          <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 text-muted-foreground hover:text-destructive">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Delete Note</DialogTitle>
                <DialogDescription>
                  Are you sure you want to delete this note? This action cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={isDeleting}>
                  Cancel
                </Button>
                <Button variant="destructive" onClick={handleDelete} disabled={isDeleting}>
                  {isDeleting ? "Deleting..." : "Delete"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Editor content */}
      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-20 md:pb-4 space-y-4">
        {/* Title input */}
        <Input
          ref={titleInputRef}
          placeholder="Untitled"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="text-lg md:text-xl font-semibold border-none shadow-none focus-visible:ring-0 px-0 h-10 md:h-auto"
        />

        {/* Tags section */}
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1">
            {tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="gap-1 h-7 md:h-auto">
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
            className="max-w-xs h-10 md:h-auto text-sm"
          />
        </div>

        {/* Content textarea */}
        <Textarea
          placeholder="Start writing..."
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="min-h-[200px] md:min-h-[500px] resize-none font-mono text-base leading-relaxed border-none shadow-none focus-visible:ring-0 px-0 textarea-autogrow"
        />
      </div>
    </div>
  );
}
