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
// 💾 זיכרון זמני (In-Memory Database)
// ---------------------------------------------------------
const db = {
  users: new Set(),
  userChannels: {}, // userId -> Array of { id, title, type, username }
  userState: {},    // userId -> { step, postData: {} }
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

// ---------------------------------------------------------
// 🌀 חיווי ויזואלי דינמי (אנימציית סטטוס)
// ---------------------------------------------------------
async function runAnimatedStatus(chatId, finalAction) {
  const statusMsg = await bot.sendMessage(chatId, '🤔 חושב...');
  
  await new Promise(r => setTimeout(r, 700));
  await bot.editMessageText('🔍 מנתח נתונים ומבצע אימות...', { chat_id: chatId, message_id: statusMsg.message_id });

  await new Promise(r => setTimeout(r, 800));
  try {
    await finalAction(statusMsg.message_id);
  } catch (err) {
    console.error('Action error:', err);
    await bot.editMessageText('❌ אירעה שגיאה בביצוע הפעולה.', { chat_id: chatId, message_id: statusMsg.message_id });
  }
}

// ---------------------------------------------------------
// 🏠 תפריט ראשי מעוצב
// ---------------------------------------------------------
async function sendMainMenu(chatId, firstName, messageId = null) {
  const text = `🚀 **ברוכים הבאים לבוט הניהול והפרסום המתקדם!**\n\nשלום ${firstName}, בחר אחת מהפעולות שלמטה כדי להתחיל:`;
  
  const keyboard = {
    inline_keyboard: [
      [{ text: '📢 פרסום פוסט חדש', callback_data: 'menu_create_post' }, { text: '➕ הוסף ערוץ/קבוצה', callback_data: 'menu_add' }],
      [{ text: '🗃️ הערוצים & הקבוצות שלי', callback_data: 'menu_my_list' }],
      [{ text: '🛠️ ארגז הכלים שלי (Utilities)', callback_data: 'menu_tools' }],
      [{ text: '📊 סטטיסטיקות מערכת', callback_data: 'menu_stats' }]
    ]
  };

  if (messageId) {
    try {
      await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: keyboard });
      return;
    } catch (e) {}
  }
  await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: keyboard });
}

bot.onText(/\/start/, async (msg) => {
  db.users.add(msg.from.id);
  resetUserState(msg.from.id);
  await sendMainMenu(msg.chat.id, msg.from.first_name || 'חבר');
});

// ---------------------------------------------------------
// 🔘 טיפול בלחיצות על כפתורים (Callback Queries)
// ---------------------------------------------------------
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const userId = query.from.id;
  const data = query.data;

  await bot.answerCallbackQuery(query.id);

  // --- תפריט ראשי ---
  if (data === 'menu_main') {
    resetUserState(userId);
    await sendMainMenu(chatId, query.from.first_name, messageId);
  }

  // --- הוספת ערוץ / קבוצה ---
  else if (data === 'menu_add') {
    const me = await bot.getMe();
    const text = `➕ **חיבור ערוץ או קבוצה למערכת**\n\nניתן לחבר עד **ערוץ אחד 📣 וקבוצה אחת 📢**.\nלחצו על הכפתור המתאים כדי להוסיף את הבוט כמנהל, ולאחר מכן העבירו אליי הודעה משם או שלחו את שם המשתמש (\`@channel\`):`;
    
    const keyboard = {
      inline_keyboard: [
        [
          { text: 'הוסף לערוץ 📣', url: `https://t.me/${me.username}?startchannel=true` },
          { text: 'הוסף לקבוצה 📢', url: `https://t.me/${me.username}?startgroup=true` }
        ],
        [{ text: '🔙 חזרה לתפריט', callback_data: 'menu_main' }]
      ]
    };

    getUserState(userId).step = 'AWAITING_CHANNEL_ADD';
    await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: keyboard });
  }

  // --- רשימת ערוצים וקבוצות ---
  else if (data === 'menu_my_list') {
    const list = getUserChannels(userId);
    if (list.length === 0) {
      await bot.editMessageText(`🗃️ **הנכסים המחוברים שלך:**\n\nטרם חיברת ערוצים או קבוצות.`, {
        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '➕ הוסף עכשיו', callback_data: 'menu_add' }], [{ text: '🔙 חזרה', callback_data: 'menu_main' }]] }
      });
      return;
    }

    let text = `🗃️ **הנכסים המחוברים שלך:**\n\n`;
    const btns = [];
    list.forEach((item, i) => {
      const icon = item.type === 'channel' ? '📣' : '📢';
      text += `${i + 1}.${icon} **${item.title}** (${item.username || 'פרטי'})\n`;
      btns.push([{ text: `הסר את ${item.title} 🗑️`, callback_data: `remove_ch_${item.id}` }]);
    });
    btns.push([{ text: '🔙 חזרה לתפריט', callback_data: 'menu_main' }]);

    await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: btns } });
  }

  // --- הסרת ערוץ ---
  else if (data.startsWith('remove_ch_')) {
    const targetId = data.replace('remove_ch_', '');
    await runAnimatedStatus(chatId, async (msgId) => {
      db.userChannels[userId] = getUserChannels(userId).filter(c => c.id.toString() !== targetId.toString());
      await bot.editMessageText('בוצע ✅ הנכס הוסר בהצלחה מניהול הבוט!', { chat_id: chatId, message_id: msgId });
      setTimeout(() => sendMainMenu(chatId, query.from.first_name), 1200);
    });
  }

  // --- ארגז כלים (Utilities) ---
  else if (data === 'menu_tools') {
    const text = `🛠️ **ארגז הכלים של הבוט:**\n\nבחר כלי לשימוש:`;
    const keyboard = {
      inline_keyboard: [
        [{ text: '📱 מחולל קודי QR', callback_data: 'tool_qr' }],
        [{ text: '🔍 מזהה File ID ו-Chat ID', callback_data: 'tool_id' }],
        [{ text: '🔙 חזרה לתפריט', callback_data: 'menu_main' }]
      ]
    };
    await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: keyboard });
  }

  else if (data === 'tool_qr') {
    getUserState(userId).step = 'AWAITING_QR_TEXT';
    await bot.editMessageText('📱 **מחולל קודי QR**\n\nשלח כעת טקסט או קישור, והבוט ייצר עבורך קוד QR מעוצב!', {
      chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: '❌ ביטול', callback_data: 'menu_tools' }]] }
    });
  }

  else if (data === 'tool_id') {
    await bot.editMessageText('🔍 **מחלץ ID**\n\nפשוט שלח אליי כל קובץ, תמונה, סרטון או הודעה מועברת, ואני אשלח לך את ה-ID המדויק שלו בטלגרם!', {
      chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: '🔙 חזרה', callback_data: 'menu_tools' }]] }
    });
  }

  // --- סטטיסטיקות ---
  else if (data === 'menu_stats') {
    const text = `📊 **סטטיסטיקות בוט בזמן אמת:**\n\n` +
                 `👤 משתמשים ייחודיים: **${db.users.size}**\n` +
                 `📣 ערוצים/קבוצות מחוברים: **${Object.values(db.userChannels).flat().length}**\n` +
                 `📢 פוסטים שפורסמו: **${db.stats.postsPublished}**\n` +
                 `📱 קודי QR שנוצרו: **${db.stats.qrGenerated}**`;

    await bot.editMessageText(text, {
      chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: '🔙 חזרה לתפריט', callback_data: 'menu_main' }]] }
    });
  }

  // --- תהליך יצירת פוסט (שלב 1) ---
  else if (data === 'menu_create_post') {
    const list = getUserChannels(userId);
    if (list.length === 0) {
      await bot.editMessageText('⚠️ **שימו לב!** עליכם לחבר ערוץ/קבוצה לפני יצירת פוסט.', {
        chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '➕ הוסף עכשיו', callback_data: 'menu_add' }], [{ text: '🔙 חזרה', callback_data: 'menu_main' }]] }
      });
      return;
    }

    const state = getUserState(userId);
    state.step = 'POST_STEP_1_CONTENT';
    state.postData = { buttons: [] };

    await bot.editMessageText('📢 **יצירת פוסט - שלב 1 מתוך 3**\n\nשלחו כעת את התוכן של הפוסט:\n(טקסט, תמונה, וידאו, הודעה קולית או קובץ)', {
      chat_id: chatId, message_id: messageId, parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: '❌ ביטול', callback_data: 'menu_main' }]] }
    });
  }

  // --- הוספת כפתור אונליין ---
  else if (data === 'post_add_button') {
    getUserState(userId).step = 'POST_STEP_2_ADD_BUTTON';
    await bot.sendMessage(chatId, '🔘 **הוספת כפתור אונליין**\n\nשלח בפורמט הבא:\n`טקסט הכפתור | https://example.com`', { parse_mode: 'Markdown' });
  }

  // --- בחירת יעד לפרסום ---
  else if (data === 'post_select_target') {
    const list = getUserChannels(userId);
    const btns = list.map(item => [{ text: `${item.type === 'channel' ? '📣' : '📢'} ${item.title}`, callback_data: `publish_to_${item.id}` }]);
    btns.push([{ text: '❌ ביטול', callback_data: 'menu_main' }]);

    await bot.sendMessage(chatId, '🎯 **בחירת יעד לפרסום - שלב 3 מתוך 3**\n\nלאן לפרסם את הפוסט?', {
      parse_mode: 'Markdown', reply_markup: { inline_keyboard: btns }
    });
  }

  // --- ביצוע הפרסום בפועל ---
  else if (data.startsWith('publish_to_')) {
    const targetId = data.replace('publish_to_', '');
    const state = getUserState(userId);
    const post = state.postData;

    await runAnimatedStatus(chatId, async (msgId) => {
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
      await bot.editMessageText('בוצע ✅ הפוסט פורסם בהצלחה ביעד!', { chat_id: chatId, message_id: msgId });
      resetUserState(userId);
      setTimeout(() => sendMainMenu(chatId, query.from.first_name), 1500);
    });
  }
});

// ---------------------------------------------------------
// 📩 טיפול בהודעות נכנסות (טקסט, מדיה, העברות)
// ---------------------------------------------------------
bot.on('message', async (msg) => {
  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const state = getUserState(userId);

  // --- קבלת פנים לחברים חדשים בקבוצה ---
  if (msg.new_chat_members) {
    msg.new_chat_members.forEach(member => {
      bot.sendMessage(chatId, `👋 ברוך הבא **${member.first_name}** לקבוצה שלנו!`, { parse_mode: 'Markdown' });
    });
    return;
  }

  // --- סינון קישורים / ספאם בקבוצות (אם מוגדר) ---
  if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
    if (msg.text && (msg.text.includes('t.me/') || msg.text.includes('http://') || msg.text.includes('https://'))) {
      // דוגמה לסינון: מחיקת הודעות עם קישורים מאנשים שאינם מנהלים
      try {
        const member = await bot.getChatMember(chatId, userId);
        if (member.status !== 'administrator' && member.status !== 'creator') {
          await bot.deleteMessage(chatId, msg.message_id);
          const warnMsg = await bot.sendMessage(chatId, `⚠️ ${msg.from.first_name}, שליחת קישורים אסורה בקבוצה זו!`);
          setTimeout(() => bot.deleteMessage(chatId, warnMsg.message_id), 4000);
          return;
        }
      } catch (e) {}
    }
  }

  // מתעלמים מפקודות /
  if (msg.text && msg.text.startsWith('/')) return;

  // --- הוספת ערוץ / קבוצה ---
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
      await bot.sendMessage(chatId, '⚠️ אנא העבירו הודעה מהערוץ/קבוצה או שלחו את שם המשתמש (`@channel`).');
      return;
    }

    await runAnimatedStatus(chatId, async (msgId) => {
      const chatInfo = await bot.getChat(targetChatId);
      title = chatInfo.title || title || 'ללא שם';
      type = chatInfo.type === 'channel' ? 'channel' : 'group';
      username = chatInfo.username ? `@${chatInfo.username}` : username;

      const channels = getUserChannels(userId);
      if (type === 'channel' && channels.filter(c => c.type === 'channel').length >= 1) {
        await bot.editMessageText('❌ ניתן לחבר עד ערוץ אחד בלבד.', { chat_id: chatId, message_id: msgId });
        resetUserState(userId);
        return;
      }
      if (type === 'group' && channels.filter(c => c.type === 'group').length >= 1) {
        await bot.editMessageText('❌ ניתן לחבר עד קבוצה אחת בלבד.', { chat_id: chatId, message_id: msgId });
        resetUserState(userId);
        return;
      }

      channels.push({ id: chatInfo.id, title, type, username });
      resetUserState(userId);

      await bot.editMessageText(`בוצע ✅ חובור בהצלחה: **${title}**`, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' });
      setTimeout(() => sendMainMenu(chatId, msg.from.first_name), 1500);
    });
  }

  // --- יצירת פוסט: שלב 1 ---
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

  // --- יצירת פוסט: הוספת כפתור ---
  else if (state.step === 'POST_STEP_2_ADD_BUTTON') {
    const parts = msg.text ? msg.text.split('|') : [];
    if (parts.length < 2) {
      await bot.sendMessage(chatId, '⚠️ פורמט שגוי. שלח:\n`טקסט | https://link.com`', { parse_mode: 'Markdown' });
      return;
    }

    state.postData.buttons.push([{ text: parts[0].trim(), url: parts[1].trim() }]);
    await bot.sendMessage(chatId, '✅ הכפתור נוצר בהצלחה!');
    await renderPostPreview(chatId, userId);
  }

  // --- מחולל קוד QR ---
  else if (state.step === 'AWAITING_QR_TEXT') {
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(msg.text)}`;
    db.stats.qrGenerated++;
    resetUserState(userId);
    await bot.sendPhoto(chatId, qrUrl, { caption: '📱 **קוד ה-QR שלך מוכן!**', parse_mode: 'Markdown' });
    setTimeout(() => sendMainMenu(chatId, msg.from.first_name), 1500);
  }

  // --- חילוץ ID חופשי ---
  else {
    if (msg.photo || msg.document || msg.video || msg.voice) {
      const fileId = (msg.photo ? msg.photo[msg.photo.length - 1] : msg[msg.type || 'document']).file_id;
      await bot.sendMessage(chatId, `🔍 **פרטי הקובץ:**\n\n\`Chat ID:\` \`${chatId}\`\n\`File ID:\` \`${fileId}\``, { parse_mode: 'Markdown' });
    }
  }
});

// ---------------------------------------------------------
// 🖼️ תצוגה מקדימה לפוסט
// ---------------------------------------------------------
async function renderPostPreview(chatId, userId) {
  const post = getUserState(userId).postData;

  const controlBtns = [
    [{ text: '➕ הוסף כפתור אונליין', callback_data: 'post_add_button' }],
    [{ text: '🚀 אישור ופרסום הפוסט', callback_data: 'post_select_target' }],
    [{ text: '❌ ביטול', callback_data: 'menu_main' }]
  ];

  const replyMarkup = { inline_keyboard: post.buttons.concat(controlBtns) };

  await bot.sendMessage(chatId, '👀 **תצוגה מקדימה של הפוסט שלך:**\n---', { parse_mode: 'Markdown' });

  if (post.type === 'photo') {
    await bot.sendPhoto(chatId, post.fileId, { caption: post.text, parse_mode: 'Markdown', reply_markup: replyMarkup });
  } else if (post.type === 'video') {
    await bot.sendVideo(chatId, post.fileId, { caption: post.text, parse_mode: 'Markdown', reply_markup: replyMarkup });
  } else if (post.type === 'voice') {
    await bot.sendVoice(chatId, post.fileId, { caption: post.text, parse_mode: 'Markdown', reply_markup: replyMarkup });
  } else if (post.type === 'document') {
    await bot.sendDocument(chatId, post.fileId, { caption: post.text, parse_mode: 'Markdown', reply_markup: replyMarkup });
  } else {
    await bot.sendMessage(chatId, post.text || 'פוסט ריק', { parse_mode: 'Markdown', reply_markup: replyMarkup });
  }
}

// ---------------------------------------------------------
// 🌐 Express Webhook עבור Render
// ---------------------------------------------------------
app.post(`/bot${BOT_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.get('/', (req, res) => {
  res.send('Advanced Telegram Management Bot is Active!');
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
