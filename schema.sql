-- D1 Schema for Labeller App

DROP TABLE IF EXISTS articles;

CREATE TABLE articles (
    id INTEGER PRIMARY KEY,             -- Original ID from CSV
    title TEXT NOT NULL,
    alltext TEXT NOT NULL,
    is_labelled BOOLEAN DEFAULT FALSE,  -- Track if labelling is complete
    label_human_centered INTEGER,       -- 0 or 1
    label_active_voice INTEGER,         -- 0 or 1
    label_crash_vs_accident INTEGER,    -- 0 or 1
    label_human_story INTEGER,          -- 0 or 1
    labelled_by_user TEXT,              -- User who submitted the label
    version INTEGER NOT NULL DEFAULT 0  -- Optimistic locking version
);

-- Indexes
CREATE INDEX idx_labelled_status ON articles (is_labelled);
CREATE INDEX idx_labelled_by_user ON articles (labelled_by_user, is_labelled); 