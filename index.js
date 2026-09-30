const express = require('express');
const helmet = require('helmet');
const config = require('./config/env');
const log = require('./utils/logger');
const { pool } = require('./db/pool');
const { bot } = require('./bot');
const routes = require('./routes');
const errorHandler = require('./middleware/errorHandler');
const scheduler = require('./services/scheduler');

const WEBHOOK_PATH = '/webhooks/telegram';
const app = express();
app.set('trust proxy', 1); // Render יושב מאחורי proxy
app.use(helmet());

// Webhook של טלגרם (מאומת ע"י secret token) חייב להיות לפני express.json
if (config.publicUrl) app.use(bot.webhookCallback(WEBHOOK_PATH, { secretToken: config.webhookSecret }));

app.use(express.json({ limit: '1mb' }));
app.use(routes);
app.use((_req, res) => res.status(404).json({ error: 'not_found' }));
app.use(errorHandler);

const server = app.listen(config.port, async () => {
  log.info(`server listening on ${config.port}`);
  if (config.publicUrl) {
    await bot.telegram.setWebhook(`${config.publicUrl}${WEBHOOK_PATH}`, {
      secret_token: config.webhookSecret,
      allowed_updates: ['message', 'callback_query', 'channel_post', 'my_chat_member'],
      drop_pending_updates: false,
    });
    log.info('telegram webhook set');
  } else {
    await bot.telegram.deleteWebhook();
    bot.launch({ allowedUpdates: ['message', 'callback_query', 'channel_post', 'my_chat_member'] });
    log.info('telegram polling started (dev mode)');
  }
  scheduler.start();
});

async function shutdown(sig) {
  log.info(`${sig} received, shutting down`);
  server.close();
  try { bot.stop(sig); } catch {}
  await pool.end().catch(() => {});
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (e) => log.error('unhandledRejection', e));
