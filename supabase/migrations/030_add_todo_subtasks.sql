-- Add parent_id for sub-todos (one level of nesting, like Notion)
ALTER TABLE todos ADD COLUMN parent_id UUID REFERENCES todos(id) ON DELETE CASCADE;
CREATE INDEX idx_todos_parent_id ON todos(parent_id);
