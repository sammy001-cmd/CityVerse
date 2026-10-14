# Client main.js migration plan

Migrate the responsibilities in `apps/client/src/main.js` incrementally. Keep the
current entry point working while extracting one cohesive system at a time; do
not replace the working city boot with a large rewrite.

Planned modules:

- `core/Game.js` coordinates initialization and the game loop.
- `rendering/Renderer.js` owns renderer, scene, camera, and render setup.
- `core/InputManager.js` owns keyboard and pointer input.
- `world/WorldManager.js` coordinates terrain, roads, and world content.
- `player/PlayerController.js` owns player movement and animation.
- `ui/DebugHUD.js` owns development status and diagnostics.

The eventual boot sequence should be:

```js
import { Game } from './core/Game.js';

const game = new Game();

await game.init();

game.start();
```
