-- Allow users to dismiss/close-out wren mentions from the Mentions page.

ALTER TABLE wren_mentions ADD COLUMN dismissed BOOLEAN NOT NULL DEFAULT false;

-- Update RLS: allow users to update their own mentions (for dismiss)
CREATE POLICY "Users can update their own mentions"
  ON wren_mentions FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
