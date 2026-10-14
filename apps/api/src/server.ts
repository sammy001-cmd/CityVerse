import Fastify from 'fastify';
import cors from '@fastify/cors';
import 'dotenv/config';

const app = Fastify({
  logger: true
});

await app.register(cors, {
  origin: true
});

app.get('/health', async () => ({
  service: 'cityverse-api',
  status: 'ok',
  version: '0.1.0',
  time: new Date().toISOString()
}));

app.get('/api/v1', async () => ({
  name: 'CityVerse API',
  version: 'v1'
}));

const port = Number(process.env.PORT ?? 4000);

try {
  await app.listen({
    port,
    host: '0.0.0.0'
  });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
