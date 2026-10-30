-- 004: vibe — Claude-assigned story tone for on-device feed
-- personalization: 'informed', 'entertained', or 'both' (NULL when the
-- model returns anything else, and for all pre-existing stories).
-- The app matches it against the user's on-device vibe tags; the value
-- itself never identifies a user. Run BEFORE deploying code that writes
-- vibe (the story insert is dynamic and names the column) — same
-- sequencing as 001 and 003.
ALTER TABLE stories ADD COLUMN IF NOT EXISTS vibe TEXT;
