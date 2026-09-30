const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

// טעינת משתני סביבה (ב-Render נגדיר אותם בממשק)
const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;

if (!BOT_TOKEN) {
  console.error("ERROR: BOT_TOKEN is missing!");
  process.exit(1);
}

// יצירת מופע הבוט (ללא polling מכיוון שנעבוד עם Webhook ב-Render)
const bot = new TelegramBot(BOT_TOKEN);
const app = express();

app.use(express.json());

// 1. טיפול בפקודת /start
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const firstName = msg.from.first_name || 'חבר';

  const welcomeMessage = `שלום ${firstName}! 👋\nברוך הבא לבוט החדש שלנו.\n\nאיך אני יכול לעזור לך היום?`;

  await bot.sendMessage(chatId, welcomeMessage, {
    parse_mode: 'Markdown'
  });
});

// 2. נקודת קצה לקבלת עדכונים מטלגרם (Webhook Endpoint)
app.post(`/bot${BOT_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// 3. Health Check להגדרות Render
app.get('/', (req, res) => {
  res.send('Bot status: ACTIVE');
});

// 4. הרמת השרת והגדרת ה-Webhook בטלגרם
app.listen(PORT, async () => {
  console.log(`Server is running on port ${PORT}`);

  if (RENDER_EXTERNAL_URL) {
    const webhookUrl = `${RENDER_EXTERNAL_URL}/bot${BOT_TOKEN}`;
    try {
      await bot.setWebHook(webhookUrl);
      console.log(`Webhook set successfully to: ${webhookUrl}`);
    } catch (error) {
      console.error('Failed to set Webhook:', error);
    }
  } else {
    console.log('RENDER_EXTERNAL_URL not set (Local environment detected)');
  }
});
