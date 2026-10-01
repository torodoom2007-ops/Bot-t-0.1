import express from 'express';
import fetch from 'node-fetch';
import { parseStringPromise } from 'xml2js';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// פונקציית עזר לשליחת הודעות ב-Telegram API
async function sendMessage(chatId, text, replyMarkup = null) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: 'HTML'
  };
  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  }

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    console.error('Error sending message:', err);
  }
}

// -------------------------------------------------------------
// 10 פונקציות השירותים (Services)
// -------------------------------------------------------------

// 1. פרטי משתמש
function getUserInfo(from) {
  return `👤 <b>פרטי המשתמש שלך:</b>\n\n` +
         `▪ <b>ID:</b> <code>${from.id}</code>\n` +
         `▪ <b>שם:</b> ${from.first_name || ''} ${from.last_name || ''}\n` +
         `▪ <b>שם משתמש:</b> @${from.username || 'אין'}\n` +
         `▪ <b>שפה:</b> ${from.language_code || 'לא ידוע'}`;
}

// 2. מחולל סיסמאות
function generatePassword(length = 12) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()';
  let pass = '';
  for (let i = 0; i < length; i++) {
    pass += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `🔐 <b>הסיסמה החזקה שלך:</b>\n<code>${pass}</code>`;
}

// 3. יצירת קוד QR
function getQRCodeUrl(text) {
  const encoded = encodeURIComponent(text);
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encoded}`;
  return `🖼 <b>הנה קוד ה-QR שלך:</b>\n\n${qrUrl}`;
}

// 4. חדשות סייבר (RSS: BleepingComputer)
async function getCyberNews() {
  try {
    const res = await fetch('https://www.bleepingcomputer.com/feed/');
    const xml = await res.text();
    const result = await parseStringPromise(xml);
    const items = result.rss.channel[0].item.slice(0, 3);

    let msg = `🛡 <b>מבזקי סייבר אחרונים (BleepingComputer):</b>\n\n`;
    items.forEach((item, i) => {
      msg += `${i + 1}. <a href="${item.link[0]}">${item.title[0]}</a>\n\n`;
    });
    return msg;
  } catch (e) {
    return '⚠️ שגיאה בשליפת חדשות הסייבר.';
  }
}

// 5. חדשות כלליות (RSS: BBC World)
async function getGeneralNews() {
  try {
    const res = await fetch('http://feeds.bbci.co.uk/news/world/rss.xml');
    const xml = await res.text();
    const result = await parseStringPromise(xml);
    const items = result.rss.channel[0].item.slice(0, 3);

    let msg = `🌐 <b>חדשות עולמיות אחרונות (BBC):</b>\n\n`;
    items.forEach((item, i) => {
      msg += `${i + 1}. <a href="${item.link[0]}">${item.title[0]}</a>\n\n`;
    });
    return msg;
  } catch (e) {
    return '⚠️ שגיאה בשליפת החדשות הכלליות.';
  }
}

// 6. קיצור קישורים (TinyURL)
async function shortenUrl(longUrl) {
  try {
    const res = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(longUrl)}`);
    const short = await res.text();
    return `🔗 <b>הקישור המקוצר שלך:</b>\n${short}`;
  } catch (e) {
    return '⚠️ שגיאה בקיצור הקישור. ודא שהזנת כתובת תקינה.';
  }
}

// 7. שערי קריפטו בלייב (CoinGecko API)
async function getCryptoPrice() {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd');
    const data = await res.json();
    return `🪙 <b>מחירי קריפטו בלייב (USD):</b>\n\n` +
           `▪ <b>Bitcoin (BTC):</b> $${data.bitcoin.usd}\n` +
           `▪ <b>Ethereum (ETH):</b> $${data.ethereum.usd}`;
  } catch (e) {
    return '⚠️ שגיאה בשליפת שערי הקריפטו.';
  }
}

// 8. שעה וזמן שרת
function getServerTime() {
  const now = new Date();
  return `⏰ <b>זמן שרת נוכחי:</b>\n<code>${now.toUTCString()}</code>`;
}

// 9. תזכורת בדיליי (10 שניות בדיקה)
function setReminder(chatId, text) {
  setTimeout(() => {
    sendMessage(chatId, `🔔 <b>תזכורת!</b>\n${text}`);
  }, 10000); // 10 שניות
  return '⏳ התזכורת הוגדרה! אשלח לך הודעה בעוד 10 שניות...';
}

// 10. ניתוח טקסט
function analyzeText(text) {
  const charCount = text.length;
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  const readTime = Math.ceil(wordCount / 200);

  return `📊 <b>ניתוח הטקסט שלך:</b>\n\n` +
         `▪ <b>מספר תווים:</b> ${charCount}\n` +
         `▪ <b>מספר מילים:</b> ${wordCount}\n` +
         `▪ <b>זמן קריאה משוער:</b> כ-${readTime} דקות/שניות`;
}

// -------------------------------------------------------------
// תפריט ראשי (Main Keyboard)
// -------------------------------------------------------------
function getMainMenu() {
  return {
    inline_keyboard: [
      [
        { text: '👤 הפרטים שלי', callback_data: 'service_user' },
        { text: '🔐 מחולל סיסמה', callback_data: 'service_pass' }
      ],
      [
        { text: '🛡 חדשות סייבר', callback_data: 'service_cyber' },
        { text: '🌐 חדשות BBC', callback_data: 'service_news' }
      ],
      [
        { text: '🪙 מחירי קריפטו', callback_data: 'service_crypto' },
        { text: '⏰ שעת שרת', callback_data: 'service_time' }
      ],
      [
        { text: '❓ איך מקצרים קישור / מייצרים QR?', callback_data: 'service_help' }
      ]
    ]
  };
}

// -------------------------------------------------------------
// נתיב ה-Webhook של Express
// -------------------------------------------------------------

// בדיקת תקינות מול Render (Health Check)
app.get('/', (req, res) => {
  res.send('Telegram Multi-Tool Bot is Live on Render!');
});

app.post('/webhook', async (req, res) => {
  try {
    const update = req.body;

    // 1. טיפול בלחיצות על כפתורים (Callback Queries)
    if (update.callback_query) {
      const chatId = update.callback_query.message.chat.id;
      const data = update.callback_query.data;
      const from = update.callback_query.from;

      if (data === 'service_user') await sendMessage(chatId, getUserInfo(from));
      if (data === 'service_pass') await sendMessage(chatId, generatePassword(16));
      if (data === 'service_cyber') await sendMessage(chatId, await getCyberNews());
      if (data === 'service_news') await sendMessage(chatId, await getGeneralNews());
      if (data === 'service_crypto') await sendMessage(chatId, await getCryptoPrice());
      if (data === 'service_time') await sendMessage(chatId, getServerTime());
      if (data === 'service_help') {
        const helpText = `💡 <b>איך להשתמש בפקודות הישירות:</b>\n\n` +
                         `▪ <b>קוד QR:</b> שלח <code>/qr https://example.com</code>\n` +
                         `▪ <b>קיצור קישור:</b> שלח <code>/short https://example.com</code>\n` +
                         `▪ <b>תזכורת (10 שנ'):</b> שלח <code>/remind לקנות חלב</code>\n` +
                         `▪ <b>ניתוח טקסט:</b> שלח <code>/analyze הטקסט שלך כאן</code>`;
        await sendMessage(chatId, helpText);
      }
    }

    // 2. טיפול בהודעות טקסט נכנסות
    if (update.message && update.message.text) {
      const chatId = update.message.chat.id;
      const text = update.message.text;

      if (text === '/start') {
        await sendMessage(chatId, '🚀 <b>ברוכים הבאים לבוט הכל-בו!</b>\nבחר שירות מהתפריט:', getMainMenu());
      } else if (text.startsWith('/qr ')) {
        const input = text.replace('/qr ', '');
        await sendMessage(chatId, getQRCodeUrl(input));
      } else if (text.startsWith('/short ')) {
        const input = text.replace('/short ', '');
        await sendMessage(chatId, await shortenUrl(input));
      } else if (text.startsWith('/remind ')) {
        const input = text.replace('/remind ', '');
        await sendMessage(chatId, setReminder(chatId, input));
      } else if (text.startsWith('/analyze ')) {
        const input = text.replace('/analyze ', '');
        await sendMessage(chatId, analyzeText(input));
      }
    }

    res.sendStatus(200);
  } catch (err) {
    console.error('Webhook Error:', err);
    res.sendStatus(500);
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
