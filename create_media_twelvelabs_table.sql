-- Create media_twelvelabs table for V3 integration
-- This table stores the persistent status of Twelvelabs video indexing operations

CREATE TABLE IF NOT EXISTS media_twelvelabs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  media_id VARCHAR(255) NOT NULL,
  project_id VARCHAR(255) NOT NULL,
  twelve_labs_video_id VARCHAR(255),
  twelve_labs_task_id VARCHAR(255),
  indexing_status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (indexing_status IN ('pending', 'processing', 'completed', 'failed')),
  indexing_progress INTEGER DEFAULT 0 CHECK (indexing_progress >= 0 AND indexing_progress <= 100),
  error_message TEXT,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Ensure unique combination of media_id and project_id
  UNIQUE(media_id, project_id)
);

-- Create indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_media_twelvelabs_media_id ON media_twelvelabs(media_id);
CREATE INDEX IF NOT EXISTS idx_media_twelvelabs_project_id ON media_twelvelabs(project_id);
CREATE INDEX IF NOT EXISTS idx_media_twelvelabs_status ON media_twelvelabs(indexing_status);
CREATE INDEX IF NOT EXISTS idx_media_twelvelabs_twelve_labs_video_id ON media_twelvelabs(twelve_labs_video_id);
CREATE INDEX IF NOT EXISTS idx_media_twelvelabs_twelve_labs_task_id ON media_twelvelabs(twelve_labs_task_id);

-- Add RLS (Row Level Security) policies
ALTER TABLE media_twelvelabs ENABLE ROW LEVEL SECURITY;

-- Policy: Allow all operations for service role (for server-side operations)
CREATE POLICY "Allow service role full access" ON media_twelvelabs
  FOR ALL USING (auth.role() = 'service_role');

-- Policy: Allow authenticated users to access their own project data
CREATE POLICY "Users can access their own project data" ON media_twelvelabs
  FOR ALL USING (
    -- This would need to be adapted based on your user/project relationship
    -- For now, allowing authenticated users to access all data
    auth.role() = 'authenticated'
  );

-- Function to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at on row changes
DROP TRIGGER IF EXISTS update_media_twelvelabs_updated_at ON media_twelvelabs;
CREATE TRIGGER update_media_twelvelabs_updated_at
  BEFORE UPDATE ON media_twelvelabs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Grant necessary permissions
GRANT ALL ON media_twelvelabs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON media_twelvelabs TO authenticated;

-- Add some helpful comments
COMMENT ON TABLE media_twelvelabs IS 'Stores persistent status and metadata for Twelvelabs video indexing operations';
COMMENT ON COLUMN media_twelvelabs.media_id IS 'UUID of the media file in the local system';
COMMENT ON COLUMN media_twelvelabs.project_id IS 'UUID of the project containing this media';
COMMENT ON COLUMN media_twelvelabs.twelve_labs_video_id IS 'Video ID returned by Twelvelabs after upload';
COMMENT ON COLUMN media_twelvelabs.twelve_labs_task_id IS 'Task ID for tracking indexing progress in Twelvelabs';
COMMENT ON COLUMN media_twelvelabs.indexing_status IS 'Current status of the indexing process';
COMMENT ON COLUMN media_twelvelabs.indexing_progress IS 'Percentage completion of indexing (0-100)';
COMMENT ON COLUMN media_twelvelabs.metadata IS 'Additional metadata from Twelvelabs API responses';