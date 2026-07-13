// ===== Game Data: Modes, Difficulties, Achievements =====

export interface GameMode {
	id: string;
	name: string;
	description: string;
	stations: number;
	pigeonsPerStation: number;
	doubles: boolean;
	speedMode: boolean;
	timeLimit: number; // 0 = no limit
}

export const GAME_MODES: GameMode[] = [
	{
		id: 'trap',
		name: 'Trap',
		description: 'Classic 25-target trap shooting. 5 stations, 5 targets each.',
		stations: 5,
		pigeonsPerStation: 5,
		doubles: false,
		speedMode: false,
		timeLimit: 0,
	},
	{
		id: 'double_trap',
		name: 'Double Trap',
		description: 'Two targets launched simultaneously. Hit both!',
		stations: 5,
		pigeonsPerStation: 5,
		doubles: true,
		speedMode: false,
		timeLimit: 0,
	},
	{
		id: 'skeet',
		name: 'Skeet',
		description: 'Crossing targets from high and low houses. 8 stations.',
		stations: 8,
		pigeonsPerStation: 3,
		doubles: false,
		speedMode: false,
		timeLimit: 0,
	},
	{
		id: 'speed',
		name: 'Speed Round',
		description: 'Rapid fire! Targets get faster. How many can you hit in 90s?',
		stations: 1,
		pigeonsPerStation: 99,
		doubles: false,
		speedMode: true,
		timeLimit: 90,
	},
	{
		id: 'sporting',
		name: 'Sporting Clays',
		description: 'Varied trajectories from all directions. Simulated hunting.',
		stations: 6,
		pigeonsPerStation: 5,
		doubles: false,
		speedMode: false,
		timeLimit: 0,
	},
];

export interface DifficultyConfig {
	id: string;
	name: string;
	pigeonSpeed: number;
	pigeonScale: number;
	windStrength: number;
	spreadAngle: number; // wider = easier
	scoreMultiplier: number;
}

export const DIFFICULTIES: DifficultyConfig[] = [
	{ id: 'easy', name: 'Easy', pigeonSpeed: 12, pigeonScale: 1.3, windStrength: 0, spreadAngle: 0.12, scoreMultiplier: 0.5 },
	{ id: 'medium', name: 'Medium', pigeonSpeed: 18, pigeonScale: 1.0, windStrength: 0.5, spreadAngle: 0.08, scoreMultiplier: 1.0 },
	{ id: 'hard', name: 'Hard', pigeonSpeed: 24, pigeonScale: 0.8, windStrength: 1.0, spreadAngle: 0.05, scoreMultiplier: 1.5 },
	{ id: 'expert', name: 'Expert', pigeonSpeed: 30, pigeonScale: 0.65, windStrength: 1.5, spreadAngle: 0.03, scoreMultiplier: 2.0 },
];

export interface Achievement {
	id: string;
	name: string;
	description: string;
	condition: string;
}

export const ACHIEVEMENTS: Achievement[] = [
	{ id: 'first_hit', name: 'First Blood', description: 'Hit your first clay pigeon', condition: 'totalHits >= 1' },
	{ id: 'perfect_station', name: 'Clean Station', description: 'Hit every target at one station', condition: 'perfectStation' },
	{ id: 'perfect_round', name: 'Perfect Round', description: 'Hit every target in a full round', condition: 'perfectRound' },
	{ id: 'streak_5', name: 'Hot Streak', description: 'Hit 5 targets in a row', condition: 'streak >= 5' },
	{ id: 'streak_10', name: 'On Fire', description: 'Hit 10 targets in a row', condition: 'streak >= 10' },
	{ id: 'streak_25', name: 'Untouchable', description: 'Hit 25 targets in a row', condition: 'streak >= 25' },
	{ id: 'total_50', name: 'Sharpshooter', description: 'Hit 50 total targets', condition: 'totalHits >= 50' },
	{ id: 'total_100', name: 'Marksman', description: 'Hit 100 total targets', condition: 'totalHits >= 100' },
	{ id: 'total_250', name: 'Expert Marksman', description: 'Hit 250 total targets', condition: 'totalHits >= 250' },
	{ id: 'total_500', name: 'Master Shooter', description: 'Hit 500 total targets', condition: 'totalHits >= 500' },
	{ id: 'speed_20', name: 'Speed Demon', description: 'Hit 20+ targets in Speed Round', condition: 'speedHits >= 20' },
	{ id: 'speed_40', name: 'Lightning Reflexes', description: 'Hit 40+ targets in Speed Round', condition: 'speedHits >= 40' },
	{ id: 'double_ace', name: 'Double Ace', description: 'Hit both targets in 5 consecutive doubles', condition: 'doubleStreak >= 5' },
	{ id: 'one_shot', name: 'One Shot Wonder', description: 'Complete a round using only first shots', condition: 'allFirstShots' },
	{ id: 'all_modes', name: 'Versatile', description: 'Complete a round in every mode', condition: 'allModesPlayed' },
	{ id: 'score_1000', name: 'High Roller', description: 'Score over 1000 in a single round', condition: 'roundScore >= 1000' },
	{ id: 'score_2500', name: 'Grand Master', description: 'Score over 2500 in a single round', condition: 'roundScore >= 2500' },
	{ id: 'rounds_10', name: 'Dedicated', description: 'Complete 10 rounds', condition: 'roundsCompleted >= 10' },
	{ id: 'rounds_25', name: 'Veteran', description: 'Complete 25 rounds', condition: 'roundsCompleted >= 25' },
	{ id: 'hard_perfect', name: 'True Marksman', description: 'Perfect round on Hard difficulty', condition: 'hardPerfect' },
];

// Station positions for each mode
export function getStationPositions(modeId: string): { x: number; z: number; angle: number }[] {
	switch (modeId) {
		case 'trap':
			// 5 stations in an arc behind the trap house
			return [
				{ x: -4, z: 0, angle: 0 },
				{ x: -2, z: 0.5, angle: 0.15 },
				{ x: 0, z: 1, angle: 0 },
				{ x: 2, z: 0.5, angle: -0.15 },
				{ x: 4, z: 0, angle: 0 },
			];
		case 'double_trap':
			return [
				{ x: -4, z: 0, angle: 0 },
				{ x: -2, z: 0.5, angle: 0.1 },
				{ x: 0, z: 1, angle: 0 },
				{ x: 2, z: 0.5, angle: -0.1 },
				{ x: 4, z: 0, angle: 0 },
			];
		case 'skeet':
			// 8 stations in semicircle between two houses
			return Array.from({ length: 8 }, (_, i) => {
				const t = i / 7;
				const angle = Math.PI * 0.15 + t * Math.PI * 0.7;
				return {
					x: Math.cos(angle) * 8,
					z: Math.sin(angle) * 4 - 2,
					angle: -angle + Math.PI / 2,
				};
			});
		case 'speed':
			return [{ x: 0, z: 1, angle: 0 }];
		case 'sporting':
			return [
				{ x: -5, z: 0, angle: 0.2 },
				{ x: -3, z: 2, angle: 0.1 },
				{ x: 0, z: 3, angle: 0 },
				{ x: 3, z: 2, angle: -0.1 },
				{ x: 5, z: 0, angle: -0.2 },
				{ x: 0, z: -1, angle: 0 },
			];
		default:
			return [{ x: 0, z: 1, angle: 0 }];
	}
}

// Pigeon launch configs per mode/station
export function getLaunchConfig(modeId: string, stationIdx: number): {
	origin: { x: number; y: number; z: number };
	angleH: number; // horizontal angle variance
	angleV: number; // vertical launch angle
	speed: number; // multiplier
}[] {
	switch (modeId) {
		case 'trap':
		case 'double_trap':
			// Single trap house ahead
			return [{
				origin: { x: 0, y: 0.3, z: -15 },
				angleH: (Math.random() - 0.5) * 0.8,
				angleV: 0.35 + Math.random() * 0.15,
				speed: 1.0,
			}];
		case 'skeet': {
			// High house (left) and low house (right)
			const configs = [];
			if (stationIdx < 4 || stationIdx === 7) {
				configs.push({
					origin: { x: -10, y: 3.5, z: -8 },
					angleH: 0.3 + Math.random() * 0.2,
					angleV: 0.1 + Math.random() * 0.1,
					speed: 0.9,
				});
			}
			if (stationIdx >= 4 || stationIdx === 0) {
				configs.push({
					origin: { x: 10, y: 1.0, z: -8 },
					angleH: -0.3 - Math.random() * 0.2,
					angleV: 0.3 + Math.random() * 0.1,
					speed: 0.9,
				});
			}
			return configs;
		}
		case 'speed':
			// Random directions, increasing speed
			return [{
				origin: {
					x: (Math.random() - 0.5) * 16,
					y: 0.3 + Math.random() * 2,
					z: -12 - Math.random() * 6,
				},
				angleH: (Math.random() - 0.5) * 1.0,
				angleV: 0.3 + Math.random() * 0.3,
				speed: 1.0,
			}];
		case 'sporting':
			// Varied trajectories per station
			return [{
				origin: {
					x: (Math.random() - 0.5) * 20,
					y: 0.5 + Math.random() * 4,
					z: -10 - Math.random() * 8,
				},
				angleH: (Math.random() - 0.5) * 1.2,
				angleV: 0.2 + Math.random() * 0.4,
				speed: 0.8 + Math.random() * 0.4,
			}];
		default:
			return [{
				origin: { x: 0, y: 0.3, z: -15 },
				angleH: 0,
				angleV: 0.35,
				speed: 1.0,
			}];
	}
}
