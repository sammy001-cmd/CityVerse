import { Client, Room } from 'colyseus';

export class WorldRoom extends Room {
  maxClients = 64;

  onCreate() {
    console.log('CityVerse world room created:', this.roomId);

    this.setMetadata({
      city: 'ibadan',
      shard: 'development'
    });

    this.onMessage('ping', (client, message) => {
      client.send('pong', {
        sent: message?.sent ?? null,
        serverTime: Date.now()
      });
    });
  }

  onJoin(client: Client, options: unknown) {
    console.log('Player joined:', client.sessionId, options);

    this.broadcast('player:joined', {
      sessionId: client.sessionId
    });
  }

  onLeave(client: Client) {
    console.log('Player left:', client.sessionId);

    this.broadcast('player:left', {
      sessionId: client.sessionId
    });
  }
}
