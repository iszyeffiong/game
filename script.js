// Enhanced Memory Game with Start Screen and History
// Based on original work by Nate Wiley

(function(){

	// Supabase Configuration
	const SUPABASE_URL = 'https://bzjdctbqwhzrtlrfulni.supabase.co';
	const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ6amRjdGJxd2h6cnRscmZ1bG5pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg5OTcxMDEsImV4cCI6MjA3NDU3MzEwMX0.WJPjMeIWEpbKogO29D51FjgIAvpvgygdAkdWMigDaWU';
	
	let supabase;
	
	// Initialize Supabase client
	function initSupabase() {
		try {
			if (typeof window.supabase !== 'undefined' && SUPABASE_URL !== 'YOUR_SUPABASE_URL') {
				supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
				console.log('✅ Supabase initialized successfully');
				return true;
			} else {
				console.warn('⚠️ Supabase not initialized - using local storage fallback');
				return false;
			}
		} catch (error) {
			console.error('❌ Supabase initialization failed:', error);
			supabase = null;
			return false;
		}
	}
	
	// Database functions
	const DatabaseManager = {
		// Get current week identifier (YYYY-WW format)
		getCurrentWeek: function() {
			const now = new Date();
			const startOfYear = new Date(now.getFullYear(), 0, 1);
			const weekNumber = Math.ceil((((now - startOfYear) / 86400000) + startOfYear.getDay() + 1) / 7);
			return `${now.getFullYear()}-${weekNumber.toString().padStart(2, '0')}`;
		},
		
		// Get today's date string based on 1 AM UTC reset
		getGameDay: function() {
			const now = new Date();
			const utcHour = now.getUTCHours();
			
			// If it's before 1 AM UTC, consider it the previous day
			if (utcHour < 1) {
				const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
				return yesterday.toISOString().split('T')[0];
			}
			
			return now.toISOString().split('T')[0];
		},
		
		// Check global break status (3 games per 15min across all levels)
		checkGlobalBreakStatus: async function(userId) {
			if (!supabase) return { canPlay: true, onBreak: false, breakTimeLeft: 0, gamesInSession: 0 };
			
			try {
				const gameDay = this.getGameDay();
				const now = new Date();
				
				const { data, error } = await supabase
					.from('user_break_status')
					.select('games_in_session, session_start, break_until')
					.eq('user_id', userId)
					.eq('date', gameDay)
					.single();
				
				if (error && error.code !== 'PGRST116') {
					// No record found, user can play
					return { canPlay: true, onBreak: false, breakTimeLeft: 0, gamesInSession: 0 };
				}
				
				if (!data) {
					return { canPlay: true, onBreak: false, breakTimeLeft: 0, gamesInSession: 0 };
				}
				
				const sessionStart = new Date(data.session_start);
				const breakUntil = data.break_until ? new Date(data.break_until) : null;
				
				// Check if user is currently on break
				if (breakUntil && now < breakUntil) {
					const breakTimeLeft = Math.ceil((breakUntil - now) / 1000);
					return { canPlay: false, onBreak: true, breakTimeLeft: breakTimeLeft, gamesInSession: data.games_in_session };
				}
				
				// Check if 15 minutes have passed since session start (reset session)
				const sessionDurationMs = now - sessionStart;
				const fifteenMinutesMs = 15 * 60 * 1000;
				if (sessionDurationMs >= fifteenMinutesMs) {
					// Reset session
					await supabase
						.from('user_break_status')
						.upsert({
							user_id: userId,
							date: gameDay,
							games_in_session: 0,
							session_start: now.toISOString(),
							break_until: null
						});
					return { canPlay: true, onBreak: false, breakTimeLeft: 0, gamesInSession: 0 };
				}
				
				// Check if user has played 3 games in current session
				if (data.games_in_session >= 3) {
					// Set break until 15 minutes from session start
					const breakUntilTime = new Date(sessionStart.getTime() + 15 * 60 * 1000);
					await supabase
						.from('user_break_status')
						.update({ break_until: breakUntilTime.toISOString() })
						.eq('user_id', userId)
						.eq('date', gameDay);
					
					const breakTimeLeft = Math.ceil((breakUntilTime - now) / 1000);
					return { canPlay: false, onBreak: true, breakTimeLeft: breakTimeLeft, gamesInSession: data.games_in_session };
				}
				
				return { canPlay: true, onBreak: false, breakTimeLeft: 0, gamesInSession: data.games_in_session };
			} catch (error) {
				console.error('Error checking global break status:', error);
				return { canPlay: true, onBreak: false, breakTimeLeft: 0, gamesInSession: 0 };
			}
		},

		// Check daily game limit for a specific level
		checkDailyLimit: async function(userId, level) {
			if (!supabase) return { canPlay: true, gamesLeft: 6 };
			
			try {
				const gameDay = this.getGameDay();
				const { data, error } = await supabase
					.from('daily_games')
					.select('games_played')
					.eq('user_id', userId)
					.eq('level', level)
					.eq('date', gameDay)
					.single();
				
				if (error && error.code !== 'PGRST116') {
					console.error('Error checking daily limit:', error);
					return { canPlay: true, gamesLeft: 6 };
				}
				
				const gamesPlayed = data ? data.games_played : 0;
				const gamesLeft = Math.max(0, 6 - gamesPlayed);
				
				return {
					canPlay: gamesLeft > 0,
					gamesLeft: gamesLeft,
					gamesPlayed: gamesPlayed
				};
			} catch (error) {
				console.error('Error checking daily limit:', error);
				return { canPlay: true, gamesLeft: 6 };
			}
		},
		
		// Update daily game count for specific level
		updateDailyGameCount: async function(userId, level) {
			if (!supabase) return;
			
			try {
				const gameDay = this.getGameDay();
				
				// Get current games played for this level
				const { data: currentData } = await supabase
					.from('daily_games')
					.select('games_played')
					.eq('user_id', userId)
					.eq('level', level)
					.eq('date', gameDay)
					.single();
				
				const currentGames = currentData ? currentData.games_played : 0;
				const newGameCount = currentGames + 1;
				
				await supabase
					.from('daily_games')
					.upsert({
						user_id: userId,
						level: level,
						date: gameDay,
						games_played: newGameCount
					}, {
						onConflict: 'user_id,level,date'
					});
				
				return { gamesPlayed: newGameCount };
			} catch (error) {
				console.error('Error updating daily count:', error);
				return null;
			}
		},

		// Update global break status (3 games per 15min)
		updateGlobalBreakStatus: async function(userId) {
			if (!supabase) return;
			
			try {
				const gameDay = this.getGameDay();
				const now = new Date();
				
				// Get current break status
				const { data: currentData } = await supabase
					.from('user_break_status')
					.select('games_in_session, session_start')
					.eq('user_id', userId)
					.eq('date', gameDay)
					.single();
				
				let gamesInSession = 0;
				let sessionStart = now;
				
				if (currentData) {
					const existingSessionStart = new Date(currentData.session_start);
					const sessionDuration = (now - existingSessionStart) / (1000 * 60); // minutes
					
					if (sessionDuration < 15) {
						// Continue current session
						gamesInSession = currentData.games_in_session;
						sessionStart = existingSessionStart;
					}
					// If >= 15 minutes, start new session (gamesInSession stays 0)
				}
				
				const newGamesInSession = gamesInSession + 1;
				let breakUntil = null;
				
				// If this is the 3rd game in session, set break time
				if (newGamesInSession >= 3) {
					breakUntil = new Date(sessionStart.getTime() + 15 * 60 * 1000); // 15 min from session start
				}
				
				await supabase
					.from('user_break_status')
					.upsert({
						user_id: userId,
						date: gameDay,
						games_in_session: newGamesInSession,
						session_start: sessionStart.toISOString(),
						break_until: breakUntil ? breakUntil.toISOString() : null
					}, {
						onConflict: 'user_id,date'
					});
				
				return {
					gamesInSession: newGamesInSession,
					onBreak: breakUntil !== null,
					breakUntil: breakUntil
				};
			} catch (error) {
				console.error('Error updating global break status:', error);
				return null;
			}
		},
		
		// Calculate score based on grid dimensions and time remaining
		calculateScore: function(level, timeRemaining) {
			const levelConfig = levels[level - 1];
			const [width, height] = levelConfig.grid.split('x').map(n => parseInt(n));
			return width * height * timeRemaining;
		},
		
		// Save game result to weekly leaderboard
		saveGameResult: async function(userId, username, level, timeRemaining, moves) {
			if (!supabase) return;
			
			try {
				const week = this.getCurrentWeek();
				const score = this.calculateScore(level, timeRemaining);
				
				const gameResult = {
					user_id: userId,
					username: username,
					level: level,
					score: score,
					time_remaining: timeRemaining,
					moves: moves,
					week: week,
					created_at: new Date().toISOString()
				};
				
				const { data, error } = await supabase
					.from('weekly_scores')
					.insert([gameResult]);
				
				if (error) {
					console.error('Error saving game result:', error);
					return false;
				}
				
				return true;
			} catch (error) {
				console.error('Error saving game result:', error);
				return false;
			}
		},
		
		// Get weekly leaderboard
		getWeeklyLeaderboard: async function(week = null) {
			if (!supabase) return [];
			
			try {
				const targetWeek = week || this.getCurrentWeek();
				
				const { data, error } = await supabase
					.from('weekly_scores')
					.select('*')
					.eq('week', targetWeek)
					.order('score', { ascending: false })
					.limit(100);
				
				if (error) {
					console.error('Error fetching leaderboard:', error);
					return [];
				}
				
				return data || [];
			} catch (error) {
				console.error('Error fetching leaderboard:', error);
				return [];
			}
		},
		
		// Get user's weekly total score
		getUserWeeklyTotal: async function(userId, week = null) {
			if (!supabase) return 0;
			
			try {
				const targetWeek = week || this.getCurrentWeek();
				
				const { data, error } = await supabase
					.from('weekly_scores')
					.select('score')
					.eq('user_id', userId)
					.eq('week', targetWeek);
				
				if (error) {
					console.error('Error fetching user total:', error);
					return 0;
				}
				
				return data.reduce((total, record) => total + record.score, 0);
			} catch (error) {
				console.error('Error fetching user total:', error);
				return 0;
			}
		}
	};
	
	var GameManager = {
		currentUserId: null,
		
		init: function() {
			initSupabase();
			this.generateUserId();
			this.bindMenuEvents();
			this.loadHistory();
			this.loadLeaderboard();
			this.initFarcaster();
			this.loadLevelProgress();
			this.checkFirstTimeUser();
		},
		
		generateUserId: function() {
			// Generate or get user ID - can be enhanced with Farcaster ID later
			let userId = localStorage.getItem('crypto_memory_user_id');
			if (!userId) {
				userId = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
				localStorage.setItem('crypto_memory_user_id', userId);
			}
			this.currentUserId = userId;
		},

		bindMenuEvents: function() {
			$('.start-game-btn').on('click', function() {
				GameManager.showLevelScreen();
			});

			$('.history-btn').on('click', function() {
				GameManager.showHistoryScreen();
			});

			$('.leaderboard-btn').on('click', function() {
				GameManager.showLeaderboardScreen();
			});

			$('.back-btn, .history-back, .leaderboard-back, .level-back').on('click', function() {
				GameManager.showStartScreen();
			});

			$('.level-card').on('click', function() {
				var $card = $(this);
				var level = parseInt($card.data('level'));
				
				if ($card.hasClass('locked')) {
					alert('Complete the previous level to unlock this one!');
					return;
				}
				
				GameManager.showGameScreen(level);
			});

			$('.back-to-menu').on('click', function() {
				Memory.hideModal();
				GameManager.showStartScreen();
			});

			$('.next-level').on('click', function() {
				Memory.hideModal();
				var nextLevel = Memory.currentLevel + 1;
				if (nextLevel <= levels.length) {
					setTimeout(function() {
						GameManager.showGameScreen(nextLevel);
					}, 300);
				} else {
					GameManager.showLevelScreen();
				}
			});

			$('#save-name-btn').on('click', function() {
				GameManager.savePlayerName();
			});

			$('.filter-btn').on('click', function() {
				$('.filter-btn').removeClass('active');
				$(this).addClass('active');
				GameManager.displayLeaderboard($(this).data('filter'));
			});

			// Game Over modal handlers
			$('.retry-level').on('click', function() {
				Memory.hideGameOverModal();
				setTimeout(function() {
					Memory.reset();
				}, 300);
			});

			$('.back-to-levels').on('click', function() {
				Memory.hideGameOverModal();
				GameManager.showLevelScreen();
			});

			$('#connect-farcaster-btn').on('click', function() {
				GameManager.connectFarcaster();
			});

			$('#disconnect-farcaster-btn').on('click', function() {
				GameManager.disconnectFarcaster();
			});

			$('#welcome-connect-farcaster').on('click', function() {
				GameManager.connectFarcaster();
				GameManager.hideFirstTimeModal();
			});

			$('#welcome-play-anonymous').on('click', function() {
				GameManager.hideFirstTimeModal();
			});
		},

		showStartScreen: function() {
			$('.start-screen').show();
			$('.game-container').hide();
			$('.history-screen').hide();
			$('.leaderboard-screen').hide();
		},

		showLevelScreen: async function() {
			$('.start-screen').hide();
			$('.level-screen').show();
			$('.game-container').hide();
			$('.history-screen').hide();
			$('.leaderboard-screen').hide();
			this.updateLevelDisplay();
			await this.checkAndShowBreakStatus();
		},

		checkAndShowBreakStatus: async function() {
			// Check if player is on break and show status
			const globalBreakCheck = await DatabaseManager.checkGlobalBreakStatus(this.currentUserId);
			
			if (globalBreakCheck.onBreak) {
				// Add break indicator to level screen
				if (!$('.break-indicator').length) {
					const breakIndicator = `
						<div class="break-indicator">
							<div class="break-info">
								<span class="break-icon">⏰</span>
								<div class="break-text">
									<strong>On 15-min Break</strong>
									<div class="break-time">
										<span class="break-minutes">00</span>:<span class="break-seconds">00</span> remaining
									</div>
								</div>
							</div>
						</div>
					`;
					$('.level-selection h2').after(breakIndicator);
				}

				// Update the break timer display
				const minutes = Math.floor(globalBreakCheck.breakTimeLeft / 60);
				const seconds = globalBreakCheck.breakTimeLeft % 60;
				$('.break-minutes').text(minutes.toString().padStart(2, '0'));
				$('.break-seconds').text(seconds.toString().padStart(2, '0'));

				// Start updating the break timer on level screen
				this.startLevelScreenBreakTimer();
			} else {
				// Remove break indicator if not on break
				$('.break-indicator').remove();
				if (this.levelBreakInterval) {
					clearInterval(this.levelBreakInterval);
				}
			}
		},

		startLevelScreenBreakTimer: function() {
			// Clear any existing interval
			if (this.levelBreakInterval) {
				clearInterval(this.levelBreakInterval);
			}

			this.levelBreakInterval = setInterval(async () => {
				const globalBreakCheck = await DatabaseManager.checkGlobalBreakStatus(this.currentUserId);
				
				if (!globalBreakCheck.onBreak) {
					// Break is over
					clearInterval(this.levelBreakInterval);
					$('.break-indicator').remove();
					return;
				}

				// Update break timer display on level screen
				const minutes = Math.floor(globalBreakCheck.breakTimeLeft / 60);
				const seconds = globalBreakCheck.breakTimeLeft % 60;
				$('.break-minutes').text(minutes.toString().padStart(2, '0'));
				$('.break-seconds').text(seconds.toString().padStart(2, '0'));
			}, 1000);
		},

		showBreakTimer: function(minutes, seconds, gamesPlayed) {
			// Create break timer modal if it doesn't exist
			if (!$('.break-timer-modal').length) {
				const breakModal = `
					<div class="break-timer-modal">
						<div class="break-timer-content">
							<div class="break-timer-icon">⏰</div>
							<h2>15-Minute Break Time!</h2>
							<p>You've played <strong>${gamesPlayed}</strong> games this session.</p>
							<div class="break-countdown">
								<div class="countdown-display">
									<span class="countdown-minutes">00</span>:<span class="countdown-seconds">00</span>
								</div>
								<p>Until you can play again</p>
							</div>
							<button class="break-timer-close">Close</button>
						</div>
					</div>
				`;
				$('body').append(breakModal);

				// Add close button functionality
				$('.break-timer-close').on('click', function() {
					$('.break-timer-modal').removeClass('show').hide();
				});
			}

			// Update countdown display
			$('.countdown-minutes').text(minutes.toString().padStart(2, '0'));
			$('.countdown-seconds').text(seconds.toString().padStart(2, '0'));
			
			// Show modal
			$('.break-timer-modal').show().addClass('show');

			// Start countdown timer
			this.startBreakCountdown();
		},

		startBreakCountdown: function() {
			// Clear any existing interval
			if (this.breakInterval) {
				clearInterval(this.breakInterval);
			}

			this.breakInterval = setInterval(async () => {
				const globalBreakCheck = await DatabaseManager.checkGlobalBreakStatus(this.currentUserId);
				
				if (!globalBreakCheck.onBreak) {
					// Break is over
					clearInterval(this.breakInterval);
					$('.break-timer-modal').removeClass('show').hide();
					alert('Break is over! You can now play again.');
					return;
				}

				// Update countdown display
				const minutes = Math.floor(globalBreakCheck.breakTimeLeft / 60);
				const seconds = globalBreakCheck.breakTimeLeft % 60;
				$('.countdown-minutes').text(minutes.toString().padStart(2, '0'));
				$('.countdown-seconds').text(seconds.toString().padStart(2, '0'));
			}, 1000);
		},

		showGameScreen: async function(level) {
			// Check global break status first (3 games per 15min across all levels)
			const globalBreakCheck = await DatabaseManager.checkGlobalBreakStatus(this.currentUserId);
			
			if (globalBreakCheck.onBreak) {
				const minutes = Math.floor(globalBreakCheck.breakTimeLeft / 60);
				const seconds = globalBreakCheck.breakTimeLeft % 60;
				this.showBreakTimer(minutes, seconds, globalBreakCheck.gamesInSession);
				return;
			}
			
			// Check daily limit for this specific level
			const limitCheck = await DatabaseManager.checkDailyLimit(this.currentUserId, level);
			
			if (!limitCheck.canPlay) {
				alert(`You've reached your daily limit for Level ${level}! You have ${limitCheck.gamesLeft} attempts left today. Games reset at 1 AM UTC.`);
				return;
			}
			
			// Update games remaining display for this level
			$('.games-remaining').text(limitCheck.gamesLeft - 1);
			
			$('.start-screen').hide();
			$('.level-screen').hide();
			$('.history-screen').hide();
			$('.leaderboard-screen').hide();
			$('.modal-overlay').hide();
			$('.game-container').show();
			$('.game').show();
			Memory.init(level || 1);
		},

		showHistoryScreen: function() {
			$('.start-screen').hide();
			$('.game-container').hide();
			$('.history-screen').show();
			$('.leaderboard-screen').hide();
			this.displayHistory();
		},

		showLeaderboardScreen: function() {
			$('.start-screen').hide();
			$('.game-container').hide();
			$('.history-screen').hide();
			$('.leaderboard-screen').show();
			this.displayLeaderboard('all');
		},

		saveGameResult: function(moves, time, timeSeconds) {
			var playerName = this.getPlayerName();
			var score = this.calculateScore(moves, timeSeconds);
			var gameResult = {
				id: Date.now(),
				date: new Date().toLocaleString(),
				timestamp: Date.now(),
				moves: moves,
				time: time,
				timeSeconds: timeSeconds,
				score: score,
				player: playerName
			};

			// Save to personal history
			var history = JSON.parse(localStorage.getItem('memoryGameHistory') || '[]');
			history.unshift(gameResult);
			if (history.length > 10) {
				history = history.slice(0, 10);
			}
			localStorage.setItem('memoryGameHistory', JSON.stringify(history));

			// Save to global leaderboard
			var leaderboard = JSON.parse(localStorage.getItem('memoryGameLeaderboard') || '[]');
			leaderboard.push(gameResult);
			
			// Sort by score (descending) then by time (ascending)
			leaderboard.sort(function(a, b) {
				if (b.score !== a.score) return b.score - a.score;
				return a.timeSeconds - b.timeSeconds;
			});
			
			// Keep top 100 scores
			if (leaderboard.length > 100) {
				leaderboard = leaderboard.slice(0, 100);
			}
			
			localStorage.setItem('memoryGameLeaderboard', JSON.stringify(leaderboard));

			// Check if it's a personal best
			return this.checkPersonalBest(gameResult);
		},

		calculateScore: function(moves, timeSeconds) {
			// Lower moves and faster time = higher score
			var baseScore = 1000;
			var movesPenalty = (moves - 24) * 10; // 24 is minimum possible moves
			var timePenalty = Math.floor(timeSeconds / 2);
			return Math.max(100, baseScore - movesPenalty - timePenalty);
		},

		loadHistory: function() {
			this.history = JSON.parse(localStorage.getItem('memoryGameHistory') || '[]');
		},

		displayHistory: function() {
			var historyList = $('.history-list');
			historyList.empty();
			
			if (this.history.length === 0) {
				historyList.html('<p class="no-history">No games played yet. Start playing to see your history!</p>');
				return;
			}

			this.history.forEach(function(game, index) {
				var historyItem = $('<div class="history-item">');
				var timeStr = GameManager.formatTime(GameManager.parseTime(game.time));
				
				historyItem.html(`
					<div class="history-item-info">
						<h3>Game #${game.id.toString().slice(-6)}</h3>
						<p>${game.date}</p>
					</div>
					<div class="history-item-stats">
						<div>Moves: ${game.moves}</div>
						<div>Time: ${timeStr}</div>
						<div>Score: ${game.score}</div>
					</div>
				`);
				
				historyList.append(historyItem);
			});
		},

		parseTime: function(timeStr) {
			var parts = timeStr.split(':');
			return parseInt(parts[0]) * 60 + parseInt(parts[1]);
		},

		formatTime: function(seconds) {
			var mins = Math.floor(seconds / 60);
			var secs = seconds % 60;
			return mins.toString().padStart(2, '0') + ':' + secs.toString().padStart(2, '0');
		},

		// Player Name Management
		getPlayerName: function() {
			return localStorage.getItem('memoryGamePlayerName') || 'Anonymous';
		},

		loadPlayerName: function() {
			var playerName = this.getPlayerName();
			$('#player-name').val(playerName !== 'Anonymous' ? playerName : '');
		},

		savePlayerName: function() {
			var name = $('#player-name').val().trim();
			if (name && name.length > 0) {
				localStorage.setItem('memoryGamePlayerName', name);
				alert('Name saved! Your future games will be recorded under "' + name + '"');
			} else {
				alert('Please enter a valid name');
			}
		},

		// Leaderboard Management
		loadLeaderboard: function() {
			this.leaderboard = JSON.parse(localStorage.getItem('memoryGameLeaderboard') || '[]');
		},

		displayLeaderboard: async function(filter) {
			var leaderboardList = $('.leaderboard-list');
			leaderboardList.html('<p class="loading-scores">Loading weekly leaderboard...</p>');
			
			try {
				// Get weekly leaderboard from database
				const weeklyScores = await DatabaseManager.getWeeklyLeaderboard();
				
				// Aggregate scores by user
				const userTotals = {};
				weeklyScores.forEach(game => {
					if (!userTotals[game.user_id]) {
						userTotals[game.user_id] = {
							username: game.username,
							totalScore: 0,
							gameCount: 0,
							lastPlayed: game.created_at
						};
					}
					userTotals[game.user_id].totalScore += game.score;
					userTotals[game.user_id].gameCount += 1;
					if (new Date(game.created_at) > new Date(userTotals[game.user_id].lastPlayed)) {
						userTotals[game.user_id].lastPlayed = game.created_at;
					}
				});
				
				// Convert to array and sort by total score
				const sortedUsers = Object.values(userTotals)
					.sort((a, b) => b.totalScore - a.totalScore)
					.slice(0, 50); // Show top 50
				
				leaderboardList.empty();
				
				if (sortedUsers.length === 0) {
					leaderboardList.html('<p class="no-scores">No scores this week yet. Be the first to play!</p>');
					return;
				}

			filteredScores.forEach(function(game, index) {
				var rank = index + 1;
				var leaderboardItem = $('<div class="leaderboard-item">');
				
				// Add special styling for top 3
				if (rank <= 3) {
					leaderboardItem.addClass('top-3 rank-' + rank);
				}
				
				var rankBadge = '';
				var rankClass = '';
				if (rank === 1) {
					rankBadge = '<div class="rank-badge gold">👑</div>';
				} else if (rank === 2) {
					rankBadge = '<div class="rank-badge silver">🥈</div>';
				} else if (rank === 3) {
					rankBadge = '<div class="rank-badge bronze">🥉</div>';
				} else {
					rankBadge = '<div class="rank-badge">' + rank + '</div>';
				}
				
				var timeStr = GameManager.formatTime(game.timeSeconds);
				var dateStr = new Date(game.timestamp).toLocaleDateString();
				
				leaderboardItem.html(rankBadge + `
					<div class="leaderboard-item-info">
						<h3>${game.player} <span class="player-badge">Rank #${rank}</span></h3>
						<p>${dateStr}</p>
					</div>
					<div class="leaderboard-item-stats">
						<div>Score: ${game.score}</div>
						<div>Moves: ${game.moves}</div>
						<div>Time: ${timeStr}</div>
					</div>
				`);
				
				// Create leaderboard item
				var rank = index + 1;
				var leaderboardItem = $('<div class="leaderboard-item">');
				
				// Add special styling for top 3
				if (rank <= 3) {
					leaderboardItem.addClass('top-3 rank-' + rank);
				}
				
				var rankBadge = '';
				if (rank === 1) {
					rankBadge = '<div class="rank-badge gold">👑</div>';
				} else if (rank === 2) {
					rankBadge = '<div class="rank-badge silver">🥈</div>';
				} else if (rank === 3) {
					rankBadge = '<div class="rank-badge bronze">🥉</div>';
				} else {
					rankBadge = '<div class="rank-badge">' + rank + '</div>';
				}
				
				var dateStr = new Date(user.lastPlayed).toLocaleDateString();
				
				leaderboardItem.html(rankBadge + `
					<div class="leaderboard-item-info">
						<h3>${user.username} <span class="player-badge">Rank #${rank}</span></h3>
						<p>Weekly Total • ${user.gameCount} games played</p>
						<p>Last played: ${dateStr}</p>
					</div>
					<div class="leaderboard-item-stats">
						<div class="total-score">Total: ${user.totalScore} pts</div>
						<div class="avg-score">Avg: ${Math.round(user.totalScore/user.gameCount)} pts/game</div>
					</div>
				`);
				
				leaderboardList.append(leaderboardItem);
			});
			
			} catch (error) {
				console.error('Error loading leaderboard:', error);
				leaderboardList.html('<p class="no-scores">Error loading leaderboard. Please try again.</p>');
			}
		},

		filterScoresByTime: function(scores, filter) {
			var now = new Date();
			var filtered = scores.slice();
			
			switch(filter) {
				case 'today':
					var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
					filtered = scores.filter(function(score) {
						return new Date(score.timestamp) >= today;
					});
					break;
				case 'week':
					var weekAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
					filtered = scores.filter(function(score) {
						return new Date(score.timestamp) >= weekAgo;
					});
					break;
				case 'all':
				default:
					// No filtering needed
					break;
			}
			
			return filtered;
		},

		checkPersonalBest: function(newGame) {
			var playerName = newGame.player;
			var playerScores = this.leaderboard.filter(function(game) {
				return game.player === playerName;
			});
			
			// Sort player's scores by score descending
			playerScores.sort(function(a, b) {
				return b.score - a.score;
			});
			
			// Check if this is the player's best score
			if (playerScores.length === 1 || playerScores[0].id === newGame.id) {
				// Find rank in overall leaderboard
				var overallRank = this.leaderboard.findIndex(function(game) {
					return game.id === newGame.id;
				}) + 1;
				
				return {
					isPersonalBest: true,
					rank: overallRank
				};
			}
			
			return {
				isPersonalBest: false,
				rank: null
			};
		},

		// First Time User Management
		checkFirstTimeUser: function() {
			var isFirstTime = !localStorage.getItem('memoryGamePlayerVisited');
			if (isFirstTime) {
				this.showFirstTimeModal();
				localStorage.setItem('memoryGamePlayerVisited', 'true');
			} else {
				this.loadPlayerName();
			}
		},

		showFirstTimeModal: function() {
			$('.first-time-modal-overlay').show();
		},

		hideFirstTimeModal: function() {
			$('.first-time-modal-overlay').hide();
			this.loadPlayerName();
		},

		// Farcaster Integration
		initFarcaster: function() {
			try {
				// Initialize Farcaster Auth Kit
				if (typeof window.farcasterAuthKit !== 'undefined') {
					this.farcasterAuth = window.farcasterAuthKit.createAuth({
						domain: window.location.hostname,
						siweUri: window.location.origin,
						rpcUrl: 'https://mainnet.optimism.io',
					});
				}
				this.updateFarcasterStatus();
			} catch (error) {
				console.log('Farcaster not available, using fallback');
				this.farcasterAuth = null;
			}
		},

		connectFarcaster: function() {
			if (!this.farcasterAuth) {
				// Fallback: simulate Farcaster connection for demo purposes
				this.simulateFarcasterConnection();
				return;
			}

			try {
				this.farcasterAuth.authenticate()
					.then((result) => {
						if (result.success) {
							var username = result.profile.username || result.profile.displayName || 'FCUser';
							localStorage.setItem('memoryGameFarcasterUser', JSON.stringify({
								username: username,
								fid: result.profile.fid,
								connected: true,
								connectedAt: Date.now()
							}));
							localStorage.setItem('memoryGamePlayerName', username);
							this.updateFarcasterStatus();
							alert('Connected successfully! Username set to: ' + username);
						}
					})
					.catch((error) => {
						console.error('Farcaster authentication failed:', error);
						alert('Failed to connect to Farcaster. Please try again.');
					});
			} catch (error) {
				console.error('Farcaster connection error:', error);
				this.simulateFarcasterConnection();
			}
		},

		simulateFarcasterConnection: function() {
			// Demo mode: Allow user to enter a simulated Farcaster username
			var username = prompt('Demo Mode: Enter your Farcaster username:');
			if (username && username.trim()) {
				username = username.trim();
				localStorage.setItem('memoryGameFarcasterUser', JSON.stringify({
					username: username,
					fid: 'demo_' + Date.now(),
					connected: true,
					connectedAt: Date.now(),
					demo: true
				}));
				localStorage.setItem('memoryGamePlayerName', username);
				this.updateFarcasterStatus();
				alert('Demo connection successful! Username set to: ' + username);
			}
		},

		disconnectFarcaster: function() {
			localStorage.removeItem('memoryGameFarcasterUser');
			localStorage.removeItem('memoryGamePlayerName');
			this.updateFarcasterStatus();
			alert('Disconnected from Farcaster');
		},

		updateFarcasterStatus: function() {
			var farcasterUser = JSON.parse(localStorage.getItem('memoryGameFarcasterUser') || 'null');
			var statusText = $('#farcaster-status-text');
			var connectBtn = $('#connect-farcaster-btn');
			var disconnectBtn = $('#disconnect-farcaster-btn');

			if (farcasterUser && farcasterUser.connected) {
				var demoText = farcasterUser.demo ? ' (Demo Mode)' : '';
				statusText.html('<span class="fa fa-check-circle" style="color: #28a745;"></span> Connected as: <strong>' + farcasterUser.username + '</strong>' + demoText);
				connectBtn.hide();
				disconnectBtn.show();
			} else {
				statusText.html('<span class="fa fa-user"></span> Connect with Farcaster for automatic username');
				connectBtn.show();
				disconnectBtn.hide();
			}
		},

		// Level Progress Management
		loadLevelProgress: function() {
			this.completedLevels = JSON.parse(localStorage.getItem('memoryGameCompletedLevels') || '[1]');
			// Ensure level 1 is always unlocked
			if (this.completedLevels.indexOf(1) === -1) {
				this.completedLevels.push(1);
				this.saveLevelProgress();
			}
		},

		saveLevelProgress: function() {
			localStorage.setItem('memoryGameCompletedLevels', JSON.stringify(this.completedLevels));
		},

		unlockNextLevel: function(completedLevel) {
			var nextLevel = completedLevel + 1;
			
			// Mark current level as completed if not already
			if (this.completedLevels.indexOf(completedLevel) === -1) {
				this.completedLevels.push(completedLevel);
			}
			
			// Unlock next level if it exists and isn't already unlocked
			if (nextLevel <= levels.length && this.completedLevels.indexOf(nextLevel) === -1) {
				this.completedLevels.push(nextLevel);
				this.saveLevelProgress();
				return true; // New level unlocked
			}
			
			this.saveLevelProgress();
			return false; // No new level unlocked
		},

		isLevelUnlocked: function(level) {
			return this.completedLevels.indexOf(level) !== -1;
		},

		updateLevelDisplay: function() {
			var self = this;
			$('.level-card').each(function() {
				var $card = $(this);
				var level = parseInt($card.data('level'));
				var $lockIcon = $card.find('.lock-icon');
				var $completedIcon = $card.find('.completed-icon');
				
				// Remove existing icons
				$lockIcon.remove();
				$completedIcon.remove();
				
				if (self.isLevelUnlocked(level)) {
					$card.removeClass('locked');
					
					// Check if level is completed (next level is unlocked or this is the last completed level)
					var isCompleted = (level < Math.max(...self.completedLevels)) || 
									 (level === Math.max(...self.completedLevels) && self.hasCompletedLevel(level));
					
					if (isCompleted) {
						$card.addClass('completed');
						$card.prepend('<span class="fa fa-check-circle completed-icon"></span>');
					} else {
						$card.removeClass('completed');
					}
				} else {
					$card.addClass('locked');
					$card.removeClass('completed');
					$card.prepend('<span class="fa fa-lock lock-icon"></span>');
				}
			});
		},

		hasCompletedLevel: function(level) {
			// Check if player has actually completed this level (not just unlocked it)
			var levelData = JSON.parse(localStorage.getItem('memoryGameLevelCompletions') || '{}');
			return levelData[level] === true;
		},

		markLevelCompleted: function(level) {
			var levelData = JSON.parse(localStorage.getItem('memoryGameLevelCompletions') || '{}');
			levelData[level] = true;
			localStorage.setItem('memoryGameLevelCompletions', JSON.stringify(levelData));
		}
	};

	var Memory = {
		init: function(levelNumber){
			this.currentLevel = levelNumber || 1;
			this.levelConfig = levels[this.currentLevel - 1];
			
			this.$game = $(".game");
			this.$modal = $(".modal");
			this.$overlay = $(".modal-overlay");
			this.$restartButton = $("button.restart");
			
			// Select cards for this level
			var cardsForLevel = cards.slice(0, this.levelConfig.pairs);
			this.cardsArray = $.merge(cardsForLevel, cardsForLevel);
			this.shuffleCards(this.cardsArray);
			this.setup();
			// initGameTracking is now called after the 3-second preview
		},

		initGameTracking: function() {
			this.moves = 0;
			this.timeLeft = this.levelConfig.timeLimit;
			this.timer = null;
			this.updateMoveCounter();
			this.updateTimer();
			this.startTimer();
		},

		startTimer: function() {
			this.timer = setInterval(() => {
				this.timeLeft--;
				this.updateTimer();
				
				if (this.timeLeft <= 0) {
					this.timeUp();
				}
			}, 1000);
		},

		updateTimer: function() {
			var mins = Math.floor(this.timeLeft / 60);
			var secs = this.timeLeft % 60;
			$('.time-count').text(mins.toString().padStart(2, '0') + ':' + secs.toString().padStart(2, '0'));
			
			// Add visual warning when time is running low
			if (this.timeLeft <= 10) {
				$('.time-count').addClass('time-warning');
			} else {
				$('.time-count').removeClass('time-warning');
			}
		},

		timeUp: async function() {
			this.paused = true;
			this.stopTimer();
			
			// Update daily game count for this level (even for losses)
			await DatabaseManager.updateDailyGameCount(GameManager.currentUserId, this.currentLevel);
			
			// Update global break status (3 games per 15min across all levels)
			const globalResult = await DatabaseManager.updateGlobalBreakStatus(GameManager.currentUserId);
			
			this.showGameOverModal();
			
			// Show break notification if needed
			if (globalResult && globalResult.onBreak) {
				setTimeout(() => {
					alert('You\'ve played 3 games in 15 minutes. Take a break before playing any level again!');
				}, 2000);
			}
		},

		showGameOverModal: function() {
			// Calculate stats
			var matchedCards = $('.matched').length;
			var totalCards = $('.card').length;
			
			// Update modal content
			$('.gameover-level').text(this.currentLevel);
			$('.gameover-moves').text(this.moves);
			$('.gameover-matched').text(matchedCards + ' / ' + totalCards);
			
			// Show modal
			$('.gameover-modal-overlay').show();
			
			// Hide the game
			this.$game.fadeOut();
		},

		hideGameOverModal: function() {
			$('.gameover-modal-overlay').hide();
		},

		stopTimer: function() {
			if (this.timer) {
				clearInterval(this.timer);
				this.timer = null;
			}
		},

		updateMoveCounter: function() {
			$('.move-count').text(this.moves);
		},

		shuffleCards: function(cardsArray){
			this.$cards = $(this.shuffle(this.cardsArray));
		},

		setup: function(){
			this.html = this.buildHTML();
			this.$game.html(this.html);
			this.$memoryCards = $(".card");
			this.paused = true; // Start paused during reveal
     		this.guess = null;
			this.binding();
			this.showAllCardsPreview();
		},

		showAllCardsPreview: function() {
			var _ = this;
			
			// Ensure DOM is ready before starting preview
			setTimeout(function() {
				// Show all cards and preview message
				_.$memoryCards.find('.inside').addClass('picked');
				$('.preview-message').show();
				
				// Countdown from 3 to 1
				var countdown = 3;
				$('.preview-countdown').text(countdown);
				
				var countdownInterval = setInterval(function() {
					countdown--;
					if (countdown > 0) {
						$('.preview-countdown').text(countdown);
					} else {
						$('.preview-countdown').text('GO!');
						clearInterval(countdownInterval);
					}
				}, 1000);
				
				// Hide cards after 3 seconds and start the game
				setTimeout(function() {
					_.$memoryCards.find('.inside').removeClass('picked');
					$('.preview-message').hide();
					_.paused = false; // Allow gameplay
					_.initGameTracking(); // Start timer after preview
				}, 3000);
			}, 100); // Small delay to ensure DOM is ready
		},

		binding: function(){
			this.$memoryCards.on("click", this.cardClicked);
			this.$restartButton.on("click", $.proxy(this.reset, this));
		},

		cardClicked: function(){
			var _ = Memory;
			var $card = $(this);
			if(!_.paused && !$card.find(".inside").hasClass("matched") && !$card.find(".inside").hasClass("picked")){
				$card.find(".inside").addClass("picked");
				_.moves++;
				_.updateMoveCounter();
				
				if(!_.guess){
					_.guess = $(this).attr("data-id");
				} else if(_.guess == $(this).attr("data-id") && !$(this).hasClass("picked")){
					$(".picked").addClass("matched");
					_.guess = null;
				} else {
					_.guess = null;
					_.paused = true;
					setTimeout(function(){
						$(".picked").removeClass("picked");
						Memory.paused = false;
					}, 600);
				}
				if($(".matched").length == $(".card").length){
					_.win();
				}
			}
		},

		win: async function(){
			this.paused = true;
			this.stopTimer();
			var finalTime = $('.time-count').text();
			var finalMoves = this.moves;
			var timeUsed = this.levelConfig.timeLimit - this.timeLeft;
			var timeRemaining = this.timeLeft;
			var finalScore = DatabaseManager.calculateScore(this.currentLevel, timeRemaining);
			
			// Save to database
			const username = GameManager.getPlayerName() || 'Anonymous';
			await DatabaseManager.saveGameResult(
				GameManager.currentUserId, 
				username, 
				this.currentLevel, 
				timeRemaining, 
				finalMoves
			);
			
			// Update daily game count for this level
			await DatabaseManager.updateDailyGameCount(GameManager.currentUserId, this.currentLevel);
			
			// Update global break status (3 games per 15min across all levels)
			const globalResult = await DatabaseManager.updateGlobalBreakStatus(GameManager.currentUserId);
			
			// Show break notification if needed
			if (globalResult && globalResult.onBreak) {
				setTimeout(() => {
					alert('You\'ve played 3 games in 15 minutes. Take a break before playing any level again!');
				}, 2000);
			}
			
			// Handle level completion and unlocking
			GameManager.markLevelCompleted(this.currentLevel);
			var newLevelUnlocked = GameManager.unlockNextLevel(this.currentLevel);
			
			// Save to local history for backward compatibility
			var personalBest = GameManager.saveGameResult(finalMoves, finalTime, timeUsed);
			
			// Update modal with results
			$('.final-moves').text(finalMoves);
			$('.final-time').text(finalTime);
			$('.final-score').text(finalScore);
			
			// Show level completion message
			var levelMessage = $('.level-completion-message');
			if (levelMessage.length === 0) {
				$('.game-results').append('<div class="level-completion-message"></div>');
				levelMessage = $('.level-completion-message');
			}
			
			if (newLevelUnlocked) {
				levelMessage.html('🎉 Level ' + this.currentLevel + ' completed! Level ' + (this.currentLevel + 1) + ' unlocked!').show();
			} else if (this.currentLevel === levels.length) {
				levelMessage.html('👑 Congratulations! You\'ve mastered all levels!').show();
			} else {
				levelMessage.html('✅ Level ' + this.currentLevel + ' completed!').show();
			}
			
			// Show rank if it's a personal best
			if (personalBest.isPersonalBest) {
				$('.rank-number').text(personalBest.rank);
				$('.rank-display').show();
			} else {
				$('.rank-display').hide();
			}
			
			// Show/hide Next Level button
			if (this.currentLevel < levels.length) {
				$('.next-level').show();
			} else {
				$('.next-level').hide();
			}
			
			setTimeout(function(){
				Memory.showModal();
				Memory.$game.fadeOut();
			}, 1000);
		},

		showModal: function(){
			this.$overlay.show();
			this.$modal.fadeIn("slow");
		},

		hideModal: function(){
			this.$overlay.hide();
			this.$modal.hide();
		},

		reset: function(){
			this.hideModal();
			this.stopTimer();
			this.shuffleCards(this.cardsArray);
			this.setup();
			this.initGameTracking();
			this.$game.show("slow");
		},

		// Fisher--Yates Algorithm -- https://bost.ocks.org/mike/shuffle/
		shuffle: function(array){
			var counter = array.length, temp, index;
	   		// While there are elements in the array
	   		while (counter > 0) {
        		// Pick a random index
        		index = Math.floor(Math.random() * counter);
        		// Decrease counter by 1
        		counter--;
        		// And swap the last element with it
        		temp = array[counter];
        		array[counter] = array[index];
        		array[index] = temp;
	    	}
	    	return array;
		},

		buildHTML: function(){
			var gridClass = 'grid-' + this.levelConfig.grid.replace('×', 'x');
			var frag = '<div class="game-grid ' + gridClass + '">';
			
			// Add cards
			this.$cards.each(function(k, v){
				frag += '<div class="card" data-id="'+ v.id +'"><div class="inside">\
				<div class="front"><img src="'+ v.img +'"\
				alt="'+ v.name +'" /></div>\
				<div class="back"><img src="https://s3-us-west-2.amazonaws.com/s.cdpn.io/74196/codepen-logo.png"\
				alt="Codepen" /></div></div>\
				</div>';
			});
			
			// Add empty cells for 3x3 grid (9 slots - 8 cards = 1 empty)
			if (this.levelConfig.grid === '3x3') {
				frag += '<div class="empty-cell"></div>';
			}
			
			frag += '</div>';
			return frag;
		}
	};

	var cards = [
		{
			name: "Bitcoin",
			img: "https://assets.coingecko.com/coins/images/1/large/bitcoin.png",
			id: 1,
		},
		{
			name: "Ethereum",
			img: "https://assets.coingecko.com/coins/images/279/large/ethereum.png",
			id: 2
		},
		{
			name: "BNB",
			img: "https://assets.coingecko.com/coins/images/825/large/bnb-icon2_2x.png",
			id: 3
		},
		{
			name: "Solana",
			img: "https://assets.coingecko.com/coins/images/4128/large/solana.png",
			id: 4
		}, 
		{
			name: "Cardano",
			img: "https://assets.coingecko.com/coins/images/975/large/cardano.png",
			id: 5
		},
		{
			name: "Polygon",
			img: "https://assets.coingecko.com/coins/images/4713/large/matic-token-icon.png",
			id: 6
		},
		{
			name: "Chainlink",
			img: "https://assets.coingecko.com/coins/images/877/large/chainlink-new-logo.png",
			id: 7
		},
		{
			name: "Uniswap",
			img: "https://assets.coingecko.com/coins/images/12504/large/uni.jpg",
			id: 8
		},
		{
			name: "Dogecoin",
			img: "https://assets.coingecko.com/coins/images/5/large/dogecoin.png",
			id: 9
		},
		{
			name: "Avalanche",
			img: "https://assets.coingecko.com/coins/images/12559/large/Avalanche_Circle_RedWhite_Trans.png",
			id: 10
		},
		{
			name: "Shiba Inu",
			img: "https://assets.coingecko.com/coins/images/11939/large/shiba.png",
			id: 11
		},
		{
			name: "Base",
			img: "https://i.ibb.co/hRLSLPPm/images.png",
			id: 12
		},
		{
			name: "XRP",
			img: "https://assets.coingecko.com/coins/images/44/large/xrp-symbol-white-128.png",
			id: 13
		},
		{
			name: "Polkadot",
			img: "https://assets.coingecko.com/coins/images/12171/large/polkadot.png",
			id: 14
		},
		{
			name: "TRON",
			img: "https://assets.coingecko.com/coins/images/1094/large/tron-logo.png",
			id: 15
		}
	];

	var levels = [
		{ level: 1, name: "Beginner", grid: "2x2", pairs: 2, cards: 4, timeLimit: 60 },
		{ level: 2, name: "Easy", grid: "3x3", pairs: 4, cards: 8, timeLimit: 60 },
		{ level: 3, name: "Medium", grid: "4x4", pairs: 8, cards: 16, timeLimit: 60 },
		{ level: 4, name: "Hard", grid: "4x5", pairs: 10, cards: 20, timeLimit: 60 },
		{ level: 5, name: "Expert", grid: "6x4", pairs: 12, cards: 24, timeLimit: 60 },
		{ level: 6, name: "Master", grid: "6x5", pairs: 15, cards: 30, timeLimit: 60 }
	];
    
	// Initialize the game manager when the page loads
	$(document).ready(function() {
		GameManager.init();
	});

})();