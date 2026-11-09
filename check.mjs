// Проверка бота без Telegram: node check.mjs  → должно вывести OK
import assert from 'node:assert/strict';
import worker, { annuity, calc, schedule, parse, resultText, planPage } from './worker.js';

// расчёт: 10 млн на 7 лет под 2,5% ≈ 129 892 ₸ в месяц (как на слайде)
assert.ok(Math.abs(annuity(10e6, 7) - 129892) < 2, 'платёж 10 млн / 7 лет');
const rows = schedule(10e6, 7);
assert.ok(rows[6].rest < 1, 'долг погашен к концу срока');
assert.ok(Math.abs(rows.reduce((a, r) => a + r.principal, 0) - 10e6) < 1, 'сумма основного долга');

// лимиты: физлицо 2 500 МРП, кооператив 8 000 МРП
assert.equal(calc(parse('t=f;g=s;d=b;a=25;z=1;p=3')).loan, 2500 * 4325);
assert.equal(calc(parse('t=k;g=s;d=b;a=25;z=1;p=3')).loan, 25e6);
assert.equal(calc(parse('t=f;g=s;d=r;a=5;z=1;p=0')).years, 5);

// мусор в ответах отбрасывается
assert.deepEqual(parse('t=f;g=<script>;zz=1'), { t: 'f' });
assert.equal(planPage(parse('t=f;g=s')), null);
assert.ok(resultText(parse('t=f;g=s;d=b;a=10;z=0;p=2')).includes('нужен залог'));

// проход по боту с подменой Telegram
const calls = [];
globalThis.fetch = async (url, init) => { calls.push([url.split('/').pop(), JSON.parse(init.body)]); return new Response('{"ok":true}'); };
const env = { BOT_TOKEN: 'test', TG_SECRET: 's3' };
const tg = body => worker.fetch(new Request('https://agrant.test/tg', {
  method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 's3' }, body: JSON.stringify(body),
}), env);
const cb = data => tg({ callback_query: { id: '1', data, message: { chat: { id: 7 }, message_id: 5 } } });

assert.equal((await worker.fetch(new Request('https://agrant.test/tg', { method: 'POST', body: '{}' }), env)).status, 403, 'без секрета — отказ');
await tg({ message: { chat: { id: 7 }, text: '/start' } });
assert.ok(calls.at(-1)[1].text.includes('Агрант'));
await cb('go');
for (const d of ['t=f', 't=f;g=s', 't=f;g=s;d=b', 't=f;g=s;d=b;a=10', 't=f;g=s;d=b;a=10;z=1', 't=f;g=s;d=b;a=10;z=1;p=3']) await cb(d);
const final = calls.filter(c => c[0] === 'sendMessage').at(-1)[1];
assert.ok(final.text.includes('129 892'), 'итог с платежом');
const planUrl = final.reply_markup.inline_keyboard[0][0].url;
assert.ok(planUrl.startsWith('https://agrant.test/plan?d='));

const page = await worker.fetch(new Request(planUrl), env);
assert.equal(page.status, 200);
const html = await page.text();
assert.ok(html.includes('График погашения') && html.includes('Мясной КРС'));

// город — не подходит
await cb('t=f;g=c');
assert.ok(calls.at(-1)[1].text.includes('сёл и малых городов'));

console.log('OK');
