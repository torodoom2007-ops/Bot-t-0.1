require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(express.json());

// --- הגדרות משתנים ---
const PORT = process.env.PORT || 3000;
const TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const SUPER_ADMIN_ID = process.env.SUPER_ADMIN_ID || "8017590244";

// --- שמירת נתונים בזיכרון (In-Memory Storage) ---
const userActivity = new Map(); // זיהוי הצפה (userId -> timestamps)
const warnings = new Map();     // מעקב אזהרות (userId -> count)
const spammersList = new Set(); // רשימה שחורה של ספאמרים

// --- טקסטים של המערכת (ניתנים לעריכה בזמן אמת על ידי ה-Super Admin) ---
const systemTexts = {
  welcome: "🛡️ **NodeX Shield** פועל בקבוצה זו.\n*ההגנה החכמה לקהילה שלך.*",
  spamWarning: "⚠️ @{username}, נא לא להציף! אזהרה ({warnCount}/3).",
  spammerBanned: "🚫 @{username} הוגדר כספאמר ואוגר ברשימה השחורה של NodeX."
};

// --- אתחול הבוט (תמיכה ב-Polling לפיתוח ו-Webhook ל-Render) ---
let bot;
if (process.env.NODE_ENV === 'production' && WEBHOOK_URL) {
  bot = new TelegramBot(TOKEN);
  bot.setWebHook(`${WEBHOOK_URL}/bot${TOKEN}`);
} else {
  bot = new TelegramBot(TOKEN, { polling: true });
}

// ==========================================
// 🛠️ פונקציות עזר (UI & Process Simulation)
// ==========================================

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// הדמיית "הליך חשיבה" באמצעות עריכת הודעה
async function showThinkingProcess(chatId, initialText, steps, delayMs = 500) {
  const msg = await bot.sendMessage(chatId, `⏳ ${initialText}`, { parse_mode: 'Markdown' });
  for (const step of steps) {
    await sleep(delayMs);
    try {
      await bot.editMessageText(`⚡ ${step}`, { chat_id: chatId, message_id: msg.message_id, parse_mode: 'Markdown' });
    } catch (e) {}
  }
  await sleep(delayMs);
  return msg;
}

// שליחת הודעה זמנית שנמחקת אוטומטית
async function sendAutoDeleteMessage(chatId, text, options = {}, delayMs = 4000) {
  try {
    const msg = await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', ...options });
    setTimeout(async () => {
      try {
        await bot.deleteMessage(chatId, msg.message_id);
      } catch (e) {}
    }, delayMs);
  } catch (e) {}
}

// ==========================================
// 🧹 מנוע ניקוי קישורים וקרדיטים
// ==========================================

function cleanTextContent(text) {
  if (!text) return "";
  // ניקוי כתובות URL
  let cleaned = text.replace(/(https?:\/\/[^\s]+)|(www\.[^\s]+)|(t\.me\/[^\s]+)/gi, '[קישור הוסר]');
  // ניקוי אזכורי Username (@)
  cleaned = cleaned.replace(/@[a-zA-Z0-9_]+/g, '[יוזרניימ הוסר]');
  return cleaned;
}

function containsForbiddenLinks(msg) {
  if (msg.entities || msg.caption_entities) {
    const entities = msg.entities || msg.caption_entities;
    if (entities.some(e => ['url', 'text_link', 'mention'].includes(e.type))) return true;
  }
  const rawText = msg.text || msg.caption || "";
  return /(https?:\/\/|www\.|t\.me\/|@[a-zA-Z0-9_]+)/i.test(rawText);
}

async function handleLinkCleaning(msg) {
  if (!containsForbiddenLinks(msg)) return false;

  const chatId = msg.chat.id;
  const rawText = msg.text || msg.caption || "";
  const cleanedText = cleanTextContent(rawText);
  const sender = msg.from.first_name || "משתמש";

  try {
    // מחיקת ההודעה המקורית המכילה קישור/קרדיט
    await bot.deleteMessage(chatId, msg.message_id);

    // פרסום מחדש של הטקסט הנקי
    if (cleanedText.trim().length > 0) {
      await bot.sendMessage(
        chatId,
        `👤 **${sender}**:\n${cleanedText}\n\n_🛡️ NodeX Cleaned_`,
        { parse_mode: 'Markdown' }
      );
    }
    return true;
  } catch (err) {
    console.error("שגיאה בניקוי הודעה:", err.message);
    return false;
  }
}

// ==========================================
// 🚨 מנוע הגנת ספאם (Rate Limit)
// ==========================================

async function processSpamCheck(msg) {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const now = Date.now();

  if (!userActivity.has(userId)) userActivity.set(userId, []);
  const timestamps = userActivity.get(userId);
  timestamps.push(now);

  // סינון הודעות מ-5 השניות האחרונות בלבד
  const recent = timestamps.filter(t => now - t <= 5000);
  userActivity.set(userId, recent);

  // בדיקת חריגה מ-10 הודעות ב-5 שניות
  if (recent.length > 10) {
    userActivity.set(userId, []); // איפוס
    const currentWarns = (warnings.get(userId) || 0) + 1;
    warnings.set(userId, currentWarns);

    const username = msg.from.username || msg.from.first_name;

    if (currentWarns >= 3) {
      spammersList.add(JSON.stringify({
        id: userId,
        username: msg.from.username || "N/A",
        name: msg.from.first_name,
        date: new Date().toISOString()
      }));

      const text = systemTexts.spammerBanned.replace('{username}', username);
      await sendAutoDeleteMessage(chatId, text, {}, 7000);
    } else {
      const text = systemTexts.spamWarning
        .replace('{username}', username)
        .replace('{warnCount}', currentWarns);
      await sendAutoDeleteMessage(chatId, text, {}, 5000);
    }
    return true;
  }
  return false;
}

// ייצוא רשימת ספאמרים מסודרת
function exportSpammers() {
  const list = Array.from(spammersList).map(item => JSON.parse(item));
  if (list.length === 0) return "📋 **רשימת הספאמרים ריקה.**";

  let report = "🚨 **NodeX Shield - רשימת ספאמרים שחורה:**\n\n";
  list.forEach((s, idx) => {
    report += `${idx + 1}. ID: \`${s.id}\` | Username: @${s.username} | Name: ${s.name}\n`;
  });
  return report;
}

// ==========================================
// ⚙️ ממשק ניהול ועריכה ל-SUPER_ADMIN_ID
// ==========================================

function getAdminKeyboard(userId, textKey) {
  if (String(userId) !== String(SUPER_ADMIN_ID)) return null;
  return {
    inline_keyboard: [
      [{ text: "✏️ ערוך טקסט זה (NodeX Master)", callback_data: `edit_text_${textKey}` }]
    ]
  };
}

// ==========================================
// 🤖 אירועי בוט ו-Handlers
// ==========================================

bot.on('message', async (msg) => {
  if (!msg.chat) return;

  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text || "";

  // פקודת התחלה
  if (text === '/start') {
    const keyboard = getAdminKeyboard(userId, 'welcome');
    return bot.sendMessage(chatId, systemTexts.welcome, {
      parse_mode: 'Markdown',
      reply_markup: keyboard || undefined
    });
  }

  // פקודת ייצוא ספאמרים (רק ל-SUPER_ADMIN)
  if (text === '/spammers' && String(userId) === String(SUPER_ADMIN_ID)) {
    const thinkingMsg = await showThinkingProcess(chatId, "מעבד נתונים...", ["שולף רשימה...", "מייצר פלט מסודר..."]);
    await bot.deleteMessage(chatId, thinkingMsg.message_id);

    const report = exportSpammers();
    return bot.sendMessage(chatId, report, { parse_mode: 'Markdown' });
  }

  // 1. בדיקת ספאם (הצפה)
  const isSpam = await processSpamCheck(msg);
  if (isSpam) return;

  // 2. ניקוי קישורים ופרסום מחדש
  await handleLinkCleaning(msg);
});

// טיפול בלחיצות על כפתורי עריכה ל-Admin
bot.on('callback_query', async (query) => {
  const userId = query.from.id;
  if (String(userId) !== String(SUPER_ADMIN_ID)) {
    return bot.answerCallbackQuery(query.id, { text: "אין לך הרשאה לבצע פעולה זו.", show_alert: true });
  }

  if (query.data.startsWith('edit_text_')) {
    const key = query.data.replace('edit_text_', '');
    await bot.sendMessage(
      query.message.chat.id,
      `✍️ כדי לערוך את המשתנה \`${key}\`, עדכן אותו ישירות בקוד או הגדר אותו במשתני הסביבה.\n\nטקסט נוכחי:\n"${systemTexts[key]}"`,
      { parse_mode: 'Markdown' }
    );
    bot.answerCallbackQuery(query.id);
  }
});

// ==========================================
// 🌐 Express Webhook & Server Setup
// ==========================================

app.post(`/bot${TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.get('/', (req, res) => {
  res.send('NodeX Shield Bot is online and running!');
});

app.listen(PORT, () => {
  console.log(`NodeX Shield Server running on port ${PORT}`);
});
