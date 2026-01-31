import { neon } from "@neondatabase/serverless";

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://neondb_owner:npg_fozBGX8c0mWy@ep-cold-brook-ahc6arrv-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require";

const sql = neon(DATABASE_URL);

const sampleNotes = [
  {
    title: "Getting Started with Notes",
    content: `# Welcome to Notes!

This is your personal notes app. Here's what you can do:

## Features

- **Create notes** using the + button
- **Search** with fuzzy matching
- **Filter** by category
- **Organize** with tags and priorities

## Markdown Support

You can write in **markdown** with:
- *Italic* and **bold** text
- Code blocks
- Lists and more!

Happy note-taking!`,
    category: "Personal",
    tags: ["welcome", "getting-started"],
    priority: "high",
  },
  {
    title: "Project Ideas",
    content: `# Project Ideas

## Web Apps
- [ ] Task manager with AI prioritization
- [ ] Recipe organizer with ingredient shopping list
- [ ] Personal finance dashboard

## Mobile Apps
- [ ] Habit tracker with streaks
- [ ] Quick note capture widget

## Learning Projects
- [ ] Build a CLI tool in Rust
- [ ] Create a VS Code extension
- [ ] Learn WebGL basics`,
    category: "Ideas",
    tags: ["projects", "planning"],
    priority: "medium",
  },
  {
    title: "Meeting Notes - Q1 Planning",
    content: `# Q1 Planning Meeting

**Date**: January 15, 2026
**Attendees**: Team

## Key Points

1. Focus on user experience improvements
2. Launch mobile-first features
3. Improve performance metrics

## Action Items

- [ ] Review current analytics
- [ ] Prepare user feedback summary
- [ ] Draft Q1 roadmap

## Next Steps

Schedule follow-up meeting for Feb 1st.`,
    category: "Work",
    tags: ["meetings", "planning", "q1"],
    priority: "high",
  },
  {
    title: "Book Notes: Atomic Habits",
    content: `# Atomic Habits by James Clear

## Key Takeaways

### The 4 Laws of Behavior Change

1. **Make it obvious** - Design your environment
2. **Make it attractive** - Bundle temptations
3. **Make it easy** - Reduce friction
4. **Make it satisfying** - Immediate rewards

### Quotes

> "You do not rise to the level of your goals. You fall to the level of your systems."

> "Every action is a vote for the type of person you wish to become."

### My Applications

- Morning routine: Lay out workout clothes the night before
- Learning: Stack new habits with existing ones
- Focus: Use environment design to reduce distractions`,
    category: "Reference",
    tags: ["books", "productivity", "habits"],
    priority: "low",
  },
];

async function seedNotes() {
  console.log("Seeding notes...");

  for (const note of sampleNotes) {
    await sql`
      INSERT INTO notes (title, content, category, tags, priority, created_at, updated_at)
      VALUES (
        ${note.title},
        ${note.content},
        ${note.category},
        ${note.tags},
        ${note.priority},
        NOW(),
        NOW()
      )
    `;
    console.log(`Created: ${note.title}`);
  }

  console.log("Seeding complete!");
}

seedNotes().catch(console.error);
