-- D1 Schema for Labeller App v2 (Multiple Labels per Article)

DROP TABLE IF EXISTS labels; -- Drop dependent table first
DROP TABLE IF EXISTS articles;

CREATE TABLE articles (
    id INTEGER PRIMARY KEY,             -- Original ID from CSV
    title TEXT NOT NULL,
    alltext TEXT NOT NULL
    -- No longer tracking labelling status directly here
);

CREATE TABLE labels (
    id INTEGER PRIMARY KEY AUTOINCREMENT, -- Auto ID for each label entry
    article_id INTEGER NOT NULL,          -- Foreign key to articles table
    username TEXT NOT NULL,               -- User who submitted this label
    rating INTEGER,                       -- 1, 2, 3, 4 (NULL if 'Not sure')
    rating_text TEXT,                     -- Stores 'Not sure' if applicable
    submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP, -- Timestamp of submission
    roaddanger_volunteer INTEGER DEFAULT 0, -- Flag for Road Danger volunteers (0 = false, 1 = true)
    FOREIGN KEY (article_id) REFERENCES articles(id)
);

-- Indexes
CREATE INDEX idx_labels_article_id ON labels (article_id);
CREATE INDEX idx_labels_username ON labels (username);
-- Index to quickly find articles needing labels (useful for next-article query)
-- This might need refinement based on query performance, but it's a start
CREATE INDEX idx_labels_article_rating_count ON labels (article_id, rating);
CREATE INDEX idx_labels_roaddanger ON labels (roaddanger_volunteer); -- Index for the new flag 