    -- Migration to add the roaddanger_volunteer column to the labels table
    ALTER TABLE labels
    ADD COLUMN roaddanger_volunteer INTEGER DEFAULT 0;
    
    -- Optional: Add an index for the new column (can be run separately if needed)
    CREATE INDEX IF NOT EXISTS idx_labels_roaddanger ON labels (roaddanger_volunteer);