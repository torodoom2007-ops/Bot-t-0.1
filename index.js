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

// זיכרון זמני בזיכרון (In-Memory DB) עבור הבוט
// במערכת ייצור מומלץ לחבר ל-Supabase / PostgreSQL
const db = {
  // structure: userId -> [{ id, title, type: 'channel'|'group', username }]
  userChannels: {},
  // structure: userId -> { step, postData: { text, photoId, documentId, buttons: [] } }
  userState: {}
};

// עזרים לשליטה במצבים
function getUserChannels(userId) {
  if (!db.userChannels[userId]) db.userChannels[userId] = [];
  return db.userChannels[userId];
}

function getUserState(userId) {
  if (!db.userState[userId]) db.userState[userId] = { step: 'IDLE', postData: {} };
  return db.userState[userId];
}

function resetUserState(userId) {
  db.userState[userId] = { step: 'IDLE', postData: {} };
}

// ---------------------------------------------------------
// 1. תפריט ראשי & פקודת /start
// ---------------------------------------------------------
async function sendMainMenu(chatId, firstName, messageId = null) {
  const text = `✨ **שלום ${firstName}!** 👋\n\nברוך הבא למערכת הניהול והפרסום המתקדמת לטלגרם 🚀\nבחרו מהברחבי הפעולות שלמטה כדי להתחיל:`;
  
  const keyboard = {
    inline_keyboard: [
      [{ text: 'הוסף ערוץ & קבוצה ➕', callback_data: 'menu_add' }],
      [{ text: 'הערוצים & קבוצות שלי 🗃️', callback_data: 'menu_my_list' }],
      [{ text: 'פרסם פוסט חדש 📢', callback_data: 'menu_create_post' }]
    ]
  };

  if (messageId) {
    try {
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
      return;
    } catch (e) {
      // במידה ולא ניתן לערוך, נשלח הודעה חדשה
    }
  }

  await bot.sendMessage(chatId, text, {
    parse_mode: 'Markdown',
    reply_markup: keyboard
  });
}

bot.onText(/\/start/, async (msg) => {
  resetUserState(msg.from.id);
  await sendMainMenu(msg.chat.id, msg.from.first_name || 'חבר');
});

// ---------------------------------------------------------
// 2. טיפול בבלחיצות על כפתורי אונליין (Callback Queries)
// ---------------------------------------------------------
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const userId = query.from.id;
  const data = query.data;

  // אישור לטלגרם שהלחיצה התקבלה
  await bot.answerCallbackQuery(query.id);

  // --- תפריט ראשי: הוספת ערוץ / קבוצה ---
  if (data === 'menu_add') {
    const me = await bot.getMe();
    const text = `➕ **הוספת ערוץ או קבוצה למערכת**\n\nמותר לחבר עד **ערוץ אחד 📣 וקבוצה אחת 📢**.\n\nכדי לחבר, הוסיפו את הבוט כמנהל לערוץ/קבוצה שלכם באמצעות הלחיצה למטה, ולאחר מכן העבירו אליי הודעה משם או שלחו קישור/שם משתמש (למשל: \`@mychannel\`):`;
    
    const keyboard = {
      inline_keyboard: [
        [
          { text: 'הוסף כפתור אונליין לערוץ 📣', url: `https://t.me/${me.username}?startchannel=true` },
          { text: 'הוסף כפתור אונליין לקבוצה 📢', url: `https://t.me/${me.username}?startgroup=true` }
        ],
        [{ text: '🔙 חזרה לתפריט', callback_data: 'menu_main' }]
      ]
    };

    getUserState(userId).step = 'AWAITING_CHANNEL_ADD';

    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  }

  // --- תפריט ראשי: הציג ערוצים & קבוצות שלי ---
  else if (data === 'menu_my_list') {
    const list = getUserChannels(userId);
    if (list.length === 0) {
      const text = `🗃️ **הערוצים & קבוצות שלי**\n\nעדיין לא חיברת אף ערוץ או קבוצה למערכת.`;
      const keyboard = {
        inline_keyboard: [
          [{ text: 'הוסף ערוץ & קבוצה ➕', callback_data: 'menu_add' }],
          [{ text: '🔙 חזרה לתפריט', callback_data: 'menu_main' }]
        ]
      };
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
      return;
    }

    let text = `🗃️ **רשימת המחוברים שלך:**\n\n`;
    const keyboardBtns = [];

    list.forEach((item, index) => {
      const icon = item.type === 'channel' ? '📣' : '📢';
      text += `${index + 1}. ${icon} **${item.title}** (${item.username || 'פרטי'})\n`;
      keyboardBtns.push([{ text: `הסר את ${item.title} 🗑️`, callback_data: `remove_ch_${item.id}` }]);
    });

    keyboardBtns.push([{ text: '🔙 חזרה לתפריט', callback_data: 'menu_main' }]);

    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboardBtns }
    });
  }

  // --- הסרת ערוץ / קבוצה ---
  else if (data.startsWith('remove_ch_')) {
    const channelIdToRemove = data.replace('remove_ch_', '');
    db.userChannels[userId] = getUserChannels(userId).filter(item => item.id.toString() !== channelIdToRemove.toString());
    
    // אנימציה קלה
    await bot.editMessageText('⏳ מוחק מהמערכת...', { chat_id: chatId, message_id: messageId });
    setTimeout(async () => {
      await bot.editMessageText('✅ הוסר בהצלחה!', { chat_id: chatId, message_id: messageId });
      setTimeout(async () => {
        await sendMainMenu(chatId, query.from.first_name, messageId);
      }, 1000);
    }, 800);
  }

  // --- תפריט ראשי: פרסם פוסט חדש (שלב 1) ---
  else if (data === 'menu_create_post') {
    const list = getUserChannels(userId);
    if (list.length === 0) {
      await bot.editMessageText('⚠️ **שימו לב!**\n\nעליכם לחבר לפחות ערוץ או קבוצה אחת לפני שתוכלו ליצור פוסט.', {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: 'הוסף ערוץ & קבוצה ➕', callback_data: 'menu_add' }],
            [{ text: '🔙 חזרה לתפריט', callback_data: 'menu_main' }]
          ]
        }
      });
      return;
    }

    const state = getUserState(userId);
    state.step = 'POST_STEP_1_CONTENT';
    state.postData = {};

    const text = `📢 **יצירת פוסט חדש - שלב 1 מתוך 3**\n\nשלחו כעת את תוכן הפוסט:\nטקסט, תמונה עם כיתוב, או קובץ לבחירתכם. 📝📸`;
    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: '❌ ביטול', callback_data: 'menu_main' }]] }
    });
  }

  // --- יצירת פוסט: הוספת כפתור אונליין ---
  else if (data === 'post_add_button') {
    const state = getUserState(userId);
    state.step = 'POST_STEP_2_ADD_BUTTON';

    const text = `🔘 **הוספת כפתור אונליין - שלב 2**\n\nשלחו את הפרטים בפורמט הבא:\n\`שם הכפתור | https://your-link.com\`\n\n*(לדוגמה: לחץ כאן לבקר באתר | https://google.com)*`;
    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: 'סיימתי / דלג ⏩', callback_data: 'post_preview' }]] }
    });
  }

  // --- יצירת פוסט: תצוגה מקדימה (שלב 2) ---
  else if (data === 'post_preview') {
    await renderPostPreview(chatId, userId);
  }

  // --- יצירת פוסט: בחירת יעד לפרסום (שלב 3) ---
  else if (data === 'post_select_target') {
    const list = getUserChannels(userId);
    const keyboardBtns = list.map(item => [
      { text: `${item.type === 'channel' ? '📣' : '📢'} ${item.title}`, callback_data: `publish_to_${item.id}` }
    ]);
    keyboardBtns.push([{ text: '❌ ביטול', callback_data: 'menu_main' }]);

    await bot.sendMessage(chatId, `🎯 **בחירת יעד - שלב 3 מתוך 3**\n\nלאן תרצו לפרסם את הפוסט?`, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboardBtns }
    });
  }

  // --- פרסום בפועל עם האנימציה של "חושב... -> מנתח... -> בוצע ✅" ---
  else if (data.startsWith('publish_to_')) {
    const targetId = data.replace('publish_to_', '');
    const state = getUserState(userId);
    const post = state.postData;

    // 1. הודעת סטטוס ראשונה: "חושב..."
    const statusMsg = await bot.sendMessage(chatId, '🤔 חושב...');

    setTimeout(async () => {
      // 2. עדכון סטטוס: "מנתח..."
      await bot.editMessageText('🔍 מנתח נתונים ומכין את השילוח...', {
        chat_id: chatId,
        message_id: statusMsg.message_id
      });

      setTimeout(async () => {
        try {
          const replyMarkup = post.buttons && post.buttons.length > 0
            ? { inline_keyboard: post.buttons }
            : undefined;

          // ביצוע השליחה ליעד
          if (post.photoId) {
            await bot.sendPhoto(targetId, post.photoId, { caption: post.text, parse_mode: 'Markdown', reply_markup: replyMarkup });
          } else if (post.documentId) {
            await bot.sendDocument(targetId, post.documentId, { caption: post.text, parse_mode: 'Markdown', reply_markup: replyMarkup });
          } else if (post.text) {
            await bot.sendMessage(targetId, post.text, { parse_mode: 'Markdown', reply_markup: replyMarkup });
          }

          // 3. עדכון סטטוס סופי: "בוצע ✅"
          await bot.editMessageText('בוצע ✅ הפוסט פורסם בהצלחה!', {
            chat_id: chatId,
            message_id: statusMsg.message_id
          });

          resetUserState(userId);

          setTimeout(async () => {
            await sendMainMenu(chatId, query.from.first_name);
          }, 1500);

        } catch (error) {
          console.error('Publishing error:', error);
          await bot.editMessageText('❌ שגיאה בפרסום! ודא שהבוט עדיין מוגדר כמנהל ביעד.', {
            chat_id: chatId,
            message_id: statusMsg.message_id
          });
        }
      }, 1200);
    }, 1000);
  }

  // --- חזרה לתפריט הראשי ---
  else if (data === 'menu_main') {
    resetUserState(userId);
    await sendMainMenu(chatId, query.from.first_name, messageId);
  }
});

// ---------------------------------------------------------
// 3. הזרמת הודעות קלט מהמשתמש (תמונות, טקסט, העברות)
// ---------------------------------------------------------
bot.on('message', async (msg) => {
  if (!msg.text || !msg.text.startsWith('/')) {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const state = getUserState(userId);

    // --- מצב הוספת ערוץ / קבוצה ---
    if (state.step === 'AWAITING_CHANNEL_ADD') {
      let targetChatId = null;
      let title = null;
      let type = 'channel';
      let username = null;

      // אם מדובר בהודעה מועברת (Forward)
      if (msg.forward_from_chat) {
        targetChatId = msg.forward_from_chat.id;
        title = msg.forward_from_chat.title;
        type = msg.forward_from_chat.type === 'channel' ? 'channel' : 'group';
        username = msg.forward_from_chat.username ? `@${msg.forward_from_chat.username}` : null;
      } else if (msg.text && (msg.text.startsWith('@') || msg.text.startsWith('-100'))) {
        targetChatId = msg.text;
      }

      if (!targetChatId) {
        await bot.sendMessage(chatId, '⚠️ אנא העבירו הודעה מהערוץ/קבוצה או שלחו את שם המשתמש שלו (למשל `@mychannel`).');
        return;
      }

      const tempMsg = await bot.sendMessage(chatId, '🤔 חושב...');

      setTimeout(async () => {
        await bot.editMessageText('🔍 מנתח ובודק הרשאות מנהל...', { chatId, message_id: tempMsg.message_id });

        try {
          const chatInfo = await bot.getChat(targetChatId);
          title = chatInfo.title || title || 'ללא שם';
          type = chatInfo.type === 'channel' ? 'channel' : 'group';
          username = chatInfo.username ? `@${chatInfo.username}` : username;

          const channels = getUserChannels(userId);
          const channelCount = channels.filter(c => c.type === 'channel').length;
          const groupCount = channels.filter(c => c.type === 'group').length;

          if (type === 'channel' && channelCount >= 1) {
            await bot.editMessageText('❌ מותר לחבר עד **ערוץ אחד בלבד** במערכת זו.', { chat_id: chatId, message_id: tempMsg.message_id, parse_mode: 'Markdown' });
            resetUserState(userId);
            return;
          }
          if (type === 'group' && groupCount >= 1) {
            await bot.editMessageText('❌ מותר לחבר עד **קבוצה אחת בלבד** במערכת זו.', { chat_id: chatId, message_id: tempMsg.message_id, parse_mode: 'Markdown' });
            resetUserState(userId);
            return;
          }

          // שמירה בזיכרון
          channels.push({ id: chatInfo.id, title, type, username });
          resetUserState(userId);

          await bot.editMessageText(`בוצע ✅\nהוסף בהצלחה: **${title}** (${type === 'channel' ? 'ערוץ' : 'קבוצה'})`, {
            chat_id: chatId,
            message_id: tempMsg.message_id,
            parse_mode: 'Markdown'
          });

          setTimeout(async () => {
            await sendMainMenu(chatId, msg.from.first_name);
          }, 1500);

        } catch (e) {
          console.error(e);
          await bot.editMessageText('❌ לא הצלחתי לאתר את הערוץ/קבוצה. ודא שהוספת את הבוט כמנהל ושם המשתמש נכון.', {
            chat_id: chatId,
            message_id: tempMsg.message_id
          });
        }
      }, 1000);
    }

    // --- יצירת פוסט: שלב 1 - קבלת תוכן ---
    else if (state.step === 'POST_STEP_1_CONTENT') {
      state.postData.text = msg.text || msg.caption || '';
      if (msg.photo) {
        state.postData.photoId = msg.photo[msg.photo.length - 1].file_id;
      } else if (msg.document) {
        state.postData.documentId = msg.document.file_id;
      }

      state.step = 'POST_STEP_2_OPTIONS';
      await renderPostPreview(chatId, userId);
    }

    // --- יצירת פוסט: שלב 2 - הוספת כפתור אונליין ---
    else if (state.step === 'POST_STEP_2_ADD_BUTTON') {
      const parts = msg.text ? msg.text.split('|') : [];
      if (parts.length < 2) {
        await bot.sendMessage(chatId, '⚠️ הפורמט שגוי. אנא שלח בפורמט:\n`טקסט הכפתור | https://link.com`', { parse_mode: 'Markdown' });
        return;
      }

      const btnText = parts[0].trim();
      const btnUrl = parts[1].trim();

      if (!state.postData.buttons) state.postData.buttons = [];
      state.postData.buttons.push([{ text: btnText, url: btnUrl }]);

      await bot.sendMessage(chatId, `✅ הכפתור **"${btnText}"** נופש בהצלחה!`, { parse_mode: 'Markdown' });
      await renderPostPreview(chatId, userId);
    }
  }
});

// פונקציית עזר להצגת תצוגה מקדימה של פוסט
async function renderPostPreview(chatId, userId) {
  const state = getUserState(userId);
  const post = state.postData;

  const inlineKeyboard = [
    [{ text: '➕ הוסף כפתור אונליין', callback_data: 'post_add_button' }],
    [{ text: '🚀 אישור ופרסום הפוסט', callback_data: 'post_select_target' }],
    [{ text: '❌ ביטול', callback_data: 'menu_main' }]
  ];

  await bot.sendMessage(chatId, '👀 **תצוגה מקדימה של הפוסט שלך:**\n---', { parse_mode: 'Markdown' });

  const replyMarkup = { inline_keyboard: (post.buttons || []).concat(inlineKeyboard) };

  if (post.photoId) {
    await bot.sendPhoto(chatId, post.photoId, { caption: post.text, parse_mode: 'Markdown', reply_markup: replyMarkup });
  } else if (post.documentId) {
    await bot.sendDocument(chatId, post.documentId, { caption: post.text, parse_mode: 'Markdown', reply_markup: replyMarkup });
  } else {
    await bot.sendMessage(chatId, post.text || 'שגיאה: פוסט ריק', { parse_mode: 'Markdown', reply_markup: replyMarkup });
  }
}

// ---------------------------------------------------------
// 4. שרת Express והגדרת Webhook ל-Render
// ---------------------------------------------------------
app.post(`/bot${BOT_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

app.get('/', (req, res) => {
  res.send('Bot is active and running!');
});

app.listen(PORT, async () => {
  console.log(`Server listening on port ${PORT}`);
  if (RENDER_EXTERNAL_URL) {
    const webhookUrl = `${RENDER_EXTERNAL_URL}/bot${BOT_TOKEN}`;
    try {
      await bot.setWebHook(webhookUrl);
      console.log(`Webhook set: ${webhookUrl}`);
    } catch (e) {
      console.error('Webhook set error:', e);
    }
  }
});
