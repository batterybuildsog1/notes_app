-- Migration: Entity Tables for CRM-Style Linking
-- Run against your Neon database

-- People entity table
CREATE TABLE IF NOT EXISTS people (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,  -- lowercase, alphanumeric only for dedup
  email TEXT,
  phone TEXT,
  company_id UUID,  -- References companies(id), added after companies table
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, normalized_name)
);

-- Companies entity table
CREATE TABLE IF NOT EXISTS companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  type TEXT,  -- 'bank', 'vendor', 'contractor', 'client', 'agency', 'llc', etc.
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, normalized_name)
);

-- Add foreign key to people after companies exists
ALTER TABLE people
  ADD CONSTRAINT fk_people_company
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL;

-- Projects entity table
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  status TEXT DEFAULT 'active',  -- 'active', 'completed', 'archived'
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, normalized_name)
);

-- Junction table: notes <-> people
CREATE TABLE IF NOT EXISTS note_people (
  note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  person_id UUID NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (note_id, person_id)
);

-- Junction table: notes <-> companies
CREATE TABLE IF NOT EXISTS note_companies (
  note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (note_id, company_id)
);

-- Junction table: notes <-> projects
CREATE TABLE IF NOT EXISTS note_projects (
  note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (note_id, project_id)
);

-- Clarifications table (replaces in-memory store)
CREATE TABLE IF NOT EXISTS clarifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT,
  telegram_message_id INTEGER,
  status TEXT DEFAULT 'pending',  -- 'pending', 'answered', 'applied'
  created_at TIMESTAMP DEFAULT NOW(),
  answered_at TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_people_user_id ON people(user_id);
CREATE INDEX IF NOT EXISTS idx_people_normalized ON people(user_id, normalized_name);
CREATE INDEX IF NOT EXISTS idx_companies_user_id ON companies(user_id);
CREATE INDEX IF NOT EXISTS idx_companies_normalized ON companies(user_id, normalized_name);
CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_normalized ON projects(user_id, normalized_name);
CREATE INDEX IF NOT EXISTS idx_note_people_note ON note_people(note_id);
CREATE INDEX IF NOT EXISTS idx_note_people_person ON note_people(person_id);
CREATE INDEX IF NOT EXISTS idx_note_companies_note ON note_companies(note_id);
CREATE INDEX IF NOT EXISTS idx_note_companies_company ON note_companies(company_id);
CREATE INDEX IF NOT EXISTS idx_note_projects_note ON note_projects(note_id);
CREATE INDEX IF NOT EXISTS idx_note_projects_project ON note_projects(project_id);
CREATE INDEX IF NOT EXISTS idx_clarifications_note ON clarifications(note_id);
CREATE INDEX IF NOT EXISTS idx_clarifications_pending ON clarifications(user_id, status) WHERE status = 'pending';
