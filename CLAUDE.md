# Horror Kindergarten Game (Покинутий Садок)

## Project Overview
Browser-based 3D first-person horror game built with Three.js + TypeScript + Vite.
Set in an abandoned Ukrainian kindergarten. Player must find a key, unlock a door, and escape while being hunted by a monster.

## Tech Stack
- **Three.js** (^0.170) — 3D rendering, post-processing (EffectComposer)
- **TypeScript** (strict mode) — all source in `src/`
- **Vite** — dev server (`npm run dev`) and build (`npm run build`)
- **No frameworks** — vanilla DOM for UI (Hud.ts)
- **Procedural audio** — Web Audio API, no audio files needed
- **3D models** — Kenney CC0 packs (GLB format via GLTFLoader)

## Commands
- `npm run dev` — start dev server at localhost:5173
- `npm run build` — production build to `dist/`
- `npm run preview` — preview production build
- `./deploy.sh` — deploy to Hetzner VPS via rsync

## Architecture

### Source Structure
```
src/
  main.ts                    — entry point, creates Game
  styles.css                 — all CSS (HUD, joystick, watch UI)
  game/
    Game.ts                  — main game loop, state machine, wires all systems
    systems/
      PlayerController.ts    — first-person movement, sphere-AABB collision
      EnemyController.ts     — AI: patrol → chase → search state machine
      InputSystem.ts         — touch joystick, keyboard, mouse drag, gamepad
      WatchSystem.ts         — flashlight (SpotLight), proximity beeps, nav hints
    audio/
      AudioSystem.ts         — procedural: ambience, footsteps, breathing, music, SFX
    level/
      loadLevel.ts           — procedural kindergarten level (walls, rooms, props)
      modelLoader.ts         — async GLB loader for furniture + monster models
      kitbashKenney.ts       — alternative level using Kenney Building Kit GLBs
    ui/
      Hud.ts                 — menu panels, game-over, win screen, key indicator
```

### Game States
`MainMenu → Playing → GameOver/Win → MainMenu`

### Enemy AI States
`patrol → chase → search → patrol`
- **patrol**: walks between room waypoints (patrolPoints from loadLevel)
- **chase**: triggered by line-of-sight (10 units) or hearing (6 units)
- **search**: goes to last known player position, wanders, then returns to patrol

### Collision System
- Sphere-vs-AABB (axis-aligned bounding boxes)
- Player sphere radius: 0.35, enemy: 0.38
- Obstacles stored as `{ min: Vector3, max: Vector3 }` array
- Iterative pushout resolution (up to 4 iterations per frame)

### 3D Assets (public/assets/)
- `kenney_building-kit/` — modular walls, floors, doors (CC0)
- `kenney_furniture-kit/` — chairs, tables, beds, bookcases (CC0)
- `kenney_graveyard-kit/` — ghost, skeleton, zombie, candles, debris (CC0)
- Only GLB files are committed; FBX/OBJ excluded via .gitignore

## Key Conventions
- UI text is in Ukrainian
- All audio is procedurally generated (Web Audio API) — no .mp3/.ogg files
- Materials use procedural canvas textures (makeWallTexture, makeFloorTexture, etc.)
- Level geometry is fully procedural — loadLevel creates all boxes/meshes in code
- GLB models are loaded async after game start (non-blocking, with fallback to procedural)

## Known Issues / Tech Debt
- Event listeners on window (InputSystem) never removed on dispose
- RAF loop runs even on main menu (wastes mobile battery)
- No pointer lock for desktop mouse look
