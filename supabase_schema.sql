-- Crypto Memory Game Database Schema for Supabase

-- Table for tracking daily game limits per user per level
CREATE TABLE daily_games (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    level INTEGER NOT NULL,
    date DATE NOT NULL,
    games_played INTEGER DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure one record per user per level per day
    UNIQUE(user_id, level, date)
);

-- Table for tracking global break system (3 consecutive failures trigger 15min break)
CREATE TABLE user_break_status (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    date DATE NOT NULL,
    consecutive_failures INTEGER DEFAULT 0, -- Consecutive game failures
    last_game_result VARCHAR(10), -- 'win' or 'fail' - tracks the last game outcome
    session_start TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    break_until TIMESTAMP WITH TIME ZONE, -- When current break period ends
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure one record per user per day
    UNIQUE(user_id, date)
);

-- Table for weekly scores and leaderboard
CREATE TABLE weekly_scores (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    username VARCHAR(50) NOT NULL,
    level INTEGER NOT NULL,
    score INTEGER NOT NULL, -- Calculated as width * height * time_remaining
    time_remaining INTEGER NOT NULL, -- Seconds remaining when completed
    moves INTEGER NOT NULL,
    week VARCHAR(10) NOT NULL, -- Format: YYYY-WW (e.g., "2025-39")
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table for user profiles (optional - can be enhanced later)
CREATE TABLE user_profiles (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) UNIQUE NOT NULL,
    username VARCHAR(50),
    farcaster_fid INTEGER, -- Farcaster ID if connected
    farcaster_username VARCHAR(50), -- Farcaster username
    email VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable Row Level Security (RLS)
ALTER TABLE daily_games ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_break_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- RLS Policies for daily_games
-- Users can read and update their own daily game records
CREATE POLICY "Users can view own daily games" ON daily_games
    FOR SELECT USING (auth.uid()::text = user_id OR user_id LIKE 'user_%');

CREATE POLICY "Users can insert own daily games" ON daily_games
    FOR INSERT WITH CHECK (auth.uid()::text = user_id OR user_id LIKE 'user_%');

CREATE POLICY "Users can update own daily games" ON daily_games
    FOR UPDATE USING (auth.uid()::text = user_id OR user_id LIKE 'user_%');

-- RLS Policies for user_break_status
-- Users can read and update their own break status records
CREATE POLICY "Users can view own break status" ON user_break_status
    FOR SELECT USING (auth.uid()::text = user_id OR user_id LIKE 'user_%');

CREATE POLICY "Users can insert own break status" ON user_break_status
    FOR INSERT WITH CHECK (auth.uid()::text = user_id OR user_id LIKE 'user_%');

CREATE POLICY "Users can update own break status" ON user_break_status
    FOR UPDATE USING (auth.uid()::text = user_id OR user_id LIKE 'user_%');

-- RLS Policies for weekly_scores
-- Users can read all scores (for leaderboard) but only insert their own
CREATE POLICY "Anyone can view weekly scores" ON weekly_scores
    FOR SELECT USING (true);

CREATE POLICY "Users can insert own scores" ON weekly_scores
    FOR INSERT WITH CHECK (auth.uid()::text = user_id OR user_id LIKE 'user_%');

-- RLS Policies for user_profiles
-- Users can read and update their own profile
CREATE POLICY "Users can view own profile" ON user_profiles
    FOR SELECT USING (auth.uid()::text = user_id OR user_id LIKE 'user_%');

CREATE POLICY "Users can insert own profile" ON user_profiles
    FOR INSERT WITH CHECK (auth.uid()::text = user_id OR user_id LIKE 'user_%');

CREATE POLICY "Users can update own profile" ON user_profiles
    FOR UPDATE USING (auth.uid()::text = user_id OR user_id LIKE 'user_%');

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
CREATE TRIGGER update_daily_games_updated_at BEFORE UPDATE ON daily_games 
    FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_user_break_status_updated_at BEFORE UPDATE ON user_break_status 
    FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_user_profiles_updated_at BEFORE UPDATE ON user_profiles 
    FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- Function to handle upsert for daily_games
CREATE OR REPLACE FUNCTION upsert_daily_game(
    p_user_id VARCHAR(255),
    p_level INTEGER,
    p_date DATE
) RETURNS VOID AS $$
BEGIN
    INSERT INTO daily_games (user_id, level, date, games_played)
    VALUES (p_user_id, p_level, p_date, 1)
    ON CONFLICT (user_id, level, date)
    DO UPDATE SET 
        games_played = daily_games.games_played + 1,
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- Function to handle upsert for user_break_status
CREATE OR REPLACE FUNCTION upsert_break_status(
    p_user_id VARCHAR(255),
    p_date DATE,
    p_games_in_session INTEGER,
    p_session_start TIMESTAMP WITH TIME ZONE,
    p_break_until TIMESTAMP WITH TIME ZONE
) RETURNS VOID AS $$
BEGIN
    INSERT INTO user_break_status (user_id, date, games_in_session, session_start, break_until)
    VALUES (p_user_id, p_date, p_games_in_session, p_session_start, p_break_until)
    ON CONFLICT (user_id, date)
    DO UPDATE SET 
        games_in_session = p_games_in_session,
        session_start = p_session_start,
        break_until = p_break_until,
        updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

-- Additional indexes for better performance
CREATE INDEX idx_daily_games_user_date ON daily_games (user_id, date);
CREATE INDEX idx_user_break_status_user_date ON user_break_status (user_id, date);
CREATE INDEX idx_weekly_scores_week ON weekly_scores (week);
CREATE INDEX idx_weekly_scores_user_week ON weekly_scores (user_id, week);
CREATE INDEX idx_weekly_scores_score ON weekly_scores (score DESC);
CREATE INDEX idx_weekly_scores_level ON weekly_scores (level);
CREATE INDEX idx_weekly_scores_created_at ON weekly_scores (created_at);
CREATE INDEX idx_user_profiles_farcaster_fid ON user_profiles (farcaster_fid);

-- View for weekly leaderboard aggregation
CREATE OR REPLACE VIEW weekly_leaderboard AS
SELECT 
    user_id,
    username,
    week,
    SUM(score) as total_score,
    COUNT(*) as games_played,
    AVG(score) as avg_score,
    MAX(score) as best_score,
    MAX(created_at) as last_played,
    ROW_NUMBER() OVER (PARTITION BY week ORDER BY SUM(score) DESC) as rank
FROM weekly_scores
GROUP BY user_id, username, week
ORDER BY week DESC, total_score DESC;

-- View for daily game summary
CREATE OR REPLACE VIEW daily_game_summary AS
SELECT 
    dg.user_id,
    dg.date,
    dg.level,
    dg.games_played,
    (6 - dg.games_played) as games_remaining,
    ubs.games_in_session,
    ubs.break_until,
    CASE 
        WHEN ubs.break_until IS NOT NULL AND ubs.break_until > NOW() THEN true
        ELSE false
    END as on_break
FROM daily_games dg
LEFT JOIN user_break_status ubs ON dg.user_id = ubs.user_id AND dg.date = ubs.date;

-- Sample data (optional - for testing)
-- INSERT INTO weekly_scores (user_id, username, level, score, time_remaining, moves, week)
-- VALUES 
--     ('user_test_1', 'TestPlayer1', 1, 240, 30, 8, '2025-39'),
--     ('user_test_2', 'TestPlayer2', 1, 180, 22, 12, '2025-39'),
--     ('user_test_1', 'TestPlayer1', 2, 432, 18, 15, '2025-39');