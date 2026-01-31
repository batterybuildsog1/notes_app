-- Migration: Add user_id column to notes table
-- Default user_id: 3d866169-c8db-4d46-beef-dd6fc4daa930 (alan@sunhomes.io)

-- 1. Add the column (allowing NULL initially)
ALTER TABLE notes ADD COLUMN IF NOT EXISTS user_id TEXT;

-- 2. Populate existing notes with the default user_id
UPDATE notes SET user_id = '3d866169-c8db-4d46-beef-dd6fc4daa930' WHERE user_id IS NULL;

-- 3. Make the column NOT NULL and add foreign key constraint
ALTER TABLE notes ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE notes ADD CONSTRAINT fk_notes_user FOREIGN KEY (user_id) REFERENCES "user" (id) ON DELETE CASCADE;

-- 4. Add index for performance
CREATE INDEX IF NOT EXISTS notes_user_id_idx ON notes (user_id);
