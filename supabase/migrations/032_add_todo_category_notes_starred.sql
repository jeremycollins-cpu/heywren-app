-- =============================================================================
-- Migration 032: Add category, notes, and starred fields to todos
-- Supports optional categorization, freeform notes, and starring/prioritizing.
-- =============================================================================

-- Add category column (optional — NULL means uncategorized)
ALTER TABLE todos
  ADD COLUMN IF NOT EXISTS category TEXT;

-- Add notes column (optional freeform text)
ALTER TABLE todos
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- Add starred column for quick prioritization
ALTER TABLE todos
  ADD COLUMN IF NOT EXISTS starred BOOLEAN NOT NULL DEFAULT false;

-- Index for filtering by category
CREATE INDEX IF NOT EXISTS idx_todos_user_category ON todos(user_id, category);

-- Index for starred items
CREATE INDEX IF NOT EXISTS idx_todos_user_starred ON todos(user_id, starred);
