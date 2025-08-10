import 'dotenv/config';
import { Telegraf } from 'telegraf';
import { DateTime } from 'luxon';
import fs from 'fs';
import path from 'path';

// ====== ВЛАДЕЛЕЦ (кто может менять настройки) ======
const OWNER_IDS = [661057299]; // <-- твой Telegram user id

// ====== ТЕКСТЫ ======
function plural(n, one, few, many) {
  const n10 = n % 10, n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
  return many;
}
function mainLine(days) {
  const word = plural(days, 'день', 'дня', 'дней');
  return `До возможной легендарной встречи осталось ${days} ${word}, а может и не легендарной, посмотрим.`;
}

// Дополнительные фразы — меняются по дню (псевдослучайно от даты)
const EXTRA_LINES = [
  'Если Дениса отпустят к нам',
  'Если Иля решится взять свою бричку и доехать вместе с Расимом',
  'Если все соберутся без опозданий',
  'Если погода скажет: “да”',
  'Если всё совпадёт как надо',
  'Если таксист найдёт нужный поворот',
  'Если плейлист зайдёт с первого трека',
  'Если кофе будет крепким',
  'Если шутки будут смешными',
  'Если удача будет на нашей стороне'
];

function dailyExtraLine(tzOffset) {
  const zone = `UTC${tzOffset}`;
  const idx = DateTime.now().setZone(zone).ordinal % EXTRA_LINES.length;
  return EXTRA_LINES[idx];
}

// Картинки — РАНДОМ из списка (каждый раз новая)
const EXTRA_IMAGES = [
  'https://i.imgur.com/yxy2Yyj.png',
  'https://i.imgur.com/RID6Qt9.png',
  'https://i.imgur.com/iIovm0s.png',
  'https://i.imgur.com/krFtqbg.png',
  'https://i.imgur.com/toB8RbD.png',
  'https://i.imgur.com/nup8ect.png',
  'https://i.imgur.com/LXF5SGP.png',
];
function randomImageUrl() {
  if (!EXTRA_IMAGES.length) return null;
  const i = Math.floor(Math.random() * EXTRA_IMAGES.length);
  return EXTRA_IMAGES[i];
}

// ====== ХРАНИЛИЩЕ (файл) ======
const STORE_PATH = process.env.STORE_PATH || './store.json';

function ensureDirExists(filePath) {
  const dir = path.dirname(filePath);
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
}
function loadStore() {
  try {
    ensureDirExists(STORE_PATH);
    if (!fs.existsSync(STORE_PATH)) return {};
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  } catch { return {}; }
}
function saveStore(obj) {
  try {
    ensureDirExists(STORE_PATH);
    fs.writeFileSync(STORE_PATH, JSON.stringify(obj, null, 2));
  } catch (e) {
    console.error('Failed to save store:', e.message);
  }
}

let store = loadStore();
// структура: store[chatId] = { target_date, tz_offset, notify, last_notified_iso }

function ensureChat(chatId, chatType) {
  if (!store[chatId]) {
    // в группах авто-уведомления включены по умолчанию; в личке — выключены
    const defaultNotify = (chatType === 'group' || chatType === 'supergroup');
    store[chatId] = { target_date: null, tz_offset: '+04:00', notify: defaultNotify, last_notified_iso: null };
    saveStore(store);
  }
}

// ====== ДАТЫ ======
function parseDate(input) {
  let dt = DateTime.fromFormat(String(input).trim(), 'yyyy-MM-dd', { zone: 'utc' });
  if (!dt.isValid) dt = DateTime.fromFormat(String(input).trim(), 'dd.MM.yyyy', { zone: 'utc' });
  return dt.isValid ? dt : null;
}
function normalizeTzOffset(s) {
  const m = String(s || '').trim().match(/^([+\-])(\d{2}):(\d{2})$/);
  if (!m) return null;
  return `${m[1]}${m[2]}:${m[3]}`;
}
function calcDaysLeft(targetISO, tzOffset) {
  const zone = `UTC${tzOffset}`;
  const now = DateTime.now().setZone(zone).startOf('day');
  const target = DateTime.fromISO(targetISO, { zone }).startOf('day');
  return Math.floor(target.diff(now, 'days').days);
}

// ====== БОТ ======
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const isGroup = (ctx) => ['group', 'supergroup'].includes(ctx.chat?.type);
const isOwner = (ctx) => OWNER_IDS.includes(ctx.from?.id);

// Универсальная отправка: фото (рандом) + подпись, иначе просто текст
async function sendWithRandomImage(ctxOrBot, chatId, text) {
  const url = randomImageUrl();
  try {
    if (url) {
      if (ctxOrBot.telegram) {
        await ctxOrBot.telegram.sendPhoto(chatId, url, { caption: text });
      } else {
        await ctxOrBot.replyWithPhoto(url, { caption: text });
      }
    } else {
      if (ctxOrBot.telegram) {
        await ctxOrBot.telegram.sendMessage(chatId, text);
      } else {
        await ctxOrBot.reply(text);
      }
    }
  } catch {
    // если картинка не отправилась — шлём текстом
    if (ctxOrBot.telegram) {
      await ctxOrBot.telegram.sendMessage(chatId, text);
    } else {
      await ctxOrBot.reply(text);
    }
  }
}

// ====== КОМАНДЫ ======
bot.start(async (ctx) => {
  const chatId = String(ctx.chat.id);
  ensureChat(chatId, ctx.chat.type);

  if (isGroup(ctx)) {
    return ctx.reply('Бот активирован. Пиши /date чтобы посмотреть, сколько дней осталось.');
  }
  return ctx.reply(
`Привет! Я считаю, сколько дней осталось до заданной даты.

Команды (для владельца):
/setdate 2025-09-10  — установить дату (или 10.09.2025)
/tz +04:00           — установить часовой пояс

Для всех:
/date                 — сколько дней осталось (с картинкой)
`
  );
});

// /date — доступно всем (и в группах, и в личке)
bot.command(['date', 'left'], (ctx) => {
  const chatId = String(ctx.chat.id);
  ensureChat(chatId, ctx.chat.type);

  const cfg = store[chatId];
  if (!cfg.target_date) {
    if (isGroup(ctx)) {
      return ctx.reply('Дата не установлена. Владелец может задать её командой /setdate 2025-09-10');
    }
    return ctx.reply('Дата не установлена. Задай: /setdate 2025-09-10');
  }

  const days = calcDaysLeft(cfg.target_date, cfg.tz_offset);
  const text = `${mainLine(days)}\n${dailyExtraLine(cfg.tz_offset)}`;
  return sendWithRandomImage(ctx, chatId, text);
});

// /setdate — ТОЛЬКО владелец (в группах)
// формат: YYYY-MM-DD или DD.MM.YYYY
bot.command('setdate', (ctx) => {
  const chatId = String(ctx.chat.id);
  ensureChat(chatId, ctx.chat.type);

  if (isGroup(ctx) && !isOwner(ctx)) return; // игнор
  if (!isGroup(ctx) && !isOwner(ctx)) {
    // в личке тоже ограничим изменение даты только владельцу
    return;
  }

  const arg = ctx.message.text.replace(/^\/setdate(@\w+)?\s*/i, '').trim();
  if (!arg) return ctx.reply('Напиши дату: /setdate 2025-09-10 или /setdate 10.09.2025');

  const dt = parseDate(arg);
  if (!dt) return ctx.reply('Дата неверная. Пример: 2025-09-10');

  store[chatId].target_date = dt.toFormat('yyyy-LL-dd');
  saveStore(store);

  const days = calcDaysLeft(store[chatId].target_date, store[chatId].tz_offset);
  const text = `${mainLine(days)}\n${dailyExtraLine(store[chatId].tz_offset)}`;
  return ctx.reply(`Дата установлена: ${dt.toFormat('dd.LL.yyyy')}\n\nКоманда для всех: /date\n\n${text}`);
});

// /tz — ТОЛЬКО владелец
bot.command('tz', (ctx) => {
  const chatId = String(ctx.chat.id);
  ensureChat(chatId, ctx.chat.type);

  if (!isOwner(ctx)) return; // только владелец

  const arg = ctx.message.text.replace(/^\/tz(@\w+)?\s*/i, '').trim();
  const norm = normalizeTzOffset(arg);
  if (!norm) return ctx.reply('Формат: /tz +04:00 (или -03:00 и т.д.)');

  store[chatId].tz_offset = norm;
  saveStore(store);
  return ctx.reply(`Часовой пояс установлен: ${norm}`);
});

// игнор любых прочих сообщений
bot.on('message', (ctx) => {
  if (!ctx.message.text?.startsWith('/')) return; // не отвечаем на болтовню
});

// ====== ПЛАНИРОВЩИК: каждую минуту проверяем 08:00 ======
setInterval(async () => {
  for (const chatId of Object.keys(store)) {
    const cfg = store[chatId];
    if (!cfg?.notify || !cfg?.target_date) continue;

    const zone = `UTC${cfg.tz_offset}`;
    const now = DateTime.now().setZone(zone);
    const isEight = (now.hour === 8 && now.minute === 0);
    const today = now.startOf('day').toISODate();

    if (isEight && cfg.last_notified_iso !== today) {
      try {
        const days = calcDaysLeft(cfg.target_date, cfg.tz_offset);
        const text = `${mainLine(days)}\n${dailyExtraLine(cfg.tz_offset)}`;
        await sendWithRandomImage(bot, chatId, text);
        cfg.last_notified_iso = today;
        saveStore(store);
      } catch (e) {
        console.error('notify error:', e.message);
      }
    }
  }
}, 60 * 1000);

bot.launch().then(() => console.log('Бот запущен (owner-only admin, /date, фото, авто-08:00)'));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
