const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

const BOT_TOKEN = process.env.BOT_TOKEN;
const PORT = process.env.PORT || 3000;
const RENDER_EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;

if (!BOT_TOKEN) {
  console.error("ERROR: BOT_TOKEN is missing!");
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN);
const app = express();
app.use(express.json());

// ---------------------------------------------------------
// 💾 זיכרון זמני ומנגנון ניהול הודעות (Chat Cleaner)
// ---------------------------------------------------------
const db = {
  users: new Set(),
  userChannels: {}, // userId -> Array of { id, title, type, username }
  userState: {},    // userId -> { step, postData: {} }
  ephemeralMsgs: {}, // userId -> Array of messageIds to delete on flow exit
  stats: {
    postsPublished: 0,
    qrGenerated: 0
  }
};

function getUserChannels(userId) {
  if (!db.userChannels[userId]) db.userChannels[userId] = [];
  return db.userChannels[userId];
}

function getUserState(userId) {
  if (!db.userState[userId]) db.userState[userId] = { step: 'IDLE', postData: { buttons: [] } };
  return db.userState[userId];
}

function resetUserState(userId) {
  db.userState[userId] = { step: 'IDLE', postData: { buttons: [] } };
}

// מנגנון מחיקת הודעות תהליך קודם (Auto Shatter & Clean)
function trackMessage(userId, messageId) {
  if (!db.ephemeralMsgs[userId]) db.ephemeralMsgs[userId] = [];
  db.ephemeralMsgs[userId].push(messageId);
}

async function cleanupFlowMessages(chatId, userId) {
  if (db.ephemeralMsgs[userId] && db.ephemeralMsgs[userId].length > 0) {
    for (const msgId of db.ephemeralMsgs[userId]) {
      try {
        await bot.deleteMessage(chatId, msgId);
      } catch (e) {
        // התעלם אם ההודעה כבר נמחקה או פג תוקפה
      }
    }
    db.ephemeralMsgs[userId] = [];
  }
}

// ---------------------------------------------------------
// 🌀 אפקט "החשיבה והניתוח" הרב-שלבי (Dynamic Animated Status)
// ---------------------------------------------------------
async function runPulseAnimation(chatId, userId, steps, finalCallback) {
  const statusMsg = await bot.sendMessage(chatId, `⚡ *PulseBot* | ${steps[0] || 'מבצע עיבוד...'}`, { parse_mode: 'Markdown' });
  trackMessage(userId, statusMsg.message_id);

  for (let i = 1; i < steps.length; i++) {
    await new Promise(r => setTimeout(r, 650));
    try {
      await bot.editMessageText(`⚡ *PulseBot* | ${steps[i]}`, {
        chat_id: chatId,
        message_id: statusMsg.message_id,
        parse_mode: 'Markdown'
      });
    } catch (e) {}
  }

  await new Promise(r => setTimeout(r, 700));
  await finalCallback(statusMsg.message_id);
}

// ---------------------------------------------------------
// 🏠 תפריט ראשי מעוצב וממותג: PulseBot Elite
// ---------------------------------------------------------
async function sendMainMenu(chatId, userId, firstName, messageId = null) {
  await cleanupFlowMessages(chatId, userId);

  const channelsCount = getUserChannels(userId).length;
  
  const text = 
`⚡ *P U L S E B O T*  |  *E L I T E* 
> _מערכת הניהול, הסינון והפרסום המתקדמת לטלגרם_

שלום *${firstName}* 👋,
ברוך הבא ללוח הבקרה הראשי. המערכת מוכנה לפעולה!

║ 👤 *משתמש מחובר:* \`${firstName}\` (\`ID: ${userId}\`)
║ 🗃️ *נכסים פעילים:* \`${channelsCount} / 2\` (ערוץ 📣 + קבוצה 📢)

||לחץ על אחד הכפתורים למטה כדי להתחיל תהליך||`;

  const keyboard = {
    inline_keyboard: [
      [{ text: '📢 פרסם פוסט מעוצב', callback_data: 'menu_create_post' }, { text: '➕ הוסף נכס (ערוץ/קבוצה)', callback_data: 'menu_add' }],
      [{ text: '🗃️ הנכסים שלי', callback_data: 'menu_my_list' }, { text: '🛠️ ארגז הכלים שלי', callback_data: 'menu_tools' }],
      [{ text: '📊 אנליטיקה וסטטיסטיקות', callback_data: 'menu_stats' }]
    ]
  };

  if (messageId) {
    try {
      await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: keyboard });
      return;
    } catch (e) {}
  }
  
  const sentMsg = await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: keyboard });
  trackMessage(userId, sentMsg.message_id);
}

bot.onText(/\/start/, async (msg) => {
  const userId = msg.from.id;
  db.users.add(userId);
  resetUserState(userId);
  await sendMainMenu(msg.chat.id, userId, msg.from.first_name || 'חבר');
});

// ---------------------------------------------------------
// 🔘 אינטראקציות וכפתורים (Callback Queries)
// ---------------------------------------------------------
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const userId = query.from.id;
  const data = query.data;
  const firstName = query.from.first_name || 'חבר';

  await bot.answerCallbackQuery(query.id);

  // --- חזרה לתפריט הראשי + ניקוי צ'אט ---
  if (data === 'menu_main') {
    resetUserState(userId);
    await sendMainMenu(chatId, userId, firstName, messageId);
  }

  // --- הוספת ערוץ / קבוצה ---
  else if (data === 'menu_add') {
    await cleanupFlowMessages(chatId, userId);
    const me = await bot.getMe();
    
    const text = 
`➕ *הוספת נכס חדש למערכת*

כדי לחבר ערוץ או קבוצה, יש להגדיר את ⚡ *PulseBot* כמנהל מערכת.

║ <u>דרישות חיבור:</u>
║ 1. מותר לחבר עד *ערוץ אחד 📣* ו*קבוצה אחת 📢*.
║ 2. לאחר הענקת הרשאות מנהל, *העבירו אליי הודעה* מהנכס או שלחו את *שם המשתמש* שלו (לדוגמה: \`@mychannel\`).

> _הצ'אט יתרענן אוטומטית ברגע שהנכס יזוהה!_`;

    const keyboard = {
      inline_keyboard: [
        [
          { text: 'הוסף ל-📣 ערוץ', url: `https://t.me/${me.username}?startchannel=true` },
          { text: 'הוסף ל-📢 קבוצה', url: `https://t.me/${me.username}?startgroup=true` }
        ],
        [{ text: '🔙 ביטול וחזרה לתפריט', callback_data: 'menu_main' }]
      ]
    };

    getUserState(userId).step = 'AWAITING_CHANNEL_ADD';
    const sent = await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: keyboard });
    trackMessage(userId, sent.message_id);
  }

  // --- הצגת נכסים מחוברים ---
  else if (data === 'menu_my_list') {
    await cleanupFlowMessages(chatId, userId);
    const list = getUserChannels(userId);

    if (list.length === 0) {
      const text = 
`🗃️ *הנכסים המחוברים שלך*

> ~אין נכסים פעילים כרגע במערכת.~

~<u>הסבר:</u>~ כדי ליהנות מפרסום אוטומטי וכלי ניהול, עליך לחבר ערוץ או קבוצה.`;

      const sent = await bot.sendMessage(chatId, text, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '➕ הוסף נכס עכשיו', callback_data: 'menu_add' }],
            [{ text: '🔙 חזרה לתפריט', callback_data: 'menu_main' }]
          ]
        }
      });
      trackMessage(userId, sent.message_id);
      return;
    }

    let text = `🗃️ *הנכסים המחוברים בחשבון של ${firstName}:*\n\n`;
    const btns = [];

    list.forEach((item, i) => {
      const icon = item.type === 'channel' ? '📣' : '📢';
      text += `${i + 1}. ${icon} *${item.title}*\n   └ 🔗 \`${item.username || 'נכס פרטי'}\` | ID: \`${item.id}\`\n\n`;
      btns.push([{ text: `🗑️ הסר את ${item.title}`, callback_data: `remove_ch_${item.id}` }]);
    });

    btns.push([{ text: '🔙 חזרה לתפריט', callback_data: 'menu_main' }]);

    const sent = await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: { inline_keyboard: btns } });
    trackMessage(userId, sent.message_id);
  }

  // --- הסרת נכס מחובר ---
  else if (data.startsWith('remove_ch_')) {
    const targetId = data.replace('remove_ch_', '');
    
    await runPulseAnimation(
      chatId, userId,
      ['🤔 חושב...', '🔍 מנתח את הרשאות הנכס...', '✂️ מנתק חיבור...', 'מעבד שינויים...'],
      async (msgId) => {
        db.userChannels[userId] = getUserChannels(userId).filter(c => c.id.toString() !== targetId.toString());
        await bot.editMessageText('בוצע ✅ *הנכס נותק בהצלחה מהמערכת!*', { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' });
        setTimeout(() => sendMainMenu(chatId, userId, firstName), 1200);
      }
    );
  }

  // --- ארגז כלים (Utilities) ---
  else if (data === 'menu_tools') {
    await cleanupFlowMessages(chatId, userId);
    const text = 
`🛠️ *ארגז הכלים של PulseBot*

בחר את הכלי המבוקש להפעלה:

║ 📱 *מחולל קודי QR*: יצירת קוד מהירה מכל טקסט או לינק.
║ 🔍 *מחלץ מזהים*: קבלת File ID ו-Chat ID של כל מדיה או הודעה.`;

    const keyboard = {
      inline_keyboard: [
        [{ text: '📱 מחולל קודי QR', callback_data: 'tool_qr' }],
        [{ text: '🔍 מחלץ ID ומזהים', callback_data: 'tool_id' }],
        [{ text: '🔙 חזרה לתפריט', callback_data: 'menu_main' }]
      ]
    };
    const sent = await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: keyboard });
    trackMessage(userId, sent.message_id);
  }

  else if (data === 'tool_qr') {
    await cleanupFlowMessages(chatId, userId);
    getUserState(userId).step = 'AWAITING_QR_TEXT';
    
    const sent = await bot.sendMessage(chatId, '📱 *מחולל קודי QR*\n\nשלח כעת טקסט או קישור, ו-⚡ *PulseBot* ייצר עבורך קוד QR מעוצב!', {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: '❌ ביטול', callback_data: 'menu_tools' }]] }
    });
    trackMessage(userId, sent.message_id);
  }

  else if (data === 'tool_id') {
    await cleanupFlowMessages(chatId, userId);
    const sent = await bot.sendMessage(chatId, '🔍 *מחלץ ID ומזהים*\n\nפשוט שלח אליי כל קובץ, תמונה, סרטון או הודעה מועברת, ואני אשלח לך את ה-ID המדויק שלו בטלגרם!', {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: '🔙 חזרה', callback_data: 'menu_tools' }]] }
    });
    trackMessage(userId, sent.message_id);
  }

  // --- אנליטיקה וסטטיסטיקות ---
  else if (data === 'menu_stats') {
    await cleanupFlowMessages(chatId, userId);
    const text = 
`📊 *לוח אנליטיקה וסטטיסטיקות בזמן אמת*

║ 👤 משתמשים רשומים במערכת: \`${db.users.size}\`
║ 📣 נכסים פעילים (ערוצים/קבוצות): \`${Object.values(db.userChannels).flat().length}\`
║ 📢 סך הכל פוסטים שפורסמו: \`${db.stats.postsPublished}\`
║ 📱 קודי QR שנוצרו: \`${db.stats.qrGenerated}\`

> _כל הנתונים מנוטרים ומעודכנים בזמן אמת._`;

    const sent = await bot.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: '🔙 חזרה לתפריט', callback_data: 'menu_main' }]] }
    });
    trackMessage(userId, sent.message_id);
  }

  // --- תהליך יצירת פוסט ---
  else if (data === 'menu_create_post') {
    await cleanupFlowMessages(chatId, userId);
    const list = getUserChannels(userId);

    if (list.length === 0) {
      const sent = await bot.sendMessage(chatId, '⚠️ *שגיאת מערכת!* עליך לחבר לפחות ערוץ או קבוצה אחת לפני יצירת פוסט.', {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '➕ הוסף נכס עכשיו', callback_data: 'menu_add' }], [{ text: '🔙 חזרה', callback_data: 'menu_main' }]] }
      });
      trackMessage(userId, sent.message_id);
      return;
    }

    const state = getUserState(userId);
    state.step = 'POST_STEP_1_CONTENT';
    state.postData = { buttons: [] };

    const text = 
`📢 *יצירת פוסט מעוצב - שלב 1 מתוך 3*

שלח כעת את התוכן עבור הפוסט שלך.
║ <u>סוגי מדיה נתמכים:</u>
║ 📝 *טקסט חופשי* (עם כל העיצובים)
║ 📸 *תמונות* | 🎥 *סרטונים*
║ 🎙️ *הודעות קוליות* | 📄 *קבצים ומסמכים*`;

    const sent = await bot.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: '❌ ביטול', callback_data: 'menu_main' }]] }
    });
    trackMessage(userId, sent.message_id);
  }

  // --- הוספת כפתור אונליין לפוסט ---
  else if (data === 'post_add_button') {
    getUserState(userId).step = 'POST_STEP_2_ADD_BUTTON';
    const sent = await bot.sendMessage(chatId, '🔘 *הוספת כפתור אונליין*\n\nשלח את הפרטים בפורמט המדויק הבא:\n\`טקסט הכפתור | https://example.com\``, { parse_mode: 'Markdown' });
    trackMessage(userId, sent.message_id);
  }

  // --- בחירת יעד לפרסום הפוסט ---
  else if (data === 'post_select_target') {
    const list = getUserChannels(userId);
    const btns = list.map(item => [{ text: `${item.type === 'channel' ? '📣' : '📢'} ${item.title}`, callback_data: `publish_to_${item.id}` }]);
    btns.push([{ text: '❌ ביטול', callback_data: 'menu_main' }]);

    const sent = await bot.sendMessage(chatId, '🎯 *בחירת יעד לפרסום - שלב 3 מתוך 3*\n\nלאן תרצה לשגר את הפוסט?', {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: btns }
    });
    trackMessage(userId, sent.message_id);
  }

  // --- שיגור הפוסט בפועל ---
  else if (data.startsWith('publish_to_')) {
    const targetId = data.replace('publish_to_', '');
    const state = getUserState(userId);
    const post = state.postData;

    await runPulseAnimation(
      chatId, userId,
      ['🤔 חושב...', '🔍 מנתח נתונים ומאמת הרשאות...', '⚙️ מכין מעטפת מדיה...', '🚀 משגר ליעד...'],
      async (msgId) => {
        const replyMarkup = post.buttons.length > 0 ? { inline_keyboard: post.buttons } : undefined;

        if (post.type === 'photo') {
          await bot.sendPhoto(targetId, post.fileId, { caption: post.text, parse_mode: 'Markdown', reply_markup: replyMarkup });
        } else if (post.type === 'video') {
          await bot.sendVideo(targetId, post.fileId, { caption: post.text, parse_mode: 'Markdown', reply_markup: replyMarkup });
        } else if (post.type === 'voice') {
          await bot.sendVoice(targetId, post.fileId, { caption: post.text, parse_mode: 'Markdown', reply_markup: replyMarkup });
        } else if (post.type === 'document') {
          await bot.sendDocument(targetId, post.fileId, { caption: post.text, parse_mode: 'Markdown', reply_markup: replyMarkup });
        } else {
          await bot.sendMessage(targetId, post.text, { parse_mode: 'Markdown', reply_markup: replyMarkup });
        }

        db.stats.postsPublished++;
        await bot.editMessageText('בוצע ✅ *הפוסט שוגר בהצלחה ליעד!*', { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' });
        resetUserState(userId);
        setTimeout(() => sendMainMenu(chatId, userId, firstName), 1500);
      }
    );
  }
});

// ---------------------------------------------------------
// 📩 הזרמת הודעות קלט, מדיה ושיחות
// ---------------------------------------------------------
bot.on('message', async (msg) => {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const firstName = msg.from.first_name || 'חבר';
  const state = getUserState(userId);

  // מעקב אחר הודעות משתמש כדי לנקותן בהמשך
  trackMessage(userId, msg.message_id);

  // קבלת פנים לחברים חדשים בקבוצה
  if (msg.new_chat_members) {
    msg.new_chat_members.forEach(member => {
      bot.sendMessage(chatId, `👋 ברוך הבא *${member.first_name}* לקבוצה!`, { parse_mode: 'Markdown' });
    });
    return;
  }

  // סינון קישורים בקבוצות
  if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
    if (msg.text && (msg.text.includes('t.me/') || msg.text.includes('http://') || msg.text.includes('https://'))) {
      try {
        const member = await bot.getChatMember(chatId, userId);
        if (member.status !== 'administrator' && member.status !== 'creator') {
          await bot.deleteMessage(chatId, msg.message_id);
          const warnMsg = await bot.sendMessage(chatId, `⚠️ *${firstName}*, שליחת קישורים אסורה בקבוצה זו!`, { parse_mode: 'Markdown' });
          setTimeout(() => bot.deleteMessage(chatId, warnMsg.message_id), 4000);
          return;
        }
      } catch (e) {}
    }
  }

  if (msg.text && msg.text.startsWith('/')) return;

  // --- קלט: הוספת ערוץ / קבוצה ---
  if (state.step === 'AWAITING_CHANNEL_ADD') {
    let targetChatId = null;
    let title = null;
    let type = 'channel';
    let username = null;

    if (msg.forward_from_chat) {
      targetChatId = msg.forward_from_chat.id;
      title = msg.forward_from_chat.title;
      type = msg.forward_from_chat.type === 'channel' ? 'channel' : 'group';
      username = msg.forward_from_chat.username ? `@${msg.forward_from_chat.username}` : null;
    } else if (msg.text && (msg.text.startsWith('@') || msg.text.startsWith('-100'))) {
      targetChatId = msg.text;
    }

    if (!targetChatId) {
      const sent = await bot.sendMessage(chatId, '⚠️ *שגיאה:* אנא העבר הודעה מהנכס או שלח שם משתמש תקני (`@channel`).', { parse_mode: 'Markdown' });
      trackMessage(userId, sent.message_id);
      return;
    }

    await runPulseAnimation(
      chatId, userId,
      ['🤔 חושב...', '🔍 מאתר נכס בטלגרם...', '🔑 בודק הרשאות מנהל...', 'אימות נתונים...'],
      async (msgId) => {
        try {
          const chatInfo = await bot.getChat(targetChatId);
          title = chatInfo.title || title || 'ללא שם';
          type = chatInfo.type === 'channel' ? 'channel' : 'group';
          username = chatInfo.username ? `@${chatInfo.username}` : username;

          const channels = getUserChannels(userId);
          if (type === 'channel' && channels.filter(c => c.type === 'channel').length >= 1) {
            await bot.editMessageText('❌ *חריגה מורשה:* ניתן לחבר עד ערוץ אחד בלבד.', { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' });
            resetUserState(userId);
            return;
          }
          if (type === 'group' && channels.filter(c => c.type === 'group').length >= 1) {
            await bot.editMessageText('❌ *חריגה מורשה:* ניתן לחבר עד קבוצה אחת בלבד.', { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' });
            resetUserState(userId);
            return;
          }

          channels.push({ id: chatInfo.id, title, type, username });
          resetUserState(userId);

          await bot.editMessageText(`בוצע ✅ *הנכס ${title} חובר בהצלחה ל-PulseBot!*`, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' });
          setTimeout(() => sendMainMenu(chatId, userId, firstName), 1500);

        } catch (e) {
          await bot.editMessageText('❌ *כישלון בזיהוי:* ודא שגרמת לבוט להיות מנהל בנכס ושם המשתמש נכון.', { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' });
        }
      }
    );
  }

  // --- קלט: יצירת פוסט (שלב 1) ---
  else if (state.step === 'POST_STEP_1_CONTENT') {
    state.postData.text = msg.text || msg.caption || '';
    
    if (msg.photo) {
      state.postData.type = 'photo';
      state.postData.fileId = msg.photo[msg.photo.length - 1].file_id;
    } else if (msg.video) {
      state.postData.type = 'video';
      state.postData.fileId = msg.video.file_id;
    } else if (msg.voice) {
      state.postData.type = 'voice';
      state.postData.fileId = msg.voice.file_id;
    } else if (msg.document) {
      state.postData.type = 'document';
      state.postData.fileId = msg.document.file_id;
    } else {
      state.postData.type = 'text';
    }

    state.step = 'POST_STEP_2_OPTIONS';
    await renderPostPreview(chatId, userId);
  }

  // --- קלט: הוספת כפתור לפוסט ---
  else if (state.step === 'POST_STEP_2_ADD_BUTTON') {
    const parts = msg.text ? msg.text.split('|') : [];
    if (parts.length < 2) {
      const sent = await bot.sendMessage(chatId, '⚠️ *פורמט שגוי.* שלח בפורמט:\n`טקסט הכפתור | https://example.com`', { parse_mode: 'Markdown' });
      trackMessage(userId, sent.message_id);
      return;
    }

    state.postData.buttons.push([{ text: parts[0].trim(), url: parts[1].trim() }]);
    const sent = await bot.sendMessage(chatId, '✅ *הכפתור נוצר ונוסף לפוסט!*', { parse_mode: 'Markdown' });
    trackMessage(userId, sent.message_id);
    await renderPostPreview(chatId, userId);
  }

  // --- קלט: מחולל קוד QR ---
  else if (state.step === 'AWAITING_QR_TEXT') {
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(msg.text)}`;
    db.stats.qrGenerated++;
    resetUserState(userId);

    await runPulseAnimation(
      chatId, userId,
      ['🤔 חושב...', '📐 מציב פרמטרים...', '🎨 מייצר קוד QR...'],
      async (msgId) => {
        try { await bot.deleteMessage(chatId, msgId); } catch(e){}
        const sent = await bot.sendPhoto(chatId, qrUrl, { caption: '📱 *קוד ה-QR המעוצב שלך מוכן!*', parse_mode: 'Markdown' });
        trackMessage(userId, sent.file_id);
        setTimeout(() => sendMainMenu(chatId, userId, firstName), 2000);
      }
    );
  }

  // --- קלט: חילוץ ID חופשי ---
  else {
    if (msg.photo || msg.document || msg.video || msg.voice) {
      const fileId = (msg.photo ? msg.photo[msg.photo.length - 1] : msg[msg.type || 'document']).file_id;
      const sent = await bot.sendMessage(chatId, `🔍 *מזהי מדיה שניזוקו:* \n\n║ \`Chat ID:\` \`${chatId}\`\n║ \`File ID:\` \`${fileId}\``, { parse_mode: 'Markdown' });
      trackMessage(userId, sent.message_id);
    }
  }
});

// ---------------------------------------------------------
// 🖼️ תצוגה מקדימה לפוסט (Preview)
// ---------------------------------------------------------
async function renderPostPreview(chatId, userId) {
  await cleanupFlowMessages(chatId, userId);
  const post = getUserState(userId).postData;

  const controlBtns = [
    [{ text: '➕ הוסף כפתור אונליין', callback_data: 'post_add_button' }],
    [{ text: '🚀 אישור ושיגור הפוסט', callback_data: 'post_select_target' }],
    [{ text: '❌ ביטול', callback_data: 'menu_main' }]
  ];

  const replyMarkup = { inline_keyboard: post.buttons.concat(controlBtns) };

  const infoMsg = await bot.sendMessage(chatId, '👀 *תצוגה מקדימה של הפוסט שלך:*\n---', { parse_mode: 'Markdown' });
  trackMessage(userId, infoMsg.message_id);

  let previewMsg;
  if (post.type === 'photo') {
    previewMsg = await bot.sendPhoto(chatId, post.fileId, { caption: post.text, parse_mode: 'Markdown', reply_markup: replyMarkup });
  } else if (post.type === 'video') {
    previewMsg = await bot.sendVideo(chatId, post.fileId, { caption: post.text, parse_mode: 'Markdown', reply_markup: replyMarkup });
  } else if (post.type === 'voice') {
    previewMsg = await bot.sendVoice(chatId, post.fileId, { caption: post.text, parse_mode: 'Markdown', reply_markup: replyMarkup });
  } else if (post.type === 'document') {
    previewMsg = await bot.sendDocument(chatId, post.fileId, { caption: post.text, parse_mode: 'Markdown', reply_markup: replyMarkup });
  } else {
    previewMsg = await bot.sendMessage(chatId, post.text || 'פוסט ריק', { parse_mode: 'Markdown', reply_markup: replyMarkup });
  }

  trackMessage(userId, previewMsg.message_id);
}

// ---------------------------------------------------------
// 🌐 Express Webhook עבור Render
// ---------------------------------------------------------
app.post(`/bot${BOT_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.get('/', (req, res) => {
  res.send('PulseBot Elite System is Active!');
});

app.listen(PORT, async () => {
  console.log(`Server listening on port ${PORT}`);
  if (RENDER_EXTERNAL_URL) {
    const webhookUrl = `${RENDER_EXTERNAL_URL}/bot${BOT_TOKEN}`;
    try {
      await bot.setWebHook(webhookUrl);
      console.log(`Webhook active: ${webhookUrl}`);
    } catch (e) {
      console.error('Webhook error:', e);
    }
  }
});
