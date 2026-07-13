import { World } from '@iwsdk/core';
import { GameSystem } from './game-system';

const container = document.getElementById('scene-container') as HTMLDivElement;

const world = await World.create(container, {
	xr: { offer: 'once' },
	render: {
		fov: 75,
		near: 0.01,
		far: 100,
		defaultLighting: false,
		camera: { position: [0, 1.7, 0], lookAt: [0, 1.5, -3] },
	},
	input: { canvasPointerEvents: true },
	features: {
		locomotion: { browserControls: true },
		physics: false,
		grabbing: false,
	},
});

world.registerSystem(GameSystem);
const gameSystem = world.getSystem(GameSystem)!;
gameSystem.initGame(world);
