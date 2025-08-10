import 'dotenv/config';
import { Telegraf, Markup } from 'telegraf';
import { DateTime } from 'luxon';
import fs from 'fs';

// === Конфиг текста ===
// Функция главной строки. Можешь менять формулировку.
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

// Список доп. фраз. Пиши свои 10 штук — будут крутиться по дням.
const EXTRA_LINES = [
  'Если Дениса отпустят к нам',
  'Если Иля решится взять свою бричку и доехать вместе с Расимом',
  // добавляй ещё варианты ниже
  'Если все соберутся без опозданий',
  'Если погода скажет: “да”',
  'Если всё совпадёт как надо',
  'Если таксист найдёт нужный поворот',
  'Если плейлист зайдёт с первого трека',
  'Если кофе будет крепким',
  'Если шутки будут смешными',
  'Если удача будет на нашей стороне'
];

// === Хранилище в файле (перечатовые настройки) ===
const STORE_PATH = process.env.STORE_PATH || './store.json';
function loadStore() {
  try { return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')); }
  catch { return {}; }
}
function saveStore(obj) {
  fs.writeFileSync(STORE_PATH, JSON.stringify(obj, null, 2));
}
let store = loadStore();
// Структура: store[chatId] = { target_date: 'YYYY-MM-DD' | null, tz_offset: '+04:00', notify: false, last_notified_iso: 'YYYY-MM-DD' | null }

function ensureChat(chatId) {
  if (!store[chatId]) {
    store[chatId] = { target_date: null, tz_offset: '+00:00', notify: false, last_notified_iso: null };
    saveStore(store);
  }
}

// === Утилиты дат ===
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
function todayISO(tzOffset) {
  const zone = `UTC${tzOffset}`;
  return DateTime.now().setZone(zone).startOf('day').toISODate();
}
function dailyExtraLine(tzOffset) {
  const zone = `UTC${tzOffset}`;
  const dayIndex = DateTime.now().setZone(zone).ordinal % EXTRA_LINES.length;
  return EXTRA_LINES[dayIndex];
}

// === Бот ===
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// Кнопочное меню (inline-кнопки под сообщением)
function menuKeyboard(chatId) {
  const cfg = store[chatId] || {};
  const notifyLabel = cfg.notify ? '🔕 Отключить 08:00' : '🔔 Включить 08:00';
  return Markup.inlineKeyboard([
    [Markup.button.callback('⏳ Сколько осталось', 'ACTION_LEFT')],
    [Markup.button.callback('📅 Какая дата', 'ACTION_WHEN')],
    [Markup.button.callback(notifyLabel, 'ACTION_TOGGLE_NOTIFY')],
    [Markup.button.callback('🌍 Часовой пояс', 'ACTION_TZ_HELP')],
    [Markup.button.callback('🧼 Сбросить дату', 'ACTION_CLEAR')]
  ]);
}

// /start
bot.start(async (ctx) => {
  const chatId = String(ctx.chat.id);
  ensureChat(chatId);

  // По умолчанию поставим +04:00 (Тбилиси), если ещё не выставлен
  if (store[chatId].tz_offset === '+00:00') {
    store[chatId].tz_offset = '+04:00';
    saveStore(store);
  }

  await ctx.reply(
`Привет! Я считаю, сколько дней осталось до заданной даты.

Команды:
/setdate 2025-09-10  — установить дату (или 10.09.2025)
/tz +04:00           — установить часовой пояс
/left                — показать, сколько осталось
/when                — показать дату
/notify              — вкл/выкл авто-сообщение в 08:00
/clear               — сбросить дату
/menu                — открыть меню-кнопки`,
    menuKeyboard(chatId)
  );
});

// /menu — показать кнопки
bot.command('menu', (ctx) => {
  const chatId = String(ctx.chat.id);
  ensureChat(chatId);
  return ctx.reply('Меню:', menuKeyboard(chatId));
});

// /setdate
bot.command('setdate', (ctx) => {
  const chatId = String(ctx.chat.id);
  ensureChat(chatId);

  const arg = ctx.message.text.replace(/^\/setdate(@\w+)?\s*/i, '').trim();
  if (!arg) return ctx.reply('Напиши дату: /setdate 2025-09-10 или /setdate 10.09.2025');

  const dt = parseDate(arg);
  if (!dt) return ctx.reply('Дата неверная. Пример: 2025-09-10');

  store[chatId].target_date = dt.toFormat('yyyy-LL-dd');
  saveStore(store);

  const days = calcDaysLeft(store[chatId].target_date, store[chatId].tz_offset);
  const text = `${mainLine(days)}\n${dailyExtraLine(store[chatId].tz_offset)}`;
  ctx.reply(`Дата установлена: ${dt.toFormat('dd.LL.yyyy')}\n\n${text}`, menuKeyboard(chatId));
});

// /tz
bot.command('tz', (ctx) => {
  const chatId = String(ctx.chat.id);
  ensureChat(chatId);

  const arg = ctx.message.text.replace(/^\/tz(@\w+)?\s*/i, '').trim();
  const norm = normalizeTzOffset(arg);
  if (!norm) return ctx.reply('Формат: /tz +04:00 (или -03:00 и т.д.)');

  store[chatId].tz_offset = norm;
  saveStore(store);
  ctx.reply(`Часовой пояс установлен: ${norm}`, menuKeyboard(chatId));
});

// /left
bot.command('left', (ctx) => {
  const chatId = String(ctx.chat.id);
  ensureChat(chatId);

  const cfg = store[chatId];
  if (!cfg.target_date) return ctx.reply('Дата не установлена. Сначала: /setdate 2025-09-10');

  const days = calcDaysLeft(cfg.target_date, cfg.tz_offset);
  const text = `${mainLine(days)}\n${dailyExtraLine(cfg.tz_offset)}`;
  ctx.reply(text, menuKeyboard(chatId));
});

// /when
bot.command('when', (ctx) => {
  const chatId = String(ctx.chat.id);
  ensureChat(chatId);

  const cfg = store[chatId];
  if (!cfg.target_date) return ctx.reply('Дата не установлена. /setdate 2025-09-10');
  const zone = `UTC${cfg.tz_offset}`;
  const target = DateTime.fromISO(cfg.target_date, { zone });
  ctx.reply(`Установленная дата: ${target.toFormat('dd.LL.yyyy')} (${cfg.tz_offset})`, menuKeyboard(chatId));
});

// /notify — включить/выключить ежедневные сообщения 08:00
bot.command('notify', (ctx) => {
  const chatId = String(ctx.chat.id);
  ensureChat(chatId);
  store[chatId].notify = !store[chatId].notify;
  saveStore(store);
  ctx.reply(store[chatId].notify ? 'Ежедневные сообщения в 08:00: ВКЛ.' : 'Ежедневные сообщения в 08:00: ВЫКЛ.', menuKeyboard(chatId));
});

// /clear
bot.command('clear', (ctx) => {
  const chatId = String(ctx.chat.id);
  ensureChat(chatId);
  store[chatId].target_date = null;
  saveStore(store);
  ctx.reply('Дата сброшена.', menuKeyboard(chatId));
});

// Обработчики нажатий кнопок
bot.action('ACTION_LEFT', async (ctx) => {
  const chatId = String(ctx.chat.id);
  ensureChat(chatId);
  const cfg = store[chatId];
  if (!cfg.target_date) return ctx.answerCbQuery('Сначала установи дату: /setdate');
  const days = calcDaysLeft(cfg.target_date, cfg.tz_offset);
  const text = `${mainLine(days)}\n${dailyExtraLine(cfg.tz_offset)}`;
  await ctx.editMessageText(text, menuKeyboard(chatId));
});
bot.action('ACTION_WHEN', async (ctx) => {
  const chatId = String(ctx.chat.id);
  ensureChat(chatId);
  const cfg = store[chatId];
  if (!cfg.target_date) return ctx.answerCbQuery('Дата не установлена.');
  const zone = `UTC${cfg.tz_offset}`;
  const target = DateTime.fromISO(cfg.target_date, { zone });
  await ctx.editMessageText(`Установленная дата: ${target.toFormat('dd.LL.yyyy')} (${cfg.tz_offset})`, menuKeyboard(chatId));
});
bot.action('ACTION_TOGGLE_NOTIFY', async (ctx) => {
  const chatId = String(ctx.chat.id);
  ensureChat(chatId);
  store[chatId].notify = !store[chatId].notify;
  saveStore(store);
  await ctx.editMessageText(store[chatId].notify ? 'Ежедневные сообщения в 08:00: ВКЛ.' : 'Ежедневные сообщения в 08:00: ВЫКЛ.', menuKeyboard(chatId));
});
bot.action('ACTION_TZ_HELP', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('Установи часовой пояс командой, пример: /tz +04:00');
});
bot.action('ACTION_CLEAR', async (ctx) => {
  const chatId = String(ctx.chat.id);
  ensureChat(chatId);
  store[chatId].target_date = null;
  saveStore(store);
  await ctx.editMessageText('Дата сброшена.', menuKeyboard(chatId));
});

// === Планировщик 08:00 для каждого чата ===
// Каждую минуту проверяем: если у чата notify=on и сейчас 08:00 в его поясе — шлём сообщение 1 раз в день.
setInterval(async () => {
  for (const chatId of Object.keys(store)) {
    const cfg = store[chatId];
    if (!cfg?.notify || !cfg?.target_date) continue;

    const zone = `UTC${cfg.tz_offset}`;
    const now = DateTime.now().setZone(zone);
    const isEight = now.hour === 8 && now.minute === 0;
    const today = now.startOf('day').toISODate();

    if (isEight && cfg.last_notified_iso !== today) {
      try {
        const days = calcDaysLeft(cfg.target_date, cfg.tz_offset);
        const text = `${mainLine(days)}\n${dailyExtraLine(cfg.tz_offset)}`;
        await bot.telegram.sendMessage(chatId, text);
        cfg.last_notified_iso = today;
        saveStore(store);
      } catch (e) {
        // молча пропустим, чтобы цикл не падал
      }
    }
  }
}, 60 * 1000); // раз в минуту

// Запуск бота
bot.launch().then(() => console.log('Бот запущен (меню + авто-08:00)'));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
