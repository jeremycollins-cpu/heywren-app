-- Add assigned_to for tagging teammates on todos
ALTER TABLE todos ADD COLUMN assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX idx_todos_assigned_to ON todos(assigned_to);

-- Update RLS: users can also see todos assigned to them
DROP POLICY IF EXISTS "Users can view own todos" ON todos;
CREATE POLICY "Users can view own or assigned todos"
  ON todos FOR SELECT
  USING (auth.uid() = user_id OR auth.uid() = assigned_to);
