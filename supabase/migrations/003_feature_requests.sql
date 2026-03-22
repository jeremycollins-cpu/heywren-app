-- Create feature_requests table
CREATE TABLE IF NOT EXISTS feature_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('Integration', 'Feature', 'UX', 'Performance', 'Other')),
  status TEXT NOT NULL DEFAULT 'Under Review' CHECK (status IN ('Under Review', 'Planned', 'In Progress', 'Shipped')),
  author_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  author_name TEXT NOT NULL,
  vote_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create feature_request_votes table
CREATE TABLE IF NOT EXISTS feature_request_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES feature_requests(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(request_id, user_id)
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS feature_requests_status_idx ON feature_requests(status);
CREATE INDEX IF NOT EXISTS feature_requests_category_idx ON feature_requests(category);
CREATE INDEX IF NOT EXISTS feature_requests_vote_count_idx ON feature_requests(vote_count DESC);
CREATE INDEX IF NOT EXISTS feature_request_votes_user_idx ON feature_request_votes(user_id);

-- Create function to update vote count
CREATE OR REPLACE FUNCTION update_feature_request_vote_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE feature_requests
    SET vote_count = (SELECT COUNT(*) FROM feature_request_votes WHERE request_id = NEW.request_id),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = NEW.request_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE feature_requests
    SET vote_count = (SELECT COUNT(*) FROM feature_request_votes WHERE request_id = OLD.request_id),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = OLD.request_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to update vote count
DROP TRIGGER IF NOT EXISTS feature_request_vote_count_trigger ON feature_request_votes;
CREATE TRIGGER feature_request_vote_count_trigger
AFTER INSERT OR DELETE ON feature_request_votes
FOR EACH ROW
EXECUTE FUNCTION update_feature_request_vote_count();

-- Enable RLS
ALTER TABLE feature_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_request_votes ENABLE ROW LEVEL SECURITY;

-- RLS policies for feature_requests
-- Everyone can read all feature requests
CREATE POLICY "Anyone can read feature requests"
  ON feature_requests
  FOR SELECT
  USING (true);

-- Authenticated users can create feature requests
CREATE POLICY "Authenticated users can create feature requests"
  ON feature_requests
  FOR INSERT
  WITH CHECK (auth.uid() = author_id);

-- Users can only update their own feature requests
CREATE POLICY "Users can update their own requests"
  ON feature_requests
  FOR UPDATE
  USING (auth.uid() = author_id)
  WITH CHECK (auth.uid() = author_id);

-- Users can only delete their own feature requests
CREATE POLICY "Users can delete their own requests"
  ON feature_requests
  FOR DELETE
  USING (auth.uid() = author_id);

-- RLS policies for feature_request_votes
-- Everyone can read votes
CREATE POLICY "Anyone can read feature request votes"
  ON feature_request_votes
  FOR SELECT
  USING (true);

-- Authenticated users can create votes (insert their own vote)
CREATE POLICY "Authenticated users can vote"
  ON feature_request_votes
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own votes
CREATE POLICY "Users can remove their own votes"
  ON feature_request_votes
  FOR DELETE
  USING (auth.uid() = user_id);
