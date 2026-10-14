import 'dotenv/config';
import type { Request, Response } from 'express';
import { defineRoom, defineServer } from 'colyseus';
import { WorldRoom } from './rooms/WorldRoom.js';

const port = Number(process.env.PORT ?? 2567);

const server = defineServer({
  devMode: process.env.NODE_ENV !== 'production',
  rooms: {
    world: defineRoom(WorldRoom)
  },
  express: (app) => {
    app.get('/health', (_req: Request, res: Response) => {
      res.json({
        service: 'cityverse-game-server',
        status: 'ok',
        room: 'world',
        time: new Date().toISOString()
      });
    });
  }
});

await server.listen(port);

console.log(`CityVerse game server running on port ${port}`);
