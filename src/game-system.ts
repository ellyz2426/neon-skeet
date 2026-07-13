import {
	createSystem,
	World,
	PanelUI,
	PanelDocument,
	UIKitDocument,
	UIKit,
	Follower,
	Entity,
	Mesh,
	Group,
	BoxGeometry,
	SphereGeometry,
	CylinderGeometry,
	MeshStandardMaterial,
	MeshBasicMaterial,
	LineBasicMaterial,
	Color,
	Vector3,
	Quaternion,
	Euler,
	BufferGeometry,
	Float32BufferAttribute,
	EdgesGeometry,
	LineSegments,
	AdditiveBlending,
	AmbientLight,
	PointLight,
	DirectionalLight,
	Fog,
	Raycaster,
	Vector2,
	InputComponent,
	TorusGeometry,
	RingGeometry,
	eq,
} from '@iwsdk/core';
import {
	GAME_MODES,
	DIFFICULTIES,
	ACHIEVEMENTS,
	GameMode,
	DifficultyConfig,
	Achievement,
	getStationPositions,
	getLaunchConfig,
} from './data';

// ===== Types =====
type GamePhase = 'menu' | 'mode_select' | 'playing' | 'round_end' | 'game_over' | 'settings' | 'achievements';

interface ActivePigeon {
	group: Group;
	bodyMesh: Mesh;
	velocity: Vector3;
	alive: boolean;
	lifetime: number;
	maxLifetime: number;
	hitFlash: number;
}

interface Particle {
	mesh: Mesh;
	velocity: Vector3;
	lifetime: number;
	maxLifetime: number;
}

interface TracerLine {
	line: LineSegments;
	lifetime: number;
}

interface SaveData {
	totalHits: number;
	totalShots: number;
	totalRounds: number;
	bestScores: Record<string, number>;
	bestStreaks: Record<string, number>;
	achievements: string[];
	modesPlayed: string[];
	difficulty: string;
	sfxVolume: number;
}

// ===== Main Game System =====
export class GameSystem extends createSystem({
	mainMenu: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/main-menu.json')] },
	modeSelect: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/mode-select.json')] },
	hud: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/hud.json')] },
	scorecard: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/scorecard.json')] },
	gameOver: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/game-over.json')] },
	settingsPanel: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/settings.json')] },
	achievementsPanel: { required: [PanelUI, PanelDocument], where: [eq(PanelUI, 'config', './ui/achlist.json')] },
}) {
	// World refs
	private gameWorld!: World;

	// Game state
	private phase: GamePhase = 'menu';
	private currentMode: GameMode = GAME_MODES[0];
	private difficulty: DifficultyConfig = DIFFICULTIES[1];
	private score = 0;
	private roundScore = 0;
	private streak = 0;
	private bestStreak = 0;
	private hits = 0;
	private misses = 0;
	private shotsThisTarget = 0;
	private currentStation = 0;
	private currentPigeon = 0;
	private pigeonActive = false;
	private waitingForPull = true;
	private pullTimer = 0;
	private cooldownTimer = 0;
	private speedTimer = 0;
	private speedPigeonsHit = 0;
	private speedPigeonSpeed = 1.0;
	private roundComplete = false;
	private autoLaunchTimer = 0;
	private allFirstShotsOnly = true;
	private stationPerfect = true;
	private doubleStreak = 0;
	private doubleBothHit = false;
	private doublesActive: ActivePigeon[] = [];
	private windX = 0;
	private windZ = 0;

	// Entities
	private pigeons: ActivePigeon[] = [];
	private particles: Particle[] = [];
	private tracers: TracerLine[] = [];
	private environmentGroup!: Group;
	private trapHouseEntities: Group[] = [];
	private stationMarkers: Group[] = [];
	private crosshairGroup!: Group;

	// UI panel entities
	private mainMenuEntity: Entity | null = null;
	private modeSelectEntity: Entity | null = null;
	private hudEntity: Entity | null = null;
	private scorecardEntity: Entity | null = null;
	private gameOverEntity: Entity | null = null;
	private settingsEntity: Entity | null = null;
	private achievementsEntity: Entity | null = null;
	private panelDocs: Map<string, UIKitDocument> = new Map();

	// Browser mouse
	private raycaster = new Raycaster();
	private mouse = new Vector2();
	private mouseDown = false;

	// Audio
	private audioCtx: AudioContext | null = null;
	private masterGain: GainNode | null = null;
	private sfxVolume = 0.7;

	// Save data
	private saveData: SaveData = {
		totalHits: 0,
		totalShots: 0,
		totalRounds: 0,
		bestScores: {},
		bestStreaks: {},
		achievements: [],
		modesPlayed: [],
		difficulty: 'medium',
		sfxVolume: 0.7,
	};

	// ===== Init =====
	initGame(world: World) {
		this.gameWorld = world;

		this.loadSave();
		this.difficulty = DIFFICULTIES.find(d => d.id === this.saveData.difficulty) || DIFFICULTIES[1];
		this.sfxVolume = this.saveData.sfxVolume;

		this.buildEnvironment();
		this.buildCrosshair();
		this.createPanels();
		this.setupMouseListeners();
		this.showPanel('menu');
	}

	// ===== Environment =====
	private buildEnvironment() {
		// Lighting
		const ambient = new AmbientLight(0x1a1a2e, 0.6);
		this.scene.add(ambient);
		const dirLight = new DirectionalLight(0x4488cc, 0.8);
		dirLight.position.set(5, 15, 10);
		this.scene.add(dirLight);
		const pointLight1 = new PointLight(0x00ccff, 1.5, 40);
		pointLight1.position.set(0, 8, -10);
		this.scene.add(pointLight1);
		const pointLight2 = new PointLight(0xff6600, 0.8, 30);
		pointLight2.position.set(-8, 5, -5);
		this.scene.add(pointLight2);

		this.scene.fog = new Fog(0x050510, 30, 80);

		this.environmentGroup = new Group();
		this.scene.add(this.environmentGroup);

		// Ground plane (neon grid)
		const groundGeo = new BoxGeometry(60, 0.02, 60, 60, 1, 60);
		const groundMat = new MeshStandardMaterial({
			color: 0x0a0a15,
			emissive: 0x0a0a15,
			roughness: 0.9,
			metalness: 0.1,
		});
		const ground = new Mesh(groundGeo, groundMat);
		ground.position.y = -0.01;
		this.environmentGroup.add(ground);

		// Grid lines
		this.buildGridLines();

		// Trap house (main)
		this.buildTrapHouse(0, 0.15, -15, 0xff6600);

		// Skeet high house (left)
		this.buildTrapHouse(-10, 2.5, -8, 0x00ff88);

		// Skeet low house (right)
		this.buildTrapHouse(10, 0.5, -8, 0xff0088);

		// Boundary posts
		for (let i = 0; i < 8; i++) {
			const angle = (i / 8) * Math.PI * 2;
			const postGeo = new CylinderGeometry(0.05, 0.05, 3, 8);
			const postMat = new MeshStandardMaterial({
				color: 0x00ccff,
				emissive: 0x004466,
				emissiveIntensity: 0.5,
			});
			const post = new Mesh(postGeo, postMat);
			post.position.set(Math.cos(angle) * 20, 1.5, Math.sin(angle) * 20 - 10);
			this.environmentGroup.add(post);
		}

		// Distant backdrop elements
		for (let i = 0; i < 12; i++) {
			const angle = (i / 12) * Math.PI * 2;
			const towerGeo = new BoxGeometry(1, 8 + Math.random() * 12, 1);
			const towerMat = new MeshStandardMaterial({
				color: 0x111122,
				emissive: 0x0a0a20,
				emissiveIntensity: 0.3,
			});
			const tower = new Mesh(towerGeo, towerMat);
			tower.position.set(
				Math.cos(angle) * (35 + Math.random() * 10),
				(4 + Math.random() * 6),
				Math.sin(angle) * (35 + Math.random() * 10) - 10,
			);
			this.environmentGroup.add(tower);

			// Tower wireframe edge glow
			const edges = new EdgesGeometry(towerGeo);
			const edgeMat = new LineBasicMaterial({ color: 0x00ccff, transparent: true, opacity: 0.3 });
			const wireframe = new LineSegments(edges, edgeMat);
			wireframe.position.copy(tower.position);
			this.environmentGroup.add(wireframe);
		}
	}

	private buildGridLines() {
		const gridSize = 60;
		const gridStep = 2;
		const positions: number[] = [];

		for (let i = -gridSize / 2; i <= gridSize / 2; i += gridStep) {
			positions.push(i, 0.01, -gridSize / 2, i, 0.01, gridSize / 2);
			positions.push(-gridSize / 2, 0.01, i, gridSize / 2, 0.01, i);
		}

		const gridGeo = new BufferGeometry();
		gridGeo.setAttribute('position', new Float32BufferAttribute(positions, 3));
		const gridMat = new LineBasicMaterial({
			color: 0x00ccff,
			transparent: true,
			opacity: 0.15,
		});
		const gridLines = new LineSegments(gridGeo, gridMat);
		this.environmentGroup.add(gridLines);
	}

	private buildTrapHouse(x: number, y: number, z: number, color: number) {
		const group = new Group();
		group.position.set(x, y, z);

		// Main body
		const bodyGeo = new BoxGeometry(1.5, 0.8, 1.5);
		const bodyMat = new MeshStandardMaterial({
			color: 0x222233,
			emissive: color,
			emissiveIntensity: 0.3,
		});
		const body = new Mesh(bodyGeo, bodyMat);
		group.add(body);

		// Launch slot
		const slotGeo = new BoxGeometry(0.8, 0.15, 0.6);
		const slotMat = new MeshStandardMaterial({
			color,
			emissive: color,
			emissiveIntensity: 0.6,
		});
		const slot = new Mesh(slotGeo, slotMat);
		slot.position.set(0, 0.45, 0.3);
		group.add(slot);

		// Wireframe
		const edges = new EdgesGeometry(bodyGeo);
		const edgeMat = new LineBasicMaterial({ color, transparent: true, opacity: 0.6 });
		const wireframe = new LineSegments(edges, edgeMat);
		group.add(wireframe);

		// Point light
		const light = new PointLight(color, 0.8, 8);
		light.position.set(0, 1, 0);
		group.add(light);

		this.environmentGroup.add(group);
		this.trapHouseEntities.push(group);
	}

	private buildCrosshair() {
		this.crosshairGroup = new Group();
		const ringGeo = new RingGeometry(0.01, 0.013, 32);
		const ringMat = new MeshBasicMaterial({
			color: 0xff4400,
			transparent: true,
			opacity: 0.8,
			depthTest: false,
		});
		const ring = new Mesh(ringGeo, ringMat);
		this.crosshairGroup.add(ring);

		// Cross lines
		const crossSize = 0.02;
		for (let i = 0; i < 4; i++) {
			const lineGeo = new BoxGeometry(i % 2 === 0 ? crossSize : 0.001, i % 2 === 0 ? 0.001 : crossSize, 0.001);
			const lineMat = new MeshBasicMaterial({ color: 0xff4400, depthTest: false, transparent: true, opacity: 0.6 });
			const line = new Mesh(lineGeo, lineMat);
			this.crosshairGroup.add(line);
		}

		this.crosshairGroup.position.set(0, 0, -2);
		this.camera.add(this.crosshairGroup);
	}

	// ===== Panel Creation =====
	private createPanels() {
		// Main menu - world space
		this.mainMenuEntity = this.gameWorld.createTransformEntity();
		this.mainMenuEntity.addComponent(PanelUI, { config: './ui/main-menu.json' });
		this.mainMenuEntity.addComponent(Follower);
		const mainMenuOff = this.mainMenuEntity.getVectorView(Follower, 'offsetPosition');
		mainMenuOff[0] = 0; mainMenuOff[1] = 0.3; mainMenuOff[2] = -3;
		this.mainMenuEntity.object3D!.visible = true;

		// Mode select - world space
		this.modeSelectEntity = this.gameWorld.createTransformEntity();
		this.modeSelectEntity.addComponent(PanelUI, { config: './ui/mode-select.json' });
		this.modeSelectEntity.addComponent(Follower);
		const modeSelOff = this.modeSelectEntity.getVectorView(Follower, 'offsetPosition');
		modeSelOff[0] = 0; modeSelOff[1] = 0.3; modeSelOff[2] = -3;
		this.modeSelectEntity.object3D!.visible = false;

		// HUD - head-locked
		this.hudEntity = this.gameWorld.createTransformEntity();
		this.hudEntity.addComponent(PanelUI, { config: './ui/hud.json' });
		this.hudEntity.addComponent(Follower);
		const hudOff = this.hudEntity.getVectorView(Follower, 'offsetPosition');
		hudOff[0] = 0; hudOff[1] = 0.35; hudOff[2] = -1.5;
		this.hudEntity.object3D!.visible = false;

		// Scorecard - world space
		this.scorecardEntity = this.gameWorld.createTransformEntity();
		this.scorecardEntity.addComponent(PanelUI, { config: './ui/scorecard.json' });
		this.scorecardEntity.addComponent(Follower);
		const scOff = this.scorecardEntity.getVectorView(Follower, 'offsetPosition');
		scOff[0] = 0; scOff[1] = 0.3; scOff[2] = -3;
		this.scorecardEntity.object3D!.visible = false;

		// Game over - world space
		this.gameOverEntity = this.gameWorld.createTransformEntity();
		this.gameOverEntity.addComponent(PanelUI, { config: './ui/game-over.json' });
		this.gameOverEntity.addComponent(Follower);
		const goOff = this.gameOverEntity.getVectorView(Follower, 'offsetPosition');
		goOff[0] = 0; goOff[1] = 0.3; goOff[2] = -3;
		this.gameOverEntity.object3D!.visible = false;

		// Settings - world space
		this.settingsEntity = this.gameWorld.createTransformEntity();
		this.settingsEntity.addComponent(PanelUI, { config: './ui/settings.json' });
		this.settingsEntity.addComponent(Follower);
		const setOff = this.settingsEntity.getVectorView(Follower, 'offsetPosition');
		setOff[0] = 0; setOff[1] = 0.3; setOff[2] = -3;
		this.settingsEntity.object3D!.visible = false;

		// Achievements - world space
		this.achievementsEntity = this.gameWorld.createTransformEntity();
		this.achievementsEntity.addComponent(PanelUI, { config: './ui/achlist.json' });
		this.achievementsEntity.addComponent(Follower);
		const achOff = this.achievementsEntity.getVectorView(Follower, 'offsetPosition');
		achOff[0] = 0; achOff[1] = 0.3; achOff[2] = -3;
		this.achievementsEntity.object3D!.visible = false;

		// Wire up panel events
		this.queries.mainMenu.subscribe('qualify', (entity) => {
			const doc = entity.getValue(PanelDocument, 'document') as UIKitDocument;
			if (!doc) return;
			this.panelDocs.set('mainMenu', doc);
			(doc.getElementById('btn-play') as UIKit.Text)?.addEventListener('click', () => this.showPanel('mode_select'));
			(doc.getElementById('btn-settings') as UIKit.Text)?.addEventListener('click', () => this.showPanel('settings'));
			(doc.getElementById('btn-achievements') as UIKit.Text)?.addEventListener('click', () => this.showPanel('achievements'));
		});

		this.queries.modeSelect.subscribe('qualify', (entity) => {
			const doc = entity.getValue(PanelDocument, 'document') as UIKitDocument;
			if (!doc) return;
			this.panelDocs.set('modeSelect', doc);
			for (let i = 0; i < GAME_MODES.length; i++) {
				const mode = GAME_MODES[i];
				(doc.getElementById(`mode-${mode.id}`) as UIKit.Text)?.addEventListener('click', () => this.selectMode(mode));
			}
			(doc.getElementById('btn-back') as UIKit.Text)?.addEventListener('click', () => this.showPanel('menu'));
		});

		this.queries.hud.subscribe('qualify', (entity) => {
			const doc = entity.getValue(PanelDocument, 'document') as UIKitDocument;
			if (!doc) return;
			this.panelDocs.set('hud', doc);
		});

		this.queries.scorecard.subscribe('qualify', (entity) => {
			const doc = entity.getValue(PanelDocument, 'document') as UIKitDocument;
			if (!doc) return;
			this.panelDocs.set('scorecard', doc);
			(doc.getElementById('btn-next') as UIKit.Text)?.addEventListener('click', () => this.nextRound());
			(doc.getElementById('btn-menu-sc') as UIKit.Text)?.addEventListener('click', () => this.showPanel('menu'));
		});

		this.queries.gameOver.subscribe('qualify', (entity) => {
			const doc = entity.getValue(PanelDocument, 'document') as UIKitDocument;
			if (!doc) return;
			this.panelDocs.set('gameOver', doc);
			(doc.getElementById('btn-retry') as UIKit.Text)?.addEventListener('click', () => this.selectMode(this.currentMode));
			(doc.getElementById('btn-menu-go') as UIKit.Text)?.addEventListener('click', () => this.showPanel('menu'));
		});

		this.queries.settingsPanel.subscribe('qualify', (entity) => {
			const doc = entity.getValue(PanelDocument, 'document') as UIKitDocument;
			if (!doc) return;
			this.panelDocs.set('settings', doc);
			for (const d of DIFFICULTIES) {
				(doc.getElementById(`diff-${d.id}`) as UIKit.Text)?.addEventListener('click', () => this.setDifficulty(d));
			}
			(doc.getElementById('sfx-up') as UIKit.Text)?.addEventListener('click', () => this.adjustVolume(0.1));
			(doc.getElementById('sfx-down') as UIKit.Text)?.addEventListener('click', () => this.adjustVolume(-0.1));
			(doc.getElementById('btn-back-settings') as UIKit.Text)?.addEventListener('click', () => this.showPanel('menu'));
			this.updateSettingsUI();
		});

		this.queries.achievementsPanel.subscribe('qualify', (entity) => {
			const doc = entity.getValue(PanelDocument, 'document') as UIKitDocument;
			if (!doc) return;
			this.panelDocs.set('achievements', doc);
			(doc.getElementById('btn-back-ach') as UIKit.Text)?.addEventListener('click', () => this.showPanel('menu'));
			this.updateAchievementsUI();
		});
	}

	// ===== Panel Visibility =====
	private showPanel(panel: GamePhase) {
		this.phase = panel;
		const panelMap: Record<string, Entity | null> = {
			menu: this.mainMenuEntity,
			mode_select: this.modeSelectEntity,
			playing: this.hudEntity,
			round_end: this.scorecardEntity,
			game_over: this.gameOverEntity,
			settings: this.settingsEntity,
			achievements: this.achievementsEntity,
		};

		for (const [key, entity] of Object.entries(panelMap)) {
			if (entity?.object3D) {
				entity.object3D.visible = key === panel;
			}
		}

		if (panel === 'menu') {
			this.updateMenuUI();
		} else if (panel === 'settings') {
			this.updateSettingsUI();
		} else if (panel === 'achievements') {
			this.updateAchievementsUI();
		}
	}

	// ===== Game Flow =====
	private selectMode(mode: GameMode) {
		this.currentMode = mode;
		this.startGame();
	}

	private startGame() {
		this.score = 0;
		this.roundScore = 0;
		this.streak = 0;
		this.bestStreak = 0;
		this.hits = 0;
		this.misses = 0;
		this.currentStation = 0;
		this.currentPigeon = 0;
		this.pigeonActive = false;
		this.waitingForPull = true;
		this.pullTimer = 0;
		this.cooldownTimer = 0;
		this.speedTimer = this.currentMode.timeLimit;
		this.speedPigeonsHit = 0;
		this.speedPigeonSpeed = 1.0;
		this.roundComplete = false;
		this.allFirstShotsOnly = true;
		this.stationPerfect = true;
		this.doubleStreak = 0;
		this.autoLaunchTimer = 0;

		// Set wind for this round
		this.windX = (Math.random() - 0.5) * this.difficulty.windStrength * 2;
		this.windZ = (Math.random() - 0.5) * this.difficulty.windStrength;

		// Build station markers
		this.clearStationMarkers();
		this.buildStationMarkers();

		this.showPanel('playing');
		this.updateHUD();
		this.playSound('start');

		// Auto-launch first pigeon after delay in speed mode
		if (this.currentMode.speedMode) {
			this.autoLaunchTimer = 1.5;
			this.waitingForPull = false;
		}
	}

	private buildStationMarkers() {
		const positions = getStationPositions(this.currentMode.id);
		for (let i = 0; i < positions.length; i++) {
			const pos = positions[i];
			const markerGroup = new Group();
			markerGroup.position.set(pos.x, 0.02, pos.z);

			const ringGeo = new RingGeometry(0.3, 0.4, 32);
			const color = i === this.currentStation ? 0x00ff88 : 0x444466;
			const ringMat = new MeshBasicMaterial({
				color,
				transparent: true,
				opacity: 0.6,
			});
			const ring = new Mesh(ringGeo, ringMat);
			ring.rotation.x = -Math.PI / 2;
			markerGroup.add(ring);

			this.scene.add(markerGroup);
			this.stationMarkers.push(markerGroup);
		}
	}

	private clearStationMarkers() {
		for (const marker of this.stationMarkers) {
			this.scene.remove(marker);
		}
		this.stationMarkers = [];
	}

	private updateStationMarkerColors() {
		for (let i = 0; i < this.stationMarkers.length; i++) {
			const marker = this.stationMarkers[i];
			const ring = marker.children[0] as Mesh;
			if (ring && ring.material instanceof MeshBasicMaterial) {
				ring.material.color.setHex(i === this.currentStation ? 0x00ff88 : 0x444466);
			}
		}
	}

	private launchPigeon() {
		if (this.pigeonActive && !this.currentMode.doubles) return;

		this.pigeonActive = true;
		this.waitingForPull = false;
		this.shotsThisTarget = 0;
		this.doublesActive = [];
		this.doubleBothHit = false;

		const launches = getLaunchConfig(this.currentMode.id, this.currentStation);
		const pigeonCount = this.currentMode.doubles ? 2 : 1;

		for (let p = 0; p < Math.min(pigeonCount, launches.length === 1 ? pigeonCount : launches.length); p++) {
			const config = launches[Math.min(p, launches.length - 1)];
			const speed = this.difficulty.pigeonSpeed * config.speed * this.speedPigeonSpeed;

			// Create pigeon mesh
			const pigeonGroup = new Group();
			const discGeo = new TorusGeometry(0.15 * this.difficulty.pigeonScale, 0.04 * this.difficulty.pigeonScale, 8, 24);
			const discMat = new MeshStandardMaterial({
				color: 0xff6600,
				emissive: 0xff4400,
				emissiveIntensity: 0.8,
				metalness: 0.3,
				roughness: 0.4,
			});
			const disc = new Mesh(discGeo, discMat);
			disc.rotation.x = Math.PI / 2;
			pigeonGroup.add(disc);

			// Inner disc
			const innerGeo = new CylinderGeometry(0.12 * this.difficulty.pigeonScale, 0.12 * this.difficulty.pigeonScale, 0.02, 16);
			const innerMat = new MeshStandardMaterial({
				color: 0xff8800,
				emissive: 0xff6600,
				emissiveIntensity: 0.6,
			});
			const inner = new Mesh(innerGeo, innerMat);
			pigeonGroup.add(inner);

			// Wireframe
			const edges = new EdgesGeometry(discGeo);
			const edgeMat = new LineBasicMaterial({ color: 0xffaa00, transparent: true, opacity: 0.5 });
			const wireframe = new LineSegments(edges, edgeMat);
			wireframe.rotation.x = Math.PI / 2;
			pigeonGroup.add(wireframe);

			// Position at launch origin
			const origin = config.origin;
			const doubleOffset = this.currentMode.doubles ? (p === 0 ? -0.5 : 0.5) : 0;
			pigeonGroup.position.set(
				origin.x + doubleOffset,
				origin.y,
				origin.z,
			);

			// Calculate velocity
			const angleH = config.angleH + (this.currentMode.doubles ? (p === 0 ? -0.15 : 0.15) : 0);
			const velocity = new Vector3(
				Math.sin(angleH) * speed,
				Math.sin(config.angleV) * speed,
				Math.cos(angleH) * speed * 0.3,
			);

			this.scene.add(pigeonGroup);

			const pigeon: ActivePigeon = {
				group: pigeonGroup,
				bodyMesh: disc,
				velocity,
				alive: true,
				lifetime: 0,
				maxLifetime: 5,
				hitFlash: 0,
			};

			this.pigeons.push(pigeon);
			if (this.currentMode.doubles) {
				this.doublesActive.push(pigeon);
			}
		}

		this.playSound('launch');
	}

	private nextPigeon() {
		this.pigeonActive = false;
		this.currentPigeon++;

		if (this.currentMode.speedMode) {
			// Speed mode: continuous launch
			this.autoLaunchTimer = Math.max(0.5, 2.0 - this.speedPigeonsHit * 0.03);
			this.speedPigeonSpeed = 1.0 + this.speedPigeonsHit * 0.02;
			return;
		}

		if (this.currentPigeon >= this.currentMode.pigeonsPerStation) {
			// Station complete
			if (this.stationPerfect) {
				this.checkAchievement('perfect_station');
			}
			this.currentPigeon = 0;
			this.currentStation++;
			this.stationPerfect = true;

			if (this.currentStation >= this.currentMode.stations) {
				// Round complete
				this.endRound();
				return;
			}

			this.updateStationMarkerColors();
		}

		this.waitingForPull = true;
		this.pullTimer = 0;
	}

	private endRound() {
		this.roundComplete = true;
		this.roundScore = this.score;

		// Update stats
		this.saveData.totalHits += this.hits;
		this.saveData.totalShots += this.hits + this.misses;
		this.saveData.totalRounds++;

		const modeId = this.currentMode.id;
		if (!this.saveData.bestScores[modeId] || this.score > this.saveData.bestScores[modeId]) {
			this.saveData.bestScores[modeId] = this.score;
		}
		if (!this.saveData.bestStreaks[modeId] || this.bestStreak > this.saveData.bestStreaks[modeId]) {
			this.saveData.bestStreaks[modeId] = this.bestStreak;
		}
		if (!this.saveData.modesPlayed.includes(modeId)) {
			this.saveData.modesPlayed.push(modeId);
		}

		// Check achievements
		const total = this.hits + this.misses;
		if (total > 0 && this.hits === total) this.checkAchievement('perfect_round');
		if (this.allFirstShotsOnly) this.checkAchievement('one_shot');
		if (this.saveData.modesPlayed.length >= GAME_MODES.length) this.checkAchievement('all_modes');
		if (this.score >= 1000) this.checkAchievement('score_1000');
		if (this.score >= 2500) this.checkAchievement('score_2500');
		if (this.saveData.totalRounds >= 10) this.checkAchievement('rounds_10');
		if (this.saveData.totalRounds >= 25) this.checkAchievement('rounds_25');
		if (this.difficulty.id === 'hard' && this.hits === total && total > 0) this.checkAchievement('hard_perfect');
		if (this.currentMode.speedMode && this.speedPigeonsHit >= 20) this.checkAchievement('speed_20');
		if (this.currentMode.speedMode && this.speedPigeonsHit >= 40) this.checkAchievement('speed_40');
		this.checkTotalAchievements();

		this.saveSave();
		this.updateScorecardUI();
		this.showPanel('round_end');
		this.playSound('roundEnd');
	}

	private nextRound() {
		this.startGame();
	}

	// ===== Shooting =====
	private tryShoot() {
		if (this.phase !== 'playing') return;
		if (this.cooldownTimer > 0) return;
		if (!this.pigeonActive) {
			// Pull trigger launches pigeon
			if (this.waitingForPull) {
				this.launchPigeon();
			}
			return;
		}

		this.cooldownTimer = 0.35; // Pump action delay
		this.shotsThisTarget++;

		if (this.shotsThisTarget > 1) {
			this.allFirstShotsOnly = false;
		}

		// Raycast for hit detection
		const hitPigeon = this.checkHit();
		if (hitPigeon) {
			this.onHit(hitPigeon);
		} else {
			this.playSound('miss');
			this.spawnTracerMiss();
		}

		this.playSound('shoot');

		// Max 2 shots per single target
		if (!this.currentMode.doubles && this.shotsThisTarget >= 2 && this.pigeonActive) {
			// Miss - pigeon flies away
			for (const p of this.pigeons) {
				if (p.alive) {
					this.onMiss(p);
				}
			}
		}
	}

	private checkHit(): ActivePigeon | null {
		// Get ray origin and direction
		const rayOrigin = new Vector3();
		const rayDir = new Vector3();

		// Check VR controllers first
		const rightGrip = this.gameWorld.playerSpaceEntities?.gripSpaces?.right?.object3D;
		if (rightGrip) {
			rightGrip.getWorldPosition(rayOrigin);
			const forward = new Vector3(0, 0, -1);
			forward.applyQuaternion(rightGrip.getWorldQuaternion(new Quaternion()));
			rayDir.copy(forward);
		} else {
			// Browser mode: ray from camera through mouse
			this.raycaster.setFromCamera(this.mouse, this.camera);
			rayOrigin.copy(this.raycaster.ray.origin);
			rayDir.copy(this.raycaster.ray.direction);
		}

		// Apply spread (slight randomness)
		const spread = this.difficulty.spreadAngle;
		rayDir.x += (Math.random() - 0.5) * spread;
		rayDir.y += (Math.random() - 0.5) * spread;
		rayDir.z += (Math.random() - 0.5) * spread;
		rayDir.normalize();

		this.raycaster.set(rayOrigin, rayDir);

		// Check against all alive pigeons
		const meshes = this.pigeons.filter(p => p.alive).map(p => p.bodyMesh);
		const intersects = this.raycaster.intersectObjects(meshes, true);

		if (intersects.length > 0) {
			const hitMesh = intersects[0].object as Mesh;
			const pigeon = this.pigeons.find(p =>
				p.alive && (p.bodyMesh === hitMesh || p.group.children.some(c => c === hitMesh)),
			);
			if (pigeon) {
				this.spawnTracerHit(rayOrigin, intersects[0].point);
				return pigeon;
			}
		}

		return null;
	}

	private onHit(pigeon: ActivePigeon) {
		pigeon.alive = false;
		pigeon.hitFlash = 0.3;
		this.hits++;
		this.streak++;
		if (this.streak > this.bestStreak) this.bestStreak = this.streak;

		// Scoring: base 100 * difficulty multiplier * streak bonus
		const streakBonus = 1 + Math.min(this.streak * 0.1, 2.0);
		const firstShotBonus = this.shotsThisTarget === 1 ? 1.5 : 1.0;
		const points = Math.floor(100 * this.difficulty.scoreMultiplier * streakBonus * firstShotBonus);
		this.score += points;

		if (this.currentMode.speedMode) {
			this.speedPigeonsHit++;
		}

		// Doubles tracking
		if (this.currentMode.doubles) {
			const allDoublesHit = this.doublesActive.every(p => !p.alive);
			if (allDoublesHit) {
				this.doubleBothHit = true;
				this.doubleStreak++;
				if (this.doubleStreak >= 5) this.checkAchievement('double_ace');
				this.score += 50; // Bonus for double hit
			}
		}

		// Achievement checks
		if (this.saveData.totalHits + this.hits >= 1) this.checkAchievement('first_hit');
		if (this.streak >= 5) this.checkAchievement('streak_5');
		if (this.streak >= 10) this.checkAchievement('streak_10');
		if (this.streak >= 25) this.checkAchievement('streak_25');
		if (this.saveData.totalHits + this.hits >= 50) this.checkAchievement('total_50');
		if (this.saveData.totalHits + this.hits >= 100) this.checkAchievement('total_100');
		if (this.saveData.totalHits + this.hits >= 250) this.checkAchievement('total_250');
		if (this.saveData.totalHits + this.hits >= 500) this.checkAchievement('total_500');

		// Particle explosion
		this.spawnShatterParticles(pigeon.group.position.clone());
		this.playSound('hit');
		this.updateHUD();

		// Check if all pigeons in this launch are done
		const allDone = this.pigeons.every(p => !p.alive || p.lifetime > p.maxLifetime);
		if (allDone) {
			setTimeout(() => this.nextPigeon(), 500);
		}
	}

	private onMiss(pigeon: ActivePigeon) {
		pigeon.alive = false;
		this.misses++;
		this.streak = 0;
		this.stationPerfect = false;
		if (this.currentMode.doubles) {
			this.doubleStreak = 0;
		}
		this.playSound('flyaway');
		this.updateHUD();

		const allDone = this.pigeons.every(p => !p.alive || p.lifetime > p.maxLifetime);
		if (allDone) {
			setTimeout(() => this.nextPigeon(), 500);
		}
	}

	// ===== Particles =====
	private spawnShatterParticles(pos: Vector3) {
		const count = 20;
		for (let i = 0; i < count; i++) {
			const size = 0.02 + Math.random() * 0.04;
			const geo = new BoxGeometry(size, size * 0.3, size);
			const colors = [0xff6600, 0xff8800, 0xffaa00, 0xff4400, 0xffcc00];
			const mat = new MeshBasicMaterial({
				color: colors[Math.floor(Math.random() * colors.length)],
				transparent: true,
				opacity: 1,
			});
			const mesh = new Mesh(geo, mat);
			mesh.position.copy(pos);
			mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
			this.scene.add(mesh);

			this.particles.push({
				mesh,
				velocity: new Vector3(
					(Math.random() - 0.5) * 8,
					Math.random() * 6 + 2,
					(Math.random() - 0.5) * 8,
				),
				lifetime: 0,
				maxLifetime: 1.0 + Math.random() * 0.5,
			});
		}
	}

	private spawnTracerHit(from: Vector3, to: Vector3) {
		const positions = [from.x, from.y, from.z, to.x, to.y, to.z];
		const geo = new BufferGeometry();
		geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
		const mat = new LineBasicMaterial({
			color: 0x00ff88,
			transparent: true,
			opacity: 0.8,
			blending: AdditiveBlending,
		});
		const line = new LineSegments(geo, mat);
		this.scene.add(line);
		this.tracers.push({ line, lifetime: 0.15 });
	}

	private spawnTracerMiss() {
		const from = new Vector3();
		const dir = new Vector3();

		const rightGrip = this.gameWorld.playerSpaceEntities?.gripSpaces?.right?.object3D;
		if (rightGrip) {
			rightGrip.getWorldPosition(from);
			const forward = new Vector3(0, 0, -1);
			forward.applyQuaternion(rightGrip.getWorldQuaternion(new Quaternion()));
			dir.copy(forward);
		} else {
			this.camera.getWorldPosition(from);
			this.camera.getWorldDirection(dir);
		}

		const to = from.clone().add(dir.multiplyScalar(50));
		const positions = [from.x, from.y, from.z, to.x, to.y, to.z];
		const geo = new BufferGeometry();
		geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
		const mat = new LineBasicMaterial({
			color: 0xff4400,
			transparent: true,
			opacity: 0.5,
			blending: AdditiveBlending,
		});
		const line = new LineSegments(geo, mat);
		this.scene.add(line);
		this.tracers.push({ line, lifetime: 0.12 });
	}

	// ===== Audio =====
	private initAudio() {
		if (!this.audioCtx) {
			this.audioCtx = new AudioContext();
			this.masterGain = this.audioCtx.createGain();
			this.masterGain.gain.value = this.sfxVolume;
			this.masterGain.connect(this.audioCtx.destination);
		}
	}

	private playSound(type: string) {
		this.initAudio();
		if (!this.audioCtx || !this.masterGain) return;

		const ctx = this.audioCtx;
		const now = ctx.currentTime;

		switch (type) {
			case 'shoot': {
				// Gunshot: noise burst + low boom
				const bufferSize = ctx.sampleRate * 0.15;
				const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
				const data = buffer.getChannelData(0);
				for (let i = 0; i < bufferSize; i++) {
					data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.1));
				}
				const noise = ctx.createBufferSource();
				noise.buffer = buffer;
				const filter = ctx.createBiquadFilter();
				filter.type = 'lowpass';
				filter.frequency.setValueAtTime(3000, now);
				filter.frequency.exponentialRampToValueAtTime(200, now + 0.15);
				const gain = ctx.createGain();
				gain.gain.setValueAtTime(0.8, now);
				gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
				noise.connect(filter).connect(gain).connect(this.masterGain!);
				noise.start(now);
				// Low boom
				const osc = ctx.createOscillator();
				osc.frequency.setValueAtTime(80, now);
				osc.frequency.exponentialRampToValueAtTime(30, now + 0.15);
				const oscGain = ctx.createGain();
				oscGain.gain.setValueAtTime(0.5, now);
				oscGain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
				osc.connect(oscGain).connect(this.masterGain!);
				osc.start(now);
				osc.stop(now + 0.25);
				break;
			}
			case 'launch': {
				// Swoosh
				const osc = ctx.createOscillator();
				osc.type = 'sawtooth';
				osc.frequency.setValueAtTime(200, now);
				osc.frequency.exponentialRampToValueAtTime(800, now + 0.2);
				const gain = ctx.createGain();
				gain.gain.setValueAtTime(0.15, now);
				gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
				const filter = ctx.createBiquadFilter();
				filter.type = 'bandpass';
				filter.frequency.value = 500;
				filter.Q.value = 2;
				osc.connect(filter).connect(gain).connect(this.masterGain!);
				osc.start(now);
				osc.stop(now + 0.35);
				break;
			}
			case 'hit': {
				// Shatter + ding
				const bufSize = ctx.sampleRate * 0.2;
				const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
				const d = buf.getChannelData(0);
				for (let i = 0; i < bufSize; i++) {
					d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufSize * 0.05));
				}
				const noise = ctx.createBufferSource();
				noise.buffer = buf;
				const filter = ctx.createBiquadFilter();
				filter.type = 'highpass';
				filter.frequency.value = 2000;
				const gain = ctx.createGain();
				gain.gain.setValueAtTime(0.4, now);
				gain.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
				noise.connect(filter).connect(gain).connect(this.masterGain!);
				noise.start(now);
				// Ding
				const osc = ctx.createOscillator();
				osc.frequency.value = 1200;
				const dingGain = ctx.createGain();
				dingGain.gain.setValueAtTime(0.3, now);
				dingGain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
				osc.connect(dingGain).connect(this.masterGain!);
				osc.start(now);
				osc.stop(now + 0.35);
				break;
			}
			case 'miss': {
				const osc = ctx.createOscillator();
				osc.frequency.setValueAtTime(300, now);
				osc.frequency.exponentialRampToValueAtTime(100, now + 0.2);
				const gain = ctx.createGain();
				gain.gain.setValueAtTime(0.15, now);
				gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
				osc.connect(gain).connect(this.masterGain!);
				osc.start(now);
				osc.stop(now + 0.3);
				break;
			}
			case 'flyaway': {
				const osc = ctx.createOscillator();
				osc.type = 'triangle';
				osc.frequency.setValueAtTime(400, now);
				osc.frequency.exponentialRampToValueAtTime(150, now + 0.4);
				const gain = ctx.createGain();
				gain.gain.setValueAtTime(0.2, now);
				gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
				osc.connect(gain).connect(this.masterGain!);
				osc.start(now);
				osc.stop(now + 0.55);
				break;
			}
			case 'start': {
				[523, 659, 784].forEach((freq, i) => {
					const osc = ctx.createOscillator();
					osc.frequency.value = freq;
					const gain = ctx.createGain();
					gain.gain.setValueAtTime(0, now + i * 0.1);
					gain.gain.linearRampToValueAtTime(0.2, now + i * 0.1 + 0.05);
					gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.1 + 0.3);
					osc.connect(gain).connect(this.masterGain!);
					osc.start(now + i * 0.1);
					osc.stop(now + i * 0.1 + 0.35);
				});
				break;
			}
			case 'roundEnd': {
				[784, 988, 1175, 1319].forEach((freq, i) => {
					const osc = ctx.createOscillator();
					osc.frequency.value = freq;
					const gain = ctx.createGain();
					gain.gain.setValueAtTime(0, now + i * 0.15);
					gain.gain.linearRampToValueAtTime(0.15, now + i * 0.15 + 0.05);
					gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.15 + 0.5);
					osc.connect(gain).connect(this.masterGain!);
					osc.start(now + i * 0.15);
					osc.stop(now + i * 0.15 + 0.55);
				});
				break;
			}
			case 'pull': {
				const osc = ctx.createOscillator();
				osc.type = 'square';
				osc.frequency.value = 880;
				const gain = ctx.createGain();
				gain.gain.setValueAtTime(0.2, now);
				gain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
				osc.connect(gain).connect(this.masterGain!);
				osc.start(now);
				osc.stop(now + 0.2);
				break;
			}
			case 'achievement': {
				[1047, 1319, 1568].forEach((freq, i) => {
					const osc = ctx.createOscillator();
					osc.frequency.value = freq;
					const gain = ctx.createGain();
					gain.gain.setValueAtTime(0, now + i * 0.12);
					gain.gain.linearRampToValueAtTime(0.25, now + i * 0.12 + 0.04);
					gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.12 + 0.4);
					osc.connect(gain).connect(this.masterGain!);
					osc.start(now + i * 0.12);
					osc.stop(now + i * 0.12 + 0.45);
				});
				break;
			}
		}
	}

	// ===== UI Updates =====
	private setText(panel: string, id: string, text: string) {
		const doc = this.panelDocs.get(panel);
		if (!doc) return;
		(doc.getElementById(id) as UIKit.Text)?.setProperties({ text });
	}

	private setColor(panel: string, id: string, bg: string) {
		const doc = this.panelDocs.get(panel);
		if (!doc) return;
		(doc.getElementById(id) as UIKit.Text)?.setProperties({ backgroundColor: bg });
	}

	private updateHUD() {
		const totalPigeons = this.currentMode.pigeonsPerStation * this.currentMode.stations;
		const currentPigeonNum = this.currentStation * this.currentMode.pigeonsPerStation + this.currentPigeon + 1;

		this.setText('hud', 'score-val', `${this.score}`);
		this.setText('hud', 'streak-val', `${this.streak}`);
		this.setText('hud', 'station-val', `${this.currentStation + 1}/${this.currentMode.stations}`);
		this.setText('hud', 'pigeon-val', `${currentPigeonNum}/${totalPigeons}`);
		this.setText('hud', 'hits-val', `${this.hits}`);
		this.setText('hud', 'misses-val', `${this.misses}`);

		if (this.currentMode.speedMode) {
			this.setText('hud', 'timer-val', `${Math.ceil(this.speedTimer)}s`);
		} else {
			this.setText('hud', 'timer-val', this.waitingForPull ? 'PULL!' : '');
		}

		// Wind indicator
		const windStr = this.difficulty.windStrength > 0
			? `Wind: ${this.windX > 0 ? '>' : '<'} ${Math.abs(this.windX).toFixed(1)}`
			: 'No Wind';
		this.setText('hud', 'wind-val', windStr);
	}

	private updateMenuUI() {
		this.setText('mainMenu', 'total-score', `Total Hits: ${this.saveData.totalHits}`);
		this.setText('mainMenu', 'total-rounds', `Rounds: ${this.saveData.totalRounds}`);
		this.setText('mainMenu', 'ach-count', `${this.saveData.achievements.length}/${ACHIEVEMENTS.length}`);
	}

	private updateScorecardUI() {
		const total = this.hits + this.misses;
		const accuracy = total > 0 ? Math.round((this.hits / total) * 100) : 0;

		this.setText('scorecard', 'sc-mode', this.currentMode.name);
		this.setText('scorecard', 'sc-difficulty', this.difficulty.name);
		this.setText('scorecard', 'sc-score', `${this.score}`);
		this.setText('scorecard', 'sc-hits', `${this.hits}/${total}`);
		this.setText('scorecard', 'sc-accuracy', `${accuracy}%`);
		this.setText('scorecard', 'sc-streak', `${this.bestStreak}`);
		this.setText('scorecard', 'sc-first-shots', this.allFirstShotsOnly ? 'Yes' : 'No');
	}

	private updateSettingsUI() {
		for (const d of DIFFICULTIES) {
			const isActive = d.id === this.difficulty.id;
			this.setColor('settings', `diff-${d.id}`, isActive ? '#00cc88' : '#333355');
		}
		this.setText('settings', 'sfx-val', `${Math.round(this.sfxVolume * 100)}%`);
	}

	private updateAchievementsUI() {
		for (let i = 0; i < ACHIEVEMENTS.length && i < 20; i++) {
			const ach = ACHIEVEMENTS[i];
			const unlocked = this.saveData.achievements.includes(ach.id);
			this.setText('achievements', `ach-${i}-name`, unlocked ? ach.name : '???');
			this.setText('achievements', `ach-${i}-desc`, unlocked ? ach.description : 'Locked');
			this.setColor('achievements', `ach-${i}-bg`, unlocked ? '#1a3322' : '#1a1a2e');
		}
	}

	private setDifficulty(diff: DifficultyConfig) {
		this.difficulty = diff;
		this.saveData.difficulty = diff.id;
		this.saveSave();
		this.updateSettingsUI();
	}

	private adjustVolume(delta: number) {
		this.sfxVolume = Math.max(0, Math.min(1, this.sfxVolume + delta));
		if (this.masterGain) this.masterGain.gain.value = this.sfxVolume;
		this.saveData.sfxVolume = this.sfxVolume;
		this.saveSave();
		this.updateSettingsUI();
	}

	// ===== Achievements =====
	private checkAchievement(id: string) {
		if (this.saveData.achievements.includes(id)) return;
		const ach = ACHIEVEMENTS.find(a => a.id === id);
		if (!ach) return;
		this.saveData.achievements.push(id);
		this.saveSave();
		this.playSound('achievement');
	}

	private checkTotalAchievements() {
		const total = this.saveData.totalHits + this.hits;
		if (total >= 50) this.checkAchievement('total_50');
		if (total >= 100) this.checkAchievement('total_100');
		if (total >= 250) this.checkAchievement('total_250');
		if (total >= 500) this.checkAchievement('total_500');
	}

	// ===== Save/Load =====
	private saveSave() {
		try { localStorage.setItem('neon-skeet-save', JSON.stringify(this.saveData)); } catch (_e) { /* ignore */ }
	}

	private loadSave() {
		try {
			const data = localStorage.getItem('neon-skeet-save');
			if (data) this.saveData = { ...this.saveData, ...JSON.parse(data) };
		} catch (_e) { /* ignore */ }
	}

	// ===== Mouse Listeners =====
	private setupMouseListeners() {
		const canvas = this.renderer.domElement;
		canvas.addEventListener('mousedown', (e: MouseEvent) => {
			this.mouseDown = true;
			this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
			this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
		});
		canvas.addEventListener('mouseup', () => { this.mouseDown = false; });
		canvas.addEventListener('mousemove', (e: MouseEvent) => {
			this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
			this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
		});
	}

	// ===== Main Update Loop =====
	update(delta: number, time: number) {
		if (this.phase === 'playing') {
			this.updateGameplay(delta, time);
		}

		this.updatePigeons(delta);
		this.updateParticles(delta);
		this.updateTracers(delta);
		this.updateTrapHouseGlow(time);

		// Handle input
		this.handleInput();
	}

	private handleInput() {
		// Browser click
		if (this.mouseDown && this.phase === 'playing') {
			this.mouseDown = false;
			this.tryShoot();
		}

		// VR controller trigger
		const rightPad = this.gameWorld.input?.xr?.gamepads?.right;
		const leftPad = this.gameWorld.input?.xr?.gamepads?.left;

		if (rightPad?.getButtonDown(InputComponent.Trigger)) {
			if (this.phase === 'playing') {
				this.tryShoot();
			}
		}

		// A button for pull (alternative)
		if (rightPad?.getButtonDown(InputComponent.A_Button) ||
			leftPad?.getButtonDown(InputComponent.A_Button)) {
			if (this.phase === 'playing' && this.waitingForPull) {
				this.launchPigeon();
			}
		}

		// B button for pause/menu
		if (rightPad?.getButtonDown(InputComponent.B_Button) ||
			leftPad?.getButtonDown(InputComponent.B_Button)) {
			if (this.phase === 'playing') {
				this.showPanel('menu');
			}
		}
	}

	private updateGameplay(delta: number, _time: number) {
		// Cooldown
		if (this.cooldownTimer > 0) {
			this.cooldownTimer -= delta;
		}

		// Speed mode timer
		if (this.currentMode.speedMode && !this.roundComplete) {
			this.speedTimer -= delta;
			if (this.speedTimer <= 0) {
				this.speedTimer = 0;
				this.endRound();
				return;
			}
			this.updateHUD();
		}

		// Auto-launch timer (speed mode)
		if (this.autoLaunchTimer > 0 && !this.pigeonActive) {
			this.autoLaunchTimer -= delta;
			if (this.autoLaunchTimer <= 0) {
				this.launchPigeon();
			}
		}

		// Auto pull after delay (non-speed modes)
		if (this.waitingForPull && !this.currentMode.speedMode) {
			this.pullTimer += delta;
			if (this.pullTimer > 3.0) {
				this.launchPigeon();
			}
		}
	}

	private updatePigeons(delta: number) {
		const toRemove: ActivePigeon[] = [];

		for (const pigeon of this.pigeons) {
			pigeon.lifetime += delta;

			if (pigeon.alive) {
				// Apply physics
				pigeon.velocity.y -= 9.8 * delta; // Gravity
				pigeon.velocity.x += this.windX * delta;
				pigeon.velocity.z += this.windZ * delta;

				pigeon.group.position.add(
					pigeon.velocity.clone().multiplyScalar(delta),
				);

				// Spin the pigeon
				pigeon.group.rotation.y += delta * 5;
				pigeon.group.rotation.x += delta * 2;

				// Check if out of bounds or lifetime exceeded
				if (pigeon.lifetime > pigeon.maxLifetime ||
					pigeon.group.position.y < -5 ||
					Math.abs(pigeon.group.position.x) > 40 ||
					pigeon.group.position.z > 20 ||
					pigeon.group.position.z < -40) {
					if (this.phase === 'playing') {
						this.onMiss(pigeon);
					} else {
						pigeon.alive = false;
					}
				}
			} else {
				// Flash and fade
				pigeon.hitFlash -= delta;
				if (pigeon.hitFlash <= 0) {
					// Scale down
					const scale = Math.max(0, 1 - (pigeon.lifetime - (pigeon.maxLifetime - 0.5)));
					pigeon.group.scale.setScalar(scale);
				}
			}

			if (pigeon.lifetime > pigeon.maxLifetime + 1) {
				toRemove.push(pigeon);
			}
		}

		for (const p of toRemove) {
			this.scene.remove(p.group);
			this.pigeons.splice(this.pigeons.indexOf(p), 1);
		}
	}

	private updateParticles(delta: number) {
		const toRemove: number[] = [];

		for (let i = 0; i < this.particles.length; i++) {
			const p = this.particles[i];
			p.lifetime += delta;

			if (p.lifetime >= p.maxLifetime) {
				toRemove.push(i);
				continue;
			}

			// Physics
			p.velocity.y -= 12 * delta;
			p.mesh.position.add(p.velocity.clone().multiplyScalar(delta));
			p.mesh.rotation.x += delta * 8;
			p.mesh.rotation.z += delta * 6;

			// Fade
			const t = p.lifetime / p.maxLifetime;
			const mat = p.mesh.material as MeshBasicMaterial;
			mat.opacity = 1 - t;
		}

		for (let i = toRemove.length - 1; i >= 0; i--) {
			const idx = toRemove[i];
			this.scene.remove(this.particles[idx].mesh);
			this.particles.splice(idx, 1);
		}
	}

	private updateTracers(delta: number) {
		const toRemove: number[] = [];

		for (let i = 0; i < this.tracers.length; i++) {
			this.tracers[i].lifetime -= delta;
			if (this.tracers[i].lifetime <= 0) {
				toRemove.push(i);
			} else {
				const mat = this.tracers[i].line.material as LineBasicMaterial;
				mat.opacity = this.tracers[i].lifetime / 0.15;
			}
		}

		for (let i = toRemove.length - 1; i >= 0; i--) {
			const idx = toRemove[i];
			this.scene.remove(this.tracers[idx].line);
			this.tracers.splice(idx, 1);
		}
	}

	private updateTrapHouseGlow(time: number) {
		for (const house of this.trapHouseEntities) {
			const slot = house.children[1] as Mesh;
			if (slot && slot.material instanceof MeshStandardMaterial) {
				slot.material.emissiveIntensity = 0.4 + Math.sin(time * 3) * 0.2;
			}
		}
	}
}
