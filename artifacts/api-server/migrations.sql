-- CRRNT — Full Supabase Schema Migration
-- Run this in the Supabase SQL editor (Project → SQL Editor → New query)
-- Execute the whole file top-to-bottom once.

-- ─────────────────────────────────────────
-- TABLES
-- ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  tier TEXT DEFAULT 'free',
  subscription_status TEXT DEFAULT 'none',
  subscription_expires_at TIMESTAMP WITH TIME ZONE,
  revenuecat_customer_id TEXT,
  notification_consent BOOLEAN DEFAULT FALSE,
  onboarding_complete BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  job_type TEXT,
  housing_status TEXT,
  city TEXT,
  financial_goals TEXT[],
  life_stage TEXT,
  interests TEXT[],
  income_bracket TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id TEXT UNIQUE,
  title TEXT,
  category TEXT,
  tier TEXT DEFAULT 'free',
  published_at TIMESTAMP WITH TIME ZONE,
  source_url TEXT,
  media_url TEXT,

  summary TEXT,
  life_impact TEXT,
  wallet_impact TEXT,
  stock_note TEXT,
  one_liner TEXT,

  tts_url TEXT,

  sentiment_label TEXT,
  sentiment_score FLOAT,
  people_say TEXT,

  expires_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS story_audio (
  story_id UUID PRIMARY KEY REFERENCES stories(id) ON DELETE CASCADE,
  mp3_data BYTEA NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS saved_stories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  story_id UUID REFERENCES stories(id),
  saved_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, story_id)
);

CREATE TABLE IF NOT EXISTS breaking_news (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  headline TEXT NOT NULL,
  link TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() + INTERVAL '6 hours'
);

CREATE TABLE IF NOT EXISTS ingestion_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  stories_fetched INT DEFAULT 0,
  stories_enriched INT DEFAULT 0,
  tts_generated INT DEFAULT 0,
  errors INT DEFAULT 0,
  status TEXT,
  notes TEXT
);

-- ─────────────────────────────────────────
-- INDEXES
-- ─────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_stories_category ON stories(category);
CREATE INDEX IF NOT EXISTS idx_stories_tier ON stories(tier);
CREATE INDEX IF NOT EXISTS idx_stories_published_at ON stories(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_stories_expires_at ON stories(expires_at);
CREATE INDEX IF NOT EXISTS idx_saved_stories_user_id ON saved_stories(user_id);
CREATE INDEX IF NOT EXISTS idx_user_preferences_user_id ON user_preferences(user_id);

-- ─────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE stories ENABLE ROW LEVEL SECURITY;
ALTER TABLE story_audio ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_stories ENABLE ROW LEVEL SECURITY;
ALTER TABLE breaking_news ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingestion_logs ENABLE ROW LEVEL SECURITY;

-- users: own row only
CREATE POLICY "users_self_select" ON users FOR SELECT USING (auth.uid() = id);
CREATE POLICY "users_self_update" ON users FOR UPDATE USING (auth.uid() = id);

-- user_preferences: own row only
CREATE POLICY "prefs_self" ON user_preferences USING (auth.uid() = user_id);
CREATE POLICY "prefs_self_insert" ON user_preferences FOR INSERT WITH CHECK (auth.uid() = user_id);

-- stories: free tier readable by any authenticated user
CREATE POLICY "stories_free" ON stories FOR SELECT USING (
  tier = 'free' AND auth.role() = 'authenticated'
);
-- paid stories readable only by paid users
CREATE POLICY "stories_paid" ON stories FOR SELECT USING (
  tier = 'paid'
  AND auth.uid() IN (SELECT id FROM users WHERE tier = 'paid')
);

-- story_audio: same gating as stories
CREATE POLICY "audio_free" ON story_audio FOR SELECT USING (
  story_id IN (SELECT id FROM stories WHERE tier = 'free')
  AND auth.role() = 'authenticated'
);
CREATE POLICY "audio_paid" ON story_audio FOR SELECT USING (
  story_id IN (SELECT id FROM stories WHERE tier = 'paid')
  AND auth.uid() IN (SELECT id FROM users WHERE tier = 'paid')
);

-- saved_stories: own rows only
CREATE POLICY "saved_self" ON saved_stories USING (auth.uid() = user_id);
CREATE POLICY "saved_self_insert" ON saved_stories FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "saved_self_delete" ON saved_stories FOR DELETE USING (auth.uid() = user_id);

-- breaking_news: readable by all authenticated users
CREATE POLICY "breaking_read" ON breaking_news FOR SELECT USING (auth.role() = 'authenticated');

-- ingestion_logs: service role only (no user-facing policy needed)

-- Push notification tokens (pre-auth, anonymous device tokens)
CREATE TABLE IF NOT EXISTS push_tokens (
  token TEXT PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- No RLS on push_tokens — backend-only writes via service role key

-- ─────────────────────────────────────────
-- STORAGE BUCKET (run separately in Storage tab or via API)
-- ─────────────────────────────────────────
-- Create a bucket named "story-audio" set to PUBLIC.
-- In Supabase dashboard: Storage → New bucket → Name: story-audio → Public: ON
-- OR via API:
-- INSERT INTO storage.buckets (id, name, public) VALUES ('story-audio', 'story-audio', true);
