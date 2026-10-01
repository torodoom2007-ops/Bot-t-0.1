const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

// --- הגדרות ---
const PORT = process.env.PORT || 3000;
const TOKEN = process.env.BOT_TOKEN;
const SUPER_ADMIN_ID = process.env.SUPER_ADMIN_ID || "8017590244";

// --- שרת Express קטן עבור Render (כדי שRender לא יסגור את השרת) ---
const app = express();
app.use(express.json());

app.get('/', (req, res) => {
  res.send('🛡️ NodeX Shield Bot is Active and Running!');
});

app.listen(PORT, () => {
  console.log(`NodeX Shield web server running on port ${PORT}`);
});

// --- אתחול הבוט במצב Polling (הכי יציב ובלי קונפליקטים) ---
const bot = new TelegramBot(TOKEN, { polling: true });

// --- זיכרון פנימי ---
const userActivity = new Map(); // בדיקת הצפה (10 הודעות / 5 שניות)
const warnings = new Map();     // אזהרות
const spammersList = new Set(); // רשימת ספאמרים

// --- טקסטים מותאמים ---
const systemTexts = {
  welcome: "🛡️ **NodeX Shield** פועל בקבוצה זו.\n*NodeX | Smart Shield for Your Community.*",
  spamWarning: "⚠️ @{username}, נא לא להציף! אזהרה ({warnCount}/3).",
  spammerBanned: "🚫 @{username} הוגדר כספאמר ואוגר ברשימה השחורה."
};

// פונקציית השהייה (דימוי חשיבה)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// שליחת הודעה זמנית שנמחקת אוטומטית
async function sendAutoDeleteMessage(chatId, text, delayMs = 4000) {
  try {
    const msg = await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    setTimeout(async () => {
      try {
        await bot.deleteMessage(chatId, msg.message_id);
      } catch (e) {}
    }, delayMs);
  } catch (e) {}
}

// ניקוי טקסט מקישורים וקרדיטים
function cleanTextContent(text) {
  if (!text) return "";
  let cleaned = text.replace(/(https?:\/\/[^\s]+)|(www\.[^\s]+)|(t\.me\/[^\s]+)/gi, '[קישור הוסר]');
  cleaned = cleaned.replace(/@[a-zA-Z0-9_]+/g, '[יוזרניימ הוסר]');
  return cleaned;
}

// בדיקה אם ההודעה מכילה קישורים או מוזכרים
function containsForbiddenLinks(msg) {
  if (msg.entities || msg.caption_entities) {
    const entities = msg.entities || msg.caption_entities;
    if (entities.some(e => ['url', 'text_link', 'mention'].includes(e.type))) return true;
  }
  const rawText = msg.text || msg.caption || "";
  return /(https?:\/\/|www\.|t\.me\/|@[a-zA-Z0-9_]+)/i.test(rawText);
}

// ניהול ניקוי ופרסום מחדש
async function handleLinkCleaning(msg) {
  if (!containsForbiddenLinks(msg)) return false;

  const chatId = msg.chat.id;
  const rawText = msg.text || msg.caption || "";
  const cleanedText = cleanTextContent(rawText);
  const sender = msg.from.first_name || "משתמש";

  try {
    await bot.deleteMessage(chatId, msg.message_id);
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

// ניהול הגנת הצפה (10 הודעות ב-5 שניות)
async function processSpamCheck(msg) {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const now = Date.now();

  if (!userActivity.has(userId)) userActivity.set(userId, []);
  const timestamps = userActivity.get(userId);
  timestamps.push(now);

  const recent = timestamps.filter(t => now - t <= 5000);
  userActivity.set(userId, recent);

  if (recent.length > 10) {
    userActivity.set(userId, []);
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
      await sendAutoDeleteMessage(chatId, text, 7000);
    } else {
      const text = systemTexts.spamWarning
        .replace('{username}', username)
        .replace('{warnCount}', currentWarns);
      await sendAutoDeleteMessage(chatId, text, 5000);
    }
    return true;
  }
  return false;
}

// ייצוא רשימת ספאמרים
function exportSpammers() {
  const list = Array.from(spammersList).map(item => JSON.parse(item));
  if (list.length === 0) return "📋 **רשימת הספאמרים ריקה.**";

  let report = "🚨 **NodeX Shield - רשימת ספאמרים:**\n\n";
  list.forEach((s, idx) => {
    report += `${idx + 1}. ID: \`${s.id}\` | Username: @${s.username} | Name: ${s.name}\n`;
  });
  return report;
}

// כפתור עריכה בלעדי ל-Super Admin
function getAdminKeyboard(userId, textKey) {
  if (String(userId) !== String(SUPER_ADMIN_ID)) return null;
  return {
    inline_keyboard: [
      [{ text: "✏️ ערוך טקסט זה (NodeX Admin)", callback_data: `edit_${textKey}` }]
    ]
  };
}

// --- מאזין להודעות נכנסות ---
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

  // פקודת ייצוא ספאמרים (רק ל-ID של המנהל)
  if (text === '/spammers' && String(userId) === String(SUPER_ADMIN_ID)) {
    const thinkingMsg = await bot.sendMessage(chatId, "⏳ *מייצר דוח ספאמרים...*", { parse_mode: 'Markdown' });
    await sleep(800);
    try { await bot.deleteMessage(chatId, thinkingMsg.message_id); } catch (e) {}

    const report = exportSpammers();
    return bot.sendMessage(chatId, report, { parse_mode: 'Markdown' });
  }

  // 1. הגנת ספאם
  const isSpam = await processSpamCheck(msg);
  if (isSpam) return;

  // 2. ניקוי קישורים
  await handleLinkCleaning(msg);
});

// לחיצות אינליין לאדמין
bot.on('callback_query', async (query) => {
  const userId = query.from.id;
  if (String(userId) !== String(SUPER_ADMIN_ID)) {
    return bot.answerCallbackQuery(query.id, { text: "אין הרשאה", show_alert: true });
  }

  if (query.data.startsWith('edit_')) {
    const key = query.data.replace('edit_', '');
    await bot.sendMessage(
      query.message.chat.id,
      `✍️ **עריכת טקסט (${key}):**\nהטקסט כעת:\n"${systemTexts[key]}"`,
      { parse_mode: 'Markdown' }
    );
    bot.answerCallbackQuery(query.id);
  }
});

console.log('NodeX Shield script loaded successfully.');
