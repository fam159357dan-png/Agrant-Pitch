// Агрант — Telegram-бот: проверка условий «Ауыл аманаты», расчёт платежа, черновик бизнес-плана.
// Секреты (wrangler secret put): BOT_TOKEN — токен от @BotFather, TG_SECRET — пароль вебхука.
// Базы нет: ответы фермера хранятся прямо в кнопках (callback_data) и в ссылке на план.
// Презентация (index.html, Agrant.pdf) отдаётся Cloudflare как статика, сюда приходят только /tg, /plan, /setup.

const MRP = 4325;                         // МРП 2026, ₸
const RATE = 0.025;                       // 2,5% годовых
const LIMIT = { f: 2500 * MRP, k: 8000 * MRP };
const CHECKED = '09.11.2026';             // дата сверки условий

const Q = {
  t: { q: 'Кто будет получать заём?', cols: 1, o: [['f', 'Физлицо, ИП или КХ'], ['k', 'Сельхозкооператив (СПК)']] },
  g: { q: 'Где будет работать проект?', cols: 1, o: [['s', 'Село'], ['m', 'Малый город'], ['c', 'Областной центр или крупный город']] },
  d: { q: 'Чем занимается хозяйство?', cols: 2, o: [['b', 'Мясной КРС'], ['m', 'Молочный КРС'], ['o', 'Овцы и козы'], ['r', 'Растениеводство'], ['x', 'Другой бизнес']] },
  a: { q: 'Сколько нужно на весь проект?', cols: 3, o: [['3', '3 млн ₸'], ['5', '5 млн ₸'], ['7', '7 млн ₸'], ['10', '10 млн ₸'], ['15', '15 млн ₸'], ['25', '25 млн ₸']] },
  z: { q: 'Чем обеспечите заём (залог)?', cols: 1, o: [['1', 'Своя недвижимость'], ['2', 'Залог родственников'], ['0', 'Залога нет']] },
  p: { q: 'Какую чистую прибыль в год ждёте после запуска?', cols: 2, o: [['1', '1 млн ₸'], ['2', '2 млн ₸'], ['3', '3 млн ₸'], ['5', '5 млн ₸'], ['0', 'Пока не знаю']] },
};
const ORDER = ['t', 'g', 'd', 'a', 'z', 'p'];
const LIVESTOCK = ['b', 'm', 'o'];

const DIR = {
  b: { goal: 'Покупка маточного поголовья КРС мясного направления, расширение стада и продажа молодняка на мясо.',
       risks: [['Болезни и падёж скота', 'плановая вакцинация, ветеринарное сопровождение, страхование поголовья'],
               ['Рост цен на корма', 'заготовка кормов на сезон вперёд, собственный сенокос'],
               ['Цена продажи', 'предварительные договоры с заготовителями и мясокомбинатами']] },
  m: { goal: 'Покупка дойного поголовья и оборудования, продажа молока переработчикам.',
       risks: [['Болезни и падёж скота', 'плановая вакцинация, ветеринарное сопровождение, страхование поголовья'],
               ['Сбыт молока', 'договор с молокоприёмным пунктом или молокозаводом'],
               ['Рост цен на корма', 'заготовка кормов на сезон вперёд']] },
  o: { goal: 'Покупка маточного поголовья овец и коз, продажа молодняка, мяса и шерсти.',
       risks: [['Болезни и падёж', 'плановая вакцинация, ветеринарное сопровождение'],
               ['Зимнее содержание', 'утеплённые кошары, запас кормов'],
               ['Цена продажи', 'договоры с заготовителями']] },
  r: { goal: 'Покупка семян, удобрений и оборудования для посевной, продажа урожая.',
       risks: [['Погода и засуха', 'страхование урожая, устойчивые сорта'],
               ['Цена на зерно', 'хранение и предварительные договоры продажи'],
               ['Поломка техники', 'сервис до сезона, запас запчастей']] },
  x: { goal: 'Открытие или расширение бизнеса в сельской местности.',
       risks: [['Низкий спрос', 'изучение спроса в округе до запуска'],
               ['Рост расходов', 'резерв собственных средств'],
               ['Сбои поставок', 'два и более поставщика']] },
};

const DOCS = [
  'Удостоверение личности и ЭЦП — заявка подаётся онлайн',
  'Регистрация ИП или КХ (для СПК — учредительные документы)',
  'Бизнес-план проекта — черновик готов',
  'Документы на залог: право собственности и оценка (залог родственников — нотариальное согласие собственника)',
  'Документы на землю или помещение для проекта — если есть',
];

// ---------- расчёты ----------
export function annuity(loan, years) {
  const r = RATE / 12, n = years * 12;
  return loan * r / (1 - Math.pow(1 + r, -n));
}

export function calc(s) {
  const need = +s.a * 1e6;
  const loan = Math.min(need, LIMIT[s.t]);
  const years = LIVESTOCK.includes(s.d) ? 7 : 5;
  const pay = annuity(loan, years);
  const profit = +s.p * 1e6;
  return {
    need, loan, years, pay, own: need - loan, limit: LIMIT[s.t],
    over: pay * years * 12 - loan,
    profit,
    payback: profit ? need / profit : 0,
    cover: profit ? profit / (pay * 12) : 0,
  };
}

export function schedule(loan, years) {
  const r = RATE / 12, pay = annuity(loan, years);
  let rest = loan;
  const rows = [];
  for (let y = 1; y <= years; y++) {
    let interest = 0, principal = 0;
    for (let m = 0; m < 12; m++) {
      const i = rest * r;
      interest += i; principal += pay - i; rest -= pay - i;
    }
    rows.push({ y, pay: pay * 12, interest, principal, rest: Math.max(0, rest) });
  }
  return rows;
}

const money = v => Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₸';
const num = (v, d = 1) => v.toFixed(d).replace('.', ',');
const years = n => n + ' ' + (n % 10 === 1 && n % 100 !== 11 ? 'год' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'года' : 'лет');
const label = (k, v) => (Q[k].o.find(o => o[0] === v) || [])[1];

// ответы хранятся строкой "t=f;g=s;d=b" — берём только известные ключи и значения
export function parse(str) {
  const s = {};
  for (const part of String(str || '').split(';')) {
    const [k, v] = part.split('=');
    if (Q[k] && Q[k].o.some(o => o[0] === v)) s[k] = v;
  }
  return s;
}
const pack = s => ORDER.filter(k => s[k] !== undefined).map(k => `${k}=${s[k]}`).join(';');
const nextKey = s => ORDER.find(k => s[k] === undefined);

// ---------- Telegram ----------
function api(env, method, body) {
  return fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }).then(r => r.json()).catch(() => ({}));
}

function keyboard(k, s) {
  const { o, cols } = Q[k], rows = [];
  o.forEach((opt, i) => {
    if (i % cols === 0) rows.push([]);
    rows[rows.length - 1].push({ text: opt[1], callback_data: pack({ ...s, [k]: opt[0] }) });
  });
  return { inline_keyboard: rows };
}

const step = k => `<b>Вопрос ${ORDER.indexOf(k) + 1} из ${ORDER.length}</b>\n${Q[k].q}`;

function ask(env, chat, s) {
  const k = nextKey(s);
  return api(env, 'sendMessage', { chat_id: chat, text: step(k), parse_mode: 'HTML', reply_markup: keyboard(k, s) });
}

const WELCOME = '👋 <b>Здравствуйте! Я Агрант.</b>\n\nПомогу подготовить заявку на льготный заём по программе <b>«Ауыл аманаты»</b>: ' +
  'проверю, подходит ли ваше хозяйство, посчитаю платёж и соберу черновик бизнес-плана.\n\n' +
  '6 коротких вопросов, ответы — кнопками. ИИН и паспорт я не спрашиваю.';

export function resultText(s) {
  const c = calc(s), lines = [];
  lines.push(s.z === '0' ? '⚠️ <b>Проект подходит, но нужен залог</b>' : '✅ <b>Проект подходит под условия программы</b>', '');
  lines.push(`Заём: <b>${money(c.loan)}</b>`);
  lines.push(`Ставка · срок: <b>2,5% · ${years(c.years)}</b>`);
  lines.push(`Платёж в месяц: <b>≈ ${money(c.pay)}</b>`);
  lines.push(`Переплата за весь срок: ${money(c.over)}`);
  if (c.own > 0) lines.push(`Собственные средства: ${money(c.own)} — проект больше лимита ${money(c.limit)}`);
  if (c.profit) lines.push(`Окупаемость проекта: ≈ ${num(c.payback)} ${c.payback < 5 ? 'года' : 'лет'}`, `Прибыль покрывает платежи в ${num(c.cover)} раза`);
  lines.push('');
  if (s.z === '0') lines.push('⚠️ Без залога заём получить сложно. Можно оформить залог родственников с нотариальным согласием. Государство готовит гарантии фонда «Даму» — уточняйте у оператора программы.', '');
  if (c.profit && c.cover < 1.3) lines.push('⚠️ Прибыль впритык покрывает платёж — могут предложить меньшую сумму. Проверьте расчёт прибыли.', '');
  lines.push(`<i>Это черновик. Перед подачей пакет проверяет специалист. Условия сверены с открытыми источниками на ${CHECKED}.</i>`);
  return lines.join('\n');
}

async function onTelegram(req, env, origin) {
  if (req.headers.get('x-telegram-bot-api-secret-token') !== env.TG_SECRET) return new Response('forbidden', { status: 403 });
  const u = await req.json().catch(() => ({}));

  if (u.message) {
    const chat = u.message.chat.id;
    await api(env, 'sendMessage', {
      chat_id: chat, text: WELCOME, parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: '▶️ Начать проверку', callback_data: 'go' }]] },
    });
    return new Response('ok');
  }

  const cb = u.callback_query;
  if (!cb || !cb.message) return new Response('ok');
  const chat = cb.message.chat.id, msg = cb.message.message_id, data = cb.data || '';
  await api(env, 'answerCallbackQuery', { callback_query_id: cb.id });

  if (data === 'go') { await ask(env, chat, {}); return new Response('ok'); }

  if (data.startsWith('docs|')) {
    await api(env, 'sendMessage', {
      chat_id: chat, parse_mode: 'HTML',
      text: '📋 <b>Документы для заявки</b> (типовой список)\n\n' + DOCS.map((d, i) => `${i + 1}. ${d}`).join('\n') +
        '\n\n<i>Часть сведений система подтягивает сама. Точный список уточняйте у оператора программы в вашем районе.</i>',
    });
    return new Response('ok');
  }

  // ответ на вопрос: отмечаем выбор в старом сообщении и задаём следующий вопрос
  const s = parse(data);
  const answered = ORDER.filter(k => s[k] !== undefined);
  const last = answered[answered.length - 1];
  if (!last) return new Response('ok');
  await api(env, 'editMessageText', {
    chat_id: chat, message_id: msg, parse_mode: 'HTML', text: `${step(last)}\n✓ <b>${label(last, s[last])}</b>`,
  });

  if (s.g === 'c') {
    await api(env, 'sendMessage', {
      chat_id: chat, parse_mode: 'HTML',
      text: 'ℹ️ <b>«Ауыл аманаты» — программа для сёл и малых городов.</b>\n\nДля областного центра есть другие меры поддержки бизнеса. Скоро Агрант научится подбирать и их.',
      reply_markup: { inline_keyboard: [[{ text: '🔄 Начать заново', callback_data: 'go' }]] },
    });
    return new Response('ok');
  }

  if (nextKey(s)) { await ask(env, chat, s); return new Response('ok'); }

  await api(env, 'sendChatAction', { chat_id: chat, action: 'typing' });
  await new Promise(r => setTimeout(r, 1200));
  const st = pack(s);
  await api(env, 'sendMessage', {
    chat_id: chat, text: resultText(s), parse_mode: 'HTML',
    reply_markup: { inline_keyboard: [
      [{ text: '📄 Черновик бизнес-плана', url: `${origin}/plan?d=${encodeURIComponent(st)}` }],
      [{ text: '📋 Список документов', callback_data: 'docs|' + st }],
      [{ text: '🔄 Новая проверка', callback_data: 'go' }],
    ] },
  });
  return new Response('ok');
}

// ---------- страница черновика бизнес-плана ----------
export function planPage(s) {
  if (nextKey(s) || s.g === 'c') return null;
  const c = calc(s), dir = DIR[s.d], rows = schedule(c.loan, c.years);
  const today = new Date().toLocaleDateString('ru-RU', { timeZone: 'Asia/Almaty' });
  const tr = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
  const blank = k => `<div class="blank"><span>${k}</span><i></i></div>`;
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Черновик бизнес-плана — Агрант</title>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700;800&family=Unbounded:wght@600&display=swap" rel="stylesheet">
<style>
:root{--ink:#0D1A12;--field:#0F2E1F;--moss:#2E6A49;--wheat:#E4B54E;--cream:#F4EEE1;--muted:#5D6D63;--line:rgba(13,26,18,.12)}
*{box-sizing:border-box}body{margin:0;background:var(--cream);font:16px/1.55 Manrope,sans-serif;color:var(--ink)}
.page{max-width:820px;margin:24px auto;background:#fff;border-radius:20px;padding:44px 48px;box-shadow:0 10px 40px rgba(13,26,18,.08)}
header{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;border-bottom:2px solid var(--wheat);padding-bottom:20px;margin-bottom:8px}
.brand{display:flex;align-items:center;gap:10px;font:600 20px Unbounded,sans-serif}.brand svg{width:34px;height:34px}
h1{font:600 26px/1.2 Unbounded,sans-serif;margin:22px 0 4px}.sub{color:var(--muted);margin:0}
.tag{font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;background:var(--cream);color:var(--moss);padding:6px 10px;border-radius:99px;white-space:nowrap}
h2{font:600 17px Unbounded,sans-serif;margin:34px 0 12px;color:var(--field)}
table{width:100%;border-collapse:collapse}td,th{padding:9px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.kv td:first-child{color:var(--muted)}.kv td:last-child{font-weight:700;text-align:right}
.risk td:first-child{font-weight:700;width:34%}
.sch td,.sch th{text-align:right}.sch td:first-child,.sch th:first-child{text-align:left}
.note{background:#FFF8E6;border-left:4px solid var(--wheat);padding:12px 16px;border-radius:8px;margin-top:14px;font-size:15px}
ul,ol{padding-left:20px;margin:0}li{margin:6px 0}
.blank{display:flex;gap:12px;align-items:flex-end;margin:12px 0}.blank span{white-space:nowrap;color:var(--muted)}.blank i{flex:1;border-bottom:1px dashed #9aa79f;height:1px}
footer{margin-top:34px;padding-top:16px;border-top:1px solid var(--line);font-size:13px;color:var(--muted)}
.btn{position:fixed;right:20px;bottom:20px;background:var(--field);color:#fff;border:0;border-radius:99px;padding:14px 22px;font:700 15px Manrope;cursor:pointer;box-shadow:0 8px 24px rgba(13,26,18,.25)}
@media (max-width:600px){.page{margin:0;border-radius:0;padding:28px 18px}h1{font-size:21px}td,th{padding:8px 4px;font-size:14px}}
@media print{body{background:#fff}.page{box-shadow:none;margin:0;max-width:none;padding:0}.btn{display:none}@page{size:A4;margin:16mm}}
</style></head><body><div class="page">
<header><div class="brand"><svg viewBox="0 0 64 64"><rect width="64" height="64" rx="18" fill="#E4B54E"/><path d="M32 54V18" stroke="#0F2E1F" stroke-width="3.2" stroke-linecap="round"/><g fill="#0F2E1F"><ellipse cx="25.5" cy="43" rx="4.6" ry="8" transform="rotate(-32 25.5 43)"/><ellipse cx="38.5" cy="43" rx="4.6" ry="8" transform="rotate(32 38.5 43)"/><ellipse cx="25.5" cy="31" rx="4.4" ry="7.6" transform="rotate(-32 25.5 31)"/><ellipse cx="38.5" cy="31" rx="4.4" ry="7.6" transform="rotate(32 38.5 31)"/><ellipse cx="32" cy="16" rx="4.2" ry="7.4"/></g></svg>Агрант</div>
<span class="tag">Черновик · ${today}</span></header>
<h1>Бизнес-план проекта: ${label('d', s.d)}</h1>
<p class="sub">Программа льготного микрокредитования «Ауыл аманаты» · ${label('g', s.g).toLowerCase()} · ${label('t', s.t)}</p>

<h2>1. Резюме проекта</h2>
<table class="kv">${tr('Стоимость проекта', money(c.need))}${tr('Сумма займа', money(c.loan))}${c.own > 0 ? tr('Собственные средства', money(c.own)) : ''}${tr('Ставка', '2,5% годовых')}${tr('Срок', years(c.years))}${tr('Ежемесячный платёж', '≈ ' + money(c.pay))}${tr('Обеспечение', label('z', s.z))}</table>

<h2>2. Цель займа</h2>
<p>${dir.goal}</p>

<h2>3. Данные заявителя <span style="font:600 12px Manrope;color:var(--muted)">(заполняет заявитель)</span></h2>
${blank('ФИО или наименование')}${blank('ИИН / БИН')}${blank('Адрес хозяйства')}${blank('Опыт в отрасли')}${blank(s.d === 'r' ? 'Площадь земли, га' : LIVESTOCK.includes(s.d) ? 'Текущее поголовье' : 'Текущая деятельность')}

<h2>4. График погашения по годам</h2>
<table class="sch"><tr><th>Год</th><th>Платежи</th><th>Проценты</th><th>Основной долг</th><th>Остаток</th></tr>
${rows.map(r => `<tr><td>${r.y}</td><td>${money(r.pay)}</td><td>${money(r.interest)}</td><td>${money(r.principal)}</td><td>${money(r.rest)}</td></tr>`).join('')}
<tr><td><b>Итого</b></td><td><b>${money(c.pay * c.years * 12)}</b></td><td><b>${money(c.over)}</b></td><td><b>${money(c.loan)}</b></td><td></td></tr></table>

<h2>5. Окупаемость</h2>
${c.profit ? `<table class="kv">${tr('Ожидаемая чистая прибыль в год', money(c.profit))}${tr('Платежи по займу в год', money(c.pay * 12))}${tr('Прибыль покрывает платежи', 'в ' + num(c.cover) + ' раза')}${tr('Срок окупаемости проекта', '≈ ' + num(c.payback) + ' ' + (c.payback < 5 ? 'года' : 'лет'))}</table>
${c.cover < 1.3 ? '<div class="note">Прибыль впритык покрывает платежи. Проверьте расчёт прибыли или уменьшите сумму займа.</div>' : ''}` :
  '<div class="note">Укажите ожидаемую прибыль — без неё банк не сможет оценить, хватит ли денег на платежи.</div>'}

<h2>6. Риски и как мы их снижаем</h2>
<table class="risk"><tr><th>Риск</th><th>Что делаем</th></tr>${dir.risks.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('')}</table>

<h2>7. Документы для заявки</h2>
<ol>${DOCS.map(d => `<li>${d}</li>`).join('')}</ol>
${s.z === '0' ? '<div class="note">Залога нет. Можно оформить залог родственников с нотариальным согласием собственника. Государство готовит гарантии фонда «Даму» — уточните у оператора программы.</div>' : ''}

<footer>Черновик подготовлен ботом Агрант. Перед подачей его проверяет специалист. Условия программы сверены с открытыми источниками на ${CHECKED}: ставка 2,5%, лимит 2&nbsp;500&nbsp;МРП (${money(LIMIT.f)}), для кооперативов — до 8&nbsp;000&nbsp;МРП (${money(LIMIT.k)}). Уточняйте актуальные условия у оператора программы.</footer>
</div><button class="btn" onclick="print()">Сохранить в PDF</button></body></html>`;
}

// ---------- точка входа ----------
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'POST' && url.pathname === '/tg') return onTelegram(req, env, url.origin);

    if (url.pathname === '/plan') {
      const html = planPage(parse(url.searchParams.get('d')));
      return html ? new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } })
                  : new Response('План не найден: пройдите вопросы в боте заново.', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }

    // одноразовая настройка: вебхук, команды и описание бота
    if (url.pathname === '/setup') {
      if (!env.TG_SECRET || url.searchParams.get('key') !== env.TG_SECRET) return new Response('forbidden', { status: 403 });
      const out = {
        webhook: await api(env, 'setWebhook', { url: url.origin + '/tg', secret_token: env.TG_SECRET, allowed_updates: ['message', 'callback_query'] }),
        commands: await api(env, 'setMyCommands', { commands: [{ command: 'start', description: 'Начать проверку' }] }),
        description: await api(env, 'setMyDescription', { description: 'Агрант помогает фермеру подготовить заявку на льготный заём «Ауыл аманаты»: проверка условий, расчёт платежа и черновик бизнес-плана за несколько минут.' }),
        short: await api(env, 'setMyShortDescription', { short_description: 'Заявка на льготный заём «Ауыл аманаты» за один вечер' }),
        me: await api(env, 'getMe', {}),
      };
      return Response.json(out);
    }
    return new Response('Not found', { status: 404 });
  },
};
