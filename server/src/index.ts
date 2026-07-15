import { createServer } from 'node:http';
import { connectDB } from './config/db.js';
import { env } from './config/env.js';
import { createApp } from './app.js';
import { initRealtime } from './realtime/io.js';

async function main() {
  await connectDB();
  const app = createApp();
  const server = createServer(app);
  initRealtime(server);
  server.listen(env.port, () => {
    console.log(`[server] listening on http://localhost:${env.port}`);
  });
}

main().catch((err) => {
  console.error('[server] fatal startup error:', err);
  process.exit(1);
});
