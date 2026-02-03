"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { X, Save, ArrowLeft, Check, Loader2 } from "lucide-react";
import type { Note } from "@/lib/db";
import "@uiw/react-md-editor/markdown-editor.css";
import "@uiw/react-markdown-preview/markdown.css";

const MDEditor = dynamic(() => import("@uiw/react-md-editor"), { ssr: false });

interface NoteEditorProps {
  note?: Note;
  categories: string[];
}

const defaultCategories = ["Work", "Personal", "Ideas", "Reference", "Archive"];

type SaveStatus = "idle" | "saving" | "saved" | "error";

export function NoteEditor({ note, categories }: NoteEditorProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [title, setTitle] = useState(note?.title || "");
  const [content, setContent] = useState(note?.content || "");
  const [category, setCategory] = useState(note?.category || "");
  const [tags, setTags] = useState<string[]>(note?.tags || []);
  const [tagInput, setTagInput] = useState("");
  const [priority, setPriority] = useState(note?.priority || "");

  // Auto-save state
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [currentNoteId, setCurrentNoteId] = useState(note?.id);
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastSavedRef = useRef({ title: note?.title || "", content: note?.content || "" });

  const allCategories = [...new Set([...defaultCategories, ...categories])];

  // Auto-save function
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

    setSaveStatus("saving");
    try {
      const response = await fetch(`/api/notes/${currentNoteId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          content,
          category: category || null,
          tags: tags.length > 0 ? tags : null,
          priority: priority || null,
        }),
      });

      if (response.ok) {
        lastSavedRef.current = { title, content };
        setSaveStatus("saved");
        setHasUnsavedChanges(false);
        // Reset to idle after 2 seconds
        setTimeout(() => setSaveStatus("idle"), 2000);
      } else {
        setSaveStatus("error");
      }
    } catch {
      setSaveStatus("error");
    }
  }, [currentNoteId, title, content, category, tags, priority]);

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

    // Set new timer (3 second debounce)
    autoSaveTimerRef.current = setTimeout(() => {
      performAutoSave();
    }, 3000);

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
          category: category || null,
          tags: tags.length > 0 ? tags : null,
          priority: priority || null,
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
          // Update URL without full navigation
          window.history.replaceState(null, "", `/notes/${savedNote.id}/edit`);
        }

        router.push(`/notes/${savedNote.id}`);
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
      <div className="flex items-center justify-between gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleBack}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <div className="flex items-center gap-3">
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
          <Button onClick={handleSave} disabled={isLoading || !title.trim() || !content.trim()}>
            <Save className="h-4 w-4 mr-2" />
            {isLoading ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      <Input
        placeholder="Note title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="text-xl font-semibold"
      />

      <div className="flex flex-wrap gap-4">
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            {allCategories.map((cat) => (
              <SelectItem key={cat} value={cat}>
                {cat}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={priority} onValueChange={setPriority}>
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Priority" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>
      </div>

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
        />
      </div>

      <div data-color-mode="auto">
        <MDEditor
          value={content}
          onChange={(val) => setContent(val || "")}
          height={500}
          preview="live"
        />
      </div>
    </div>
  );
}
