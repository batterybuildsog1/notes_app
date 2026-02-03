"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

export function QuickAddDialog() {
  return (
    <Button
      asChild
      size="icon"
      className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-lg z-50"
    >
      <Link href="/notes/new">
        <Plus className="h-6 w-6" />
        <span className="sr-only">Create new note</span>
      </Link>
    </Button>
  );
}
