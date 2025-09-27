# Crypto Memory Game - Supabase Integration Setup

## 🚀 Setup Instructions

### 1. Create Supabase Project
1. Go to [supabase.com](https://supabase.com)
2. Create a new project
3. Wait for the project to be provisioned

### 2. Set up Database Schema
1. Go to your Supabase project dashboard
2. Navigate to **SQL Editor**
3. Copy and paste the contents of `supabase_schema.sql`
4. Run the SQL script to create tables and policies

### 3. Get Supabase Credentials
1. Go to **Settings** → **API**
2. Copy your **Project URL** and **anon/public key**
3. Replace the placeholders in `script.js`:
   ```javascript
   const SUPABASE_URL = 'YOUR_SUPABASE_URL'; // Replace with your URL
   const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY'; // Replace with your key
   ```

### 4. Configure Authentication (Optional)
- For enhanced security, you can set up Supabase Auth
- Current setup works with anonymous users using generated IDs

## 📊 Database Features

### Daily Game Limits & Break System
- **6 games per level per day** per user (Level 1: 6 games, Level 2: 6 games, etc.)
- **Global break system: 3 games per 15 minutes across ALL levels**
- **Win or lose both count** as 1 game toward both limits
- **Resets at 1 AM UTC** (not midnight)
- **Example**: Play Level 3 twice (lose both) → 4 attempts left for Level 3, but must wait 15min before playing ANY level

### Weekly Scoring System
- **Score Formula**: `level_width × level_height × seconds_remaining`
- Examples:
  - Level 1 (2×2) with 30 seconds left = 2 × 2 × 30 = **120 points**
  - Level 3 (4×4) with 15 seconds left = 4 × 4 × 15 = **240 points**
  - Level 6 (6×5) with 45 seconds left = 6 × 5 × 45 = **1350 points**

### Weekly Leaderboard
- **New table starts each week** (Monday to Sunday)
- **Week format**: YYYY-WW (e.g., "2025-39")
- **Aggregated scores**: Total points per user per week
- **Ranking**: By total weekly points (all levels combined)

### Database Tables

#### `daily_games`
- Tracks daily play limits per level
- Fields: user_id, level, date, games_played

#### `user_break_status`  
- Tracks global break system (3 games per 15min across all levels)
- Fields: user_id, date, games_in_session, session_start, break_until

#### `weekly_scores`
- Stores all game results
- Fields: user_id, username, level, score, time_remaining, moves, week

#### `user_profiles` (Optional)
- User profile information
- Can be extended with Farcaster integration

## 🎮 Game Flow

1. **Check Daily Limit**: Before starting a level, check if user has games left
2. **Play Game**: User plays with 60-second countdown
3. **Calculate Score**: On completion, calculate score using formula
4. **Save to Database**: Store result in weekly_scores table
5. **Update Counter**: Increment daily game counter
6. **Show Leaderboard**: Display weekly rankings

## 🔐 Security Features

- **Row Level Security (RLS)** enabled on all tables
- **Users can only modify their own data**
- **Public read access** for leaderboards
- **Anonymous user support** with generated IDs

## 🛠 Testing

After setup, test the integration:
1. Play a few games to generate data
2. Check the leaderboard screen
3. Verify daily limits work (try playing 7+ games on same level)
4. Check Supabase dashboard to see data

## 🎯 Future Enhancements

- **Farcaster Integration**: Link user IDs to Farcaster accounts
- **Push Notifications**: Weekly leaderboard updates
- **Tournaments**: Special weekly challenges
- **Achievements**: Badges for milestones
- **Analytics**: Track popular levels and play patterns

## 📝 Notes

- **Week starts Monday 00:00 UTC**
- **Daily limits reset at midnight UTC**
- **Scores are cumulative per week across all levels**
- **Higher levels with more time remaining = higher scores**
- **Strategy**: Balance speed vs difficulty for maximum weekly points