'use strict';
// LOGIC-START – reine Rechenlogik ohne DOM
const MAX_MONTHS = 600;     // Prognose höchstens 50 Jahre
const NEVER_PREVIEW = 120;  // so weit wird eine nie tilgbare Schuld noch geplant
const SLOTS = 8;            // Anzahl Schulden-Farben

const pad2 = n => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad2(m)}-${pad2(d)}`;
const parseYMD = s => { const [y, m, d] = String(s).split('-').map(Number); return { y, m, d }; };
const daysIn = (y, m) => new Date(y, m, 0).getDate();
const isYMD = s => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const { y, m, d } = parseYMD(s);
  return y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= daysIn(y, m);
};
const monthIdx = s => { const { y, m } = parseYMD(s); return y * 12 + m - 1; };
const idxToYM = i => ({ y: Math.floor(i / 12), m: (i % 12) + 1 });
const todayStr = (now = new Date()) => ymd(now.getFullYear(), now.getMonth() + 1, now.getDate());
const firstOfNextMonth = t => { const { y, m } = idxToYM(monthIdx(t) + 1); return ymd(y, m, 1); };
const round2 = x => Math.round(x * 100) / 100;
const round4 = x => Math.round(x * 10000) / 10000;
const cents = x => Math.round((Number(x) || 0) * 100);
const uid = () => 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// Fälligkeit der k-ten Rate; kurze Monate kappen den Tag (31. → 28./30.)
function dueDate(first, day, k) {
  const { y, m } = idxToYM(monthIdx(first) + k);
  return ymd(y, m, Math.min(day, daysIn(y, m)));
}

// Liest "1.234,56", "12,5" oder "1500.50"; money=true deutet "1.500" als 1500
function parseNum(input, money = true) {
  let s = String(input ?? '').trim().replace(/[\s €%]/g, '');
  if (!s) return NaN;
  const c = s.lastIndexOf(','), p = s.lastIndexOf('.');
  if (c >= 0 && p >= 0) s = c > p ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (c >= 0) s = s.split(',').length > 2 ? s.replace(/,/g, '') : s.replace(',', '.');
  else if (p >= 0) {
    const parts = s.split('.');
    if (parts.length > 2 || (money && parts[1].length === 3)) s = parts.join('');
  }
  return /^(\d+\.?\d*|\.\d+)$/.test(s) ? Number(s) : NaN;
}

// Sondertilgung: einmalige Zahlung an einem Datum; settled = schon im Restbetrag enthalten (nach dem Bearbeiten)
function normalizeExtra(o) {
  if (!o || typeof o !== 'object') return null;
  const amount = typeof o.amount === 'number' ? o.amount : typeof o.amount === 'string' && o.amount.trim() ? parseNum(o.amount, true) : NaN;
  if (!(amount >= 0.01 && amount <= 1e10) || !isYMD(o.date)) return null;
  return {
    id: typeof o.id === 'string' && o.id.trim() ? o.id.trim().slice(0, 40) : uid(),
    date: o.date,
    amount: round2(amount),
    settled: o.settled === true
  };
}
const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

// Prüft und bereinigt eine Schuld (aus Speicher oder Import); ungültig → null
function normalizeDebt(o) {
  if (!o || typeof o !== 'object') return null;
  const money = v => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? parseNum(v, true) : NaN);
  const pct = v => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? parseNum(v, false) : NaN);
  const name = String(o.name ?? '').trim().slice(0, 60);
  const amount = money(o.amount);
  const rate = o.rate == null || o.rate === '' ? 0 : pct(o.rate);
  const mode = o.mode === 'percent' ? 'percent' : 'fixed';
  const payment = money(o.payment), percent = pct(o.percent), minPayment = money(o.minPayment);
  if (!name || !(amount >= 0 && amount <= 1e10) || !(rate >= 0 && rate <= 100) || !isYMD(o.firstDue)) return null;
  if (mode === 'fixed' && !(payment >= 0.01 && payment <= 1e10)) return null;
  if (mode === 'percent' && !(percent > 0 && percent <= 100 && minPayment >= 0.01 && minPayment <= 1e10)) return null;
  const start = money(o.startAmount);
  const day = Number(o.dueDay);
  return {
    id: typeof o.id === 'string' && o.id.trim() ? o.id.trim().slice(0, 40) : uid(),
    name,
    amount: round2(amount),
    startAmount: round2(Math.max(start >= 0 && start <= 1e10 ? start : 0, amount)),
    rate: round4(rate),
    mode,
    payment: payment >= 0 && payment <= 1e10 ? round2(payment) : 0,
    percent: percent >= 0 && percent <= 100 ? round4(percent) : 0,
    minPayment: minPayment >= 0 && minPayment <= 1e10 ? round2(minPayment) : 0,
    firstDue: o.firstDue,
    dueDay: Number.isInteger(day) && day >= 1 && day <= 31 ? day : parseYMD(o.firstDue).d,
    color: Number.isInteger(o.color) && o.color >= 0 && o.color < SLOTS ? o.color : null,
    createdAt: isYMD(o.createdAt) ? o.createdAt : null,
    extras: Array.isArray(o.extras) ? o.extras.slice(0, 1000).map(normalizeExtra).filter(Boolean).sort(byDate) : []
  };
}

// Jede Schuld behält ihre Farbe; doppelte oder fehlende bekommen die erste freie, ab der 9. gibt es Grau
function assignColors(list) {
  const used = new Set();
  for (const d of list) {
    if (Number.isInteger(d.color) && d.color >= 0 && d.color < SLOTS && !used.has(d.color)) used.add(d.color);
    else d.color = null;
  }
  for (const d of list) {
    if (d.color !== null) continue;
    let c = -1;
    for (let i = 0; i < SLOTS; i++) if (!used.has(i)) { c = i; break; }
    d.color = c;
    if (c >= 0) used.add(c);
  }
  return list;
}

// Monat für Monat: Zinsen (Zinssatz/12) aufschlagen, dann Rate abziehen – alles in Cent.
// Sondertilgungen senken den Restbetrag an ihrem Datum, vor der nächsten Rate.
function simulate(d, today) {
  const r = d.rate / 1200;
  const fixed = cents(d.payment), min = cents(d.minPayment), share = d.percent / 100;
  const extras = (d.extras || []).filter(x => !x.settled);
  let bal = cents(d.amount), current = bal, never = false, future = 0, xi = 0;
  const rows = [], events = [];
  const applyExtras = upTo => {
    while (xi < extras.length && extras[xi].date <= upTo && bal > 0) {
      const x = extras[xi++];
      const pay = Math.min(cents(x.amount), bal);
      bal -= pay;
      // Sondertilgungen bis einschließlich heute gelten als gezahlt
      const ev = { type: 'extra', id: x.id, date: x.date, pay, interest: 0, rest: bal, future: x.date > today };
      events.push(ev);
      if (!ev.future) current = bal;
    }
  };
  for (let k = 0; k < 6000 && bal > 0; k++) {
    const date = dueDate(d.firstDue, d.dueDay, k);
    applyExtras(date);
    if (bal <= 0) break;
    const isFuture = date >= today;
    if (isFuture && ++future > (never ? NEVER_PREVIEW : MAX_MONTHS)) break;
    const interest = Math.round(bal * r);
    const owed = bal + interest;
    let pay = d.mode === 'percent' ? Math.max(Math.round(owed * share), min) : fixed;
    if (pay > owed) pay = owed;
    const rest = owed - pay;
    if (isFuture && rest >= bal) never = true;
    const row = { type: 'rate', date, pay, interest, rest, future: isFuture };
    rows.push(row);
    events.push(row);
    if (!isFuture) current = rest;
    bal = rest;
    if (bal > 1e14) { never = true; break; }
  }
  return { rows, events, current, never, open: bal };
}

function analyze(d, today) {
  const sim = simulate(d, today);
  const upcoming = sim.rows.filter(r => r.future);
  const plan = sim.events.filter(e => e.future); // künftige Raten und Sondertilgungen
  let status = 'long';
  if (sim.current <= 0) status = 'paid';
  else if (sim.open <= 0) status = 'ok';
  else if (sim.never) status = 'never';
  const last = status === 'ok' ? plan[plan.length - 1] : null;
  const finite = status === 'ok' || status === 'paid';
  const start = Math.max(cents(d.startAmount), cents(d.amount));
  return {
    debt: d,
    upcoming,
    plan,
    events: sim.events,
    current: sim.current,
    status,
    payoff: last ? last.date : null,
    months: last ? monthIdx(last.date) - monthIdx(today) : (status === 'paid' ? 0 : Infinity),
    interestLeft: finite ? upcoming.reduce((s, r) => s + r.interest, 0) : Infinity,
    totalLeft: finite ? plan.reduce((s, r) => s + r.pay, 0) : Infinity,
    next: upcoming[0] || null,
    progress: start > 0 ? Math.min(1, Math.max(0, 1 - sim.current / start)) : 1
  };
}

function summarize(list, today) {
  const active = list.filter(a => a.status !== 'paid');
  const blocked = active.filter(a => a.status !== 'ok');
  let payoff = null;
  if (active.length && !blocked.length) for (const a of active) if (!payoff || a.payoff > payoff) payoff = a.payoff;
  const start = list.reduce((s, a) => s + Math.max(cents(a.debt.startAmount), cents(a.debt.amount)), 0);
  const current = list.reduce((s, a) => s + a.current, 0);
  return {
    active,
    blocked,
    payoff,
    current,
    months: payoff ? monthIdx(payoff) - monthIdx(today) : (active.length ? Infinity : 0),
    monthly: active.reduce((s, a) => s + (a.next ? a.next.pay : 0), 0),
    interestLeft: blocked.length ? Infinity : active.reduce((s, a) => s + a.interestLeft, 0),
    progress: start > 0 ? Math.min(1, Math.max(0, 1 - current / start)) : 0
  };
}

// Restschuld je Schuld pro Monat: Punkt 0 = heute, Punkt i = nach den Raten im Monat (heute + i − 1)
function chartSeries(list, today) {
  const ok = list.filter(a => a.status === 'ok');
  if (!ok.length) return null;
  const m0 = monthIdx(today);
  let horizon = 1;
  for (const a of ok) horizon = Math.max(horizon, monthIdx(a.payoff) - m0);
  const n = horizon + 2;
  const valuesOf = a => {
    const byMonth = new Map();
    for (const r of a.plan) byMonth.set(monthIdx(r.date), r.rest);
    const vals = new Array(n);
    let v = a.current;
    vals[0] = v;
    for (let i = 1; i < n; i++) {
      const k = m0 + i - 1;
      if (byMonth.has(k)) v = byMonth.get(k);
      vals[i] = v;
    }
    return vals;
  };
  const series = [];
  const other = { id: 'other', name: 'Weitere', color: -1, vals: new Array(n).fill(0), payoff: '' };
  for (const a of ok) {
    const vals = valuesOf(a);
    if (a.debt.color >= 0) series.push({ id: a.debt.id, name: a.debt.name, color: a.debt.color, vals, payoff: a.payoff });
    else {
      vals.forEach((v, i) => { other.vals[i] += v; });
      if (a.payoff > other.payoff) other.payoff = a.payoff;
    }
  }
  if (other.vals[0] > 0) series.push(other);
  for (const s of series) {
    const e = s.vals.findIndex(v => v <= 0);
    s.end = e < 0 ? n - 1 : e;
  }
  series.sort((p, q) => q.end - p.end || (p.id < q.id ? -1 : 1)); // längste Laufzeit liegt unten
  return { m0, n, series };
}

function parseImport(text) {
  let data;
  try { data = JSON.parse(String(text).replace(/^﻿/, '')); }
  catch (e) { return { error: 'Das ist kein gültiges JSON. Nutze eine Datei oder einen Text, den du hier exportiert hast.' }; }
  const arr = Array.isArray(data) ? data : data && Array.isArray(data.debts) ? data.debts : null;
  if (!arr) return { error: 'In den Daten wurden keine Schulden gefunden.' };
  if (!arr.length) return { error: 'Die Daten enthalten keine Schulden.' };
  const list = arr.map(normalizeDebt).filter(Boolean);
  if (!list.length) return { error: 'Keiner der Einträge ist gültig. Prüfe Betrag, Rate und Datum.' };
  return { list, skipped: arr.length - list.length };
}

// Beispieldaten: nächste Fälligkeit ab heute
function demoDebts(now = new Date()) {
  const next = day => {
    let y = now.getFullYear(), m = now.getMonth() + 1;
    if (now.getDate() > day) { m += 1; if (m > 12) { m = 1; y += 1; } }
    return ymd(y, m, Math.min(day, daysIn(y, m)));
  };
  return assignColors([
    { id: 'demo-auto', name: 'Autokredit', amount: 9800, startAmount: 15000, rate: 5.9, mode: 'fixed', payment: 289, firstDue: next(1), dueDay: 1, color: 0 },
    { id: 'demo-karte', name: 'Kreditkarte', amount: 2400, startAmount: 3000, rate: 18.9, mode: 'percent', percent: 5, minPayment: 50, firstDue: next(15), dueDay: 15, color: 1 },
    { id: 'demo-laptop', name: 'Ratenkauf Laptop', amount: 1200, startAmount: 1500, rate: 0, mode: 'fixed', payment: 100, firstDue: next(28), dueDay: 28, color: 2 }
  ].map(normalizeDebt).filter(Boolean));
}
// LOGIC-END

// ===== Oberfläche =====
const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const nfEUR = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const nfEUR0 = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 0 });
const nfDec = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 4 });
const nfAmt = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dfMonthLong = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' });
const dfMonthShort = new Intl.DateTimeFormat('de-DE', { month: 'short', year: 'numeric' });
const dfDayMonth = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit' });
const dfDate = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const dfShort = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });

const eur = c => nfEUR.format(c / 100);
const eur0 = c => nfEUR0.format(Math.round(c / 100));
const eurVal = e => (Number.isInteger(e) ? nfEUR0 : nfEUR).format(e);
const pctTxt = v => `${nfDec.format(v)} %`;
const toDate = s => { const { y, m, d } = parseYMD(s); return new Date(y, m - 1, d); };
const ymDate = i => { const { y, m } = idxToYM(i); return new Date(y, m - 1, 1); };
const monthLong = s => dfMonthLong.format(toDate(s));
const monthShort = s => dfMonthShort.format(toDate(s)).replace(/ /g, ' ');
const dateTxt = s => dfDate.format(toDate(s));
const monthsTxt = n => `${n} ${n === 1 ? 'Monat' : 'Monaten'}`;
const ratesTxt = n => `${n} ${n === 1 ? 'Rate' : 'Raten'}`;
const yearsTxt = m => `≈ ${nfDec.format(Math.round(m / 6) / 2)} Jahre`;
const colorVar = c => (c >= 0 ? `var(--s${c + 1})` : 'var(--s0)');
const inputMoney = e => (Number.isInteger(e) ? String(e) : String(round2(e)).replace('.', ','));
const inputPct = v => String(round4(v)).replace('.', ',');
const payShort = d => (d.mode === 'percent' ? `${pctTxt(d.percent)}, mind. ${eurVal(d.minPayment)}` : `${eurVal(d.payment)} mtl.`);
const payLong = d => (d.mode === 'percent' ? `${pctTxt(d.percent)} vom Restbetrag, mind. ${eurVal(d.minPayment)}` : `${eurVal(d.payment)} pro Monat`);

const ICON_X = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5 5 15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const ICONS = {
  check: '<path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  warn: '<path d="M8 2 14.6 13.5H1.4z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 6.4v3.1M8 11.6v.1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'
};
const iconHTML = name => `<svg class="ico" viewBox="0 0 16 16" aria-hidden="true">${ICONS[name]}</svg>`;
function icon(name) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 16 16');
  s.setAttribute('class', 'ico');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICONS[name];
  return s;
}

const state = { debts: [], demo: false, payMonths: 3 };
let view = null;
const chart = { data: null, geom: null, i: null, width: 0 };

function render() {
  const t = todayStr();
  if (state.demo && !state.debts.length) state.demo = false;
  const list = state.debts.map(d => analyze(d, t));
  const sum = summarize(list, t);
  view = { t, list, sum };
  const has = list.length > 0;
  $('#empty').hidden = has;
  for (const id of ['overview', 'debts-sec', 'foot', 'fab']) $('#' + id).hidden = !has;
  closeFabMenu();
  $('#demo-banner').hidden = !(has && state.demo);
  $('#storage-warn').hidden = storageOK || state.demo || !has;
  if (!has) {
    chart.data = null;
    chart.geom = null;
    $('#pay-sec').hidden = true;
    return;
  }
  renderHero(sum);
  renderStats(sum);
  chart.data = chartSeries(list, t);
  renderChart();
  renderLegend(list);
  renderDebts(list);
  renderPayments(list, t);
  $('#storage-info').textContent = state.demo
    ? 'Beispieldaten werden nicht gespeichert.'
    : storageOK
      ? 'Deine Daten liegen nur in diesem Browser (localStorage). Sichere sie ab und zu über „Einstellungen“.'
      : 'Speichern ist in diesem Browser nicht möglich. Exportiere deine Daten, bevor du die Seite schließt.';
}

function renderHero(sum) {
  const hero = $('#hero'), sub = $('#hero-sub');
  const set = (eyebrow, big, unit, text, mode) => {
    $('#hero-eyebrow').textContent = eyebrow;
    $('#hero-n').textContent = big;
    $('#hero-unit').textContent = unit;
    hero.classList.toggle('is-word', mode !== 'number');
    hero.classList.toggle('is-alert', mode === 'alert');
    sub.replaceChildren();
    if (mode === 'alert') sub.append(icon('warn'));
    sub.append(el('span', '', text));
  };
  if (!sum.active.length) return set('Geschafft', 'Schuldenfrei', '', 'Alle erfassten Schulden sind abbezahlt.', 'word');
  if (sum.blocked.length) {
    const names = sum.blocked.map(a => a.debt.name).join(', ');
    const never = sum.blocked.some(a => a.status === 'never');
    return set('Schuldenfrei', 'Nicht absehbar', '', never
      ? `Bei ${names} deckt die Rate die Zinsen nicht.`
      : `Bei ${names} dauert die Tilgung länger als 50 Jahre.`, 'alert');
  }
  if (sum.months <= 0) return set('Schuldenfrei', 'Diesen Monat', '', `Die letzte Rate ist am ${dateTxt(sum.payoff)} fällig.`, 'word');
  set('Schuldenfrei in', String(sum.months), sum.months === 1 ? 'Monat' : 'Monaten',
    `im ${monthLong(sum.payoff)}${sum.months >= 24 ? ` · ${yearsTxt(sum.months)}` : ''}`, 'number');
}

function renderStats(sum) {
  $('#st-rest').textContent = eur0(sum.current);
  $('#st-rate').textContent = eur0(sum.monthly);
  $('#st-int').textContent = Number.isFinite(sum.interestLeft) ? eur0(sum.interestLeft) : '–';
  const p = Math.round(sum.progress * 100);
  $('#meter-fill').style.width = `${p}%`;
  $('#meter-bar').setAttribute('aria-valuenow', String(p));
  $('#meter-label').textContent = `${p} % getilgt`;
}

// ----- Verlauf (gestapelte Fläche) -----
const cbox = $('#chart-box');

function niceScale(maxE) {
  if (!(maxE > 0)) return { step: 1, max: 1 };
  const raw = maxE / 3;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const r = raw / pow;
  const m = r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10;
  const step = m * pow;
  return { step, max: Math.ceil(maxE / step - 1e-9) * step };
}

function renderChart() {
  const data = chart.data;
  $('#chart-fig').hidden = !data;
  if (!data) { cbox.replaceChildren(); chart.geom = null; return; }
  chart.width = Math.round(cbox.clientWidth);
  const W = Math.max(240, chart.width || 340);
  const H = Math.round(Math.min(250, Math.max(176, W * 0.52)));
  const pad = { t: 18, r: 2, b: 26, l: 2 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const n = data.n;
  const X = i => pad.l + (i * iw) / (n - 1);
  let base = new Array(n).fill(0);
  const stack = data.series.map(s => {
    const bot = base;
    const top = s.vals.map((v, i) => bot[i] + v);
    base = top;
    return { ...s, bot, top, fill: colorVar(s.color) };
  });
  const totals = base;
  const sc = niceScale(Math.max(...totals) / 100);
  const Y = c => pad.t + ih - (c / 100 / sc.max) * ih;
  const f = v => v.toFixed(1);
  const hair = y => Math.round(y) + 0.5;
  const out = [`<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true" focusable="false">`];
  for (let k = 1; k * sc.step <= sc.max + sc.step / 1000; k++) {
    const v = k * sc.step;
    const y = hair(Y(v * 100));
    out.push(`<line class="grid" x1="0" x2="${W}" y1="${y}" y2="${y}"/><text class="tick" x="${W - 2}" y="${f(y - 5)}" text-anchor="end">${esc(nfEUR0.format(v))}</text>`);
  }
  for (const s of stack) {
    let d = `M${f(X(0))},${f(Y(s.top[0]))}`;
    for (let i = 1; i <= s.end; i++) d += `L${f(X(i))},${f(Y(s.top[i]))}`;
    for (let i = s.end; i >= 0; i--) d += `L${f(X(i))},${f(Y(s.bot[i]))}`;
    out.push(`<path class="area" d="${d}Z" style="fill:${s.fill}"/>`);
  }
  for (const s of stack) {
    let d = '';
    for (let i = 0; i <= s.end; i++) d += `${i ? 'L' : 'M'}${f(X(i))},${f(Y(s.top[i]))}`;
    out.push(`<path class="line" d="${d}" style="stroke:${s.fill}"/>`);
  }
  const y0 = hair(Y(0));
  out.push(`<line class="base" x1="0" x2="${W}" y1="${y0}" y2="${y0}"/>`);
  for (const s of stack) {
    if (s.vals[s.end] <= 0) out.push(`<circle class="mark" cx="${f(X(s.end))}" cy="${f(Y(s.bot[s.end]))}" r="4" style="fill:${s.fill}"/>`);
  }
  const ly = H - 7;
  out.push(`<text class="xlab" x="${pad.l}" y="${ly}">Heute</text>`);
  out.push(`<text class="xlab" x="${W - pad.r}" y="${ly}" text-anchor="end">${esc(dfMonthShort.format(ymDate(data.m0 + n - 2)))}</text>`);
  let lastX = 20;
  for (let i = 1; i < n - 1; i++) {
    const mi = data.m0 + i - 1;
    if (mi % 12 !== 0) continue;
    const x = X(i);
    if (x - lastX < 40 || x > W - 92) continue;
    out.push(`<text class="xlab" x="${f(x)}" y="${ly}" text-anchor="middle">${Math.floor(mi / 12)}</text>`);
    lastX = x;
  }
  out.push(`<line class="xh" id="xh" x1="0" x2="0" y1="${pad.t - 10}" y2="${y0}" visibility="hidden"/><circle class="xh-dot" id="xh-dot" cx="0" cy="0" r="4" visibility="hidden"/></svg>`);
  cbox.innerHTML = out.join('') + '<div class="tip" id="chart-tip" aria-hidden="true"></div>';
  chart.geom = { X, Y, n, stack, totals, W, pad, iw };
  if (chart.i != null) showTip(chart.i);
}

function showTip(i) {
  const g = chart.geom;
  if (!g) return;
  i = Math.max(0, Math.min(g.n - 1, i));
  chart.i = i;
  const x = g.X(i);
  const xh = document.getElementById('xh'), dot = document.getElementById('xh-dot'), tip = document.getElementById('chart-tip');
  xh.setAttribute('x1', x);
  xh.setAttribute('x2', x);
  xh.setAttribute('visibility', 'visible');
  dot.setAttribute('cx', x);
  dot.setAttribute('cy', g.Y(g.totals[i]));
  dot.setAttribute('visibility', 'visible');
  const label = i === 0 ? 'Heute' : dfMonthShort.format(ymDate(chart.data.m0 + i - 1));
  const ul = el('ul', 'tip-l');
  for (const s of [...g.stack].reverse()) {
    const li = el('li');
    const key = el('i', 'key');
    key.style.background = s.fill;
    li.append(key, el('b', 'num', eur0(s.vals[i])), el('span', '', s.name));
    ul.append(li);
  }
  const parts = [el('div', 'tip-h', label), ul];
  if (g.stack.length > 1) {
    const total = el('div', 'tip-t');
    total.append(el('span', '', 'Gesamt'), el('b', 'num', eur0(g.totals[i])));
    parts.push(total);
  }
  tip.replaceChildren(...parts);
  tip.classList.add('show');
  const tw = tip.offsetWidth;
  let left = x + 14;
  if (left + tw > g.W) left = x - 14 - tw;
  if (left < 0) left = Math.max(0, Math.min(g.W - tw, x - tw / 2));
  tip.style.transform = `translateX(${Math.round(left)}px)`;
  $('#chart-live').textContent = `${label}: noch ${eur0(g.totals[i])}`;
}

function hideTip() {
  chart.i = null;
  const tip = document.getElementById('chart-tip');
  if (tip) tip.classList.remove('show');
  for (const id of ['xh', 'xh-dot']) {
    const n = document.getElementById(id);
    if (n) n.setAttribute('visibility', 'hidden');
  }
}

function pointAt(e) {
  const g = chart.geom;
  if (!g) return;
  const r = cbox.getBoundingClientRect();
  showTip(Math.round(((e.clientX - r.left - g.pad.l) / g.iw) * (g.n - 1)));
}
cbox.addEventListener('pointermove', pointAt);
cbox.addEventListener('pointerdown', pointAt);
// Maus: Tooltip verschwindet beim Verlassen. Touch: Tooltip bleibt, bis man außerhalb der Grafik tippt.
cbox.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') hideTip(); });
document.addEventListener('pointerdown', e => {
  if (chart.i != null && !cbox.contains(e.target)) hideTip();
});
cbox.addEventListener('keydown', e => {
  const g = chart.geom;
  if (!g) return;
  if (e.key === 'Escape') { hideTip(); return; }
  const cur = chart.i ?? 0;
  const next = { ArrowRight: cur + 1, ArrowLeft: cur - 1, Home: 0, End: g.n - 1 }[e.key];
  if (next === undefined) return;
  e.preventDefault();
  showTip(next);
});
cbox.addEventListener('focus', () => {
  let keyboard = false;
  try { keyboard = cbox.matches(':focus-visible'); } catch (err) { keyboard = false; }
  if (keyboard && chart.geom && chart.i == null) showTip(0);
});
cbox.addEventListener('blur', hideTip);
if ('ResizeObserver' in window) {
  new ResizeObserver(() => {
    const w = Math.round(cbox.clientWidth);
    if (w && w !== chart.width && chart.data) renderChart();
  }).observe(cbox);
}

function renderLegend(list) {
  const ul = $('#legend'), note = $('#chart-note');
  const data = chart.data;
  ul.replaceChildren();
  ul.hidden = !data || data.series.length < 2;
  if (data) {
    for (const s of [...data.series].reverse()) {
      const li = el('li');
      const sw = el('i', 'sw');
      sw.style.background = colorVar(s.color);
      li.append(sw, el('span', 'lg-name', s.name), el('span', '', `bis ${monthShort(s.payoff)}`));
      ul.append(li);
    }
  }
  const out = list.filter(a => a.status === 'never' || a.status === 'long');
  note.replaceChildren();
  note.hidden = !out.length;
  if (out.length) note.append(icon('warn'), el('span', '', `Nicht im Verlauf: ${out.map(a => a.debt.name).join(', ')}, weil die Tilgung mit dieser Rate nicht absehbar ist.`));
}

// ----- Schuldenliste -----
function renderDebts(list) {
  const ul = $('#debt-list');
  ul.replaceChildren();
  const sorted = [...list].sort((a, b) => (a.status === 'paid') - (b.status === 'paid'));
  for (const a of sorted) {
    const d = a.debt;
    const btn = el('button', a.status === 'paid' ? 'debt is-paid' : 'debt');
    btn.type = 'button';
    btn.dataset.id = d.id;
    btn.style.setProperty('--c', colorVar(d.color));
    const dot = el('span', 'dot');
    dot.setAttribute('aria-hidden', 'true');
    const main = el('span', 'debt-main');
    main.append(el('span', 'debt-name', d.name));
    const info = `${pctTxt(d.rate)} Zins · ${payShort(d)}`;
    if (a.status === 'ok') {
      main.append(el('span', 'debt-meta', `${info} · bis ${monthShort(a.payoff)}`));
    } else if (a.status === 'paid') {
      const s = el('span', 'state good');
      s.append(icon('check'), el('span', '', 'Abbezahlt'));
      main.append(s);
    } else {
      main.append(el('span', 'debt-meta', info));
      const s = el('span', 'state alert');
      s.append(icon('warn'), el('span', '', a.status === 'never' ? 'Rate deckt die Zinsen nicht' : 'Tilgung dauert über 50 Jahre'));
      main.append(s);
    }
    const bar = el('span', 'bar');
    bar.setAttribute('aria-hidden', 'true');
    const fill = el('i');
    fill.style.width = `${Math.round(a.progress * 100)}%`;
    bar.append(fill);
    btn.append(dot, main, el('span', 'debt-amt num', eur(a.current)), bar);
    const li = el('li');
    li.append(btn);
    ul.append(li);
  }
  $('#debts-meta').textContent = `${list.length} ${list.length === 1 ? 'Eintrag' : 'Einträge'}`;
}

// ----- Nächste Zahlungen, nach Monat gruppiert -----
function renderPayments(list, t) {
  const items = [];
  for (const a of list) a.plan.forEach((r, k) => items.push({ a, r, last: a.status === 'ok' && k === a.plan.length - 1 }));
  items.sort((p, q) => (p.r.date < q.r.date ? -1 : p.r.date > q.r.date ? 1 : p.a.debt.name.localeCompare(q.a.debt.name, 'de')));
  const groups = [];
  for (const it of items) {
    const mi = monthIdx(it.r.date);
    let g = groups[groups.length - 1];
    if (!g || g.mi !== mi) { g = { mi, items: [], sum: 0 }; groups.push(g); }
    g.items.push(it);
    g.sum += it.r.pay;
  }
  $('#pay-sec').hidden = !groups.length;
  const box = $('#payments');
  box.replaceChildren();
  for (const g of groups.slice(0, state.payMonths)) {
    const head = el('div', 'pay-head');
    head.append(el('span', '', dfMonthLong.format(ymDate(g.mi))), el('span', 'num', eur(g.sum)));
    const ul = el('ul', 'pay-list');
    for (const it of g.items) {
      const li = el('li', 'pay');
      li.style.setProperty('--c', colorVar(it.a.debt.color));
      const name = el('span', 'pay-name', it.a.debt.name);
      if (it.r.date === t) name.append(el('span', 'tag', 'heute'));
      if (it.r.type === 'extra') name.append(el('span', 'tag tag-extra', 'Sondertilgung'));
      if (it.last) name.append(el('span', 'tag tag-last', 'letzte Rate'));
      const dot = el('span', 'dot');
      dot.setAttribute('aria-hidden', 'true');
      li.append(el('span', 'pay-date num', dfDayMonth.format(toDate(it.r.date))), dot, name, el('span', 'pay-amt num', eur(it.r.pay)));
      ul.append(li);
    }
    box.append(head, ul);
  }
  const left = groups.length - state.payMonths;
  const more = $('#btn-more');
  more.hidden = left <= 0;
  more.textContent = left > 0 ? `Weitere Monate anzeigen · noch ${left}` : '';
  $('#pay-meta').textContent = groups.length ? `bis ${dfMonthShort.format(ymDate(groups[groups.length - 1].mi))}` : '';
}

// ----- Sheet, Meldungen, Rückgängig -----
const sheet = $('#sheet');
const toastEl = $('#toast');

function openSheet(title, build, color) {
  const h = $('#sheet-title');
  h.replaceChildren();
  if (color) {
    const dot = el('span', 'dot');
    dot.style.setProperty('--c', color);
    dot.setAttribute('aria-hidden', 'true');
    h.append(dot);
  }
  h.append(document.createTextNode(title));
  const body = $('#sheet-body');
  body.replaceChildren();
  build(body);
  if (!sheet.open) {
    if (typeof sheet.showModal === 'function') sheet.showModal();
    else sheet.setAttribute('open', '');
  } else {
    (body.querySelector('[autofocus]') || $('#sheet-close')).focus();
  }
  body.scrollTop = 0;
}
function onSheetClose() {
  $('#sheet-body').replaceChildren();
  if (toastEl.parentNode !== document.body) document.body.append(toastEl);
}
function closeSheet() {
  if (!sheet.open) return;
  if (typeof sheet.close === 'function') sheet.close();
  else { sheet.removeAttribute('open'); onSheetClose(); }
}
sheet.addEventListener('close', onSheetClose);
sheet.addEventListener('click', e => { if (e.target === sheet) closeSheet(); });
$('#sheet-close').addEventListener('click', closeSheet);

function toast(msg, action) {
  const host = sheet.open ? sheet : document.body;
  if (toastEl.parentNode !== host) host.append(toastEl);
  toastEl.replaceChildren(el('span', '', msg));
  if (action) {
    const b = el('button', 'toast-act', action.label);
    b.type = 'button';
    b.addEventListener('click', () => { hideToast(); action.run(); });
    toastEl.append(b);
  }
  void toastEl.offsetWidth;
  toastEl.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(hideToast, action ? 6500 : 2800);
}
function hideToast() { toastEl.classList.remove('show'); }

const snapshot = () => ({ debts: JSON.parse(JSON.stringify(state.debts)), demo: state.demo });
function restore(s) {
  state.debts = s.debts;
  state.demo = s.demo;
  persist();
  render();
  closeSheet();
  toast('Wiederhergestellt');
}
function commit(msg, undo) {
  persist();
  render();
  closeSheet();
  if (msg) toast(msg, undo ? { label: 'Rückgängig', run: () => restore(undo) } : null);
}
function deleteDebt(id) {
  const d = state.debts.find(x => x.id === id);
  if (!d) return;
  const before = snapshot();
  state.debts = state.debts.filter(x => x.id !== id);
  commit(`„${d.name}“ gelöscht`, before);
}

// ----- Detailansicht mit Tilgungsplan -----
function openDetail(id) {
  const d = state.debts.find(x => x.id === id);
  if (!d) return;
  const a = analyze(d, todayStr());
  const p = Math.round(a.progress * 100);
  const finite = a.status === 'ok' || a.status === 'paid';
  let status = '';
  if (a.status === 'paid') {
    status = `<p class="status good">${iconHTML('check')}<span>Abbezahlt. Du kannst den Eintrag löschen oder als Erinnerung behalten.</span></p>`;
  } else if (a.status === 'never') {
    const first = a.upcoming[0];
    const need = d.mode === 'fixed' && first
      ? `Die Zinsen liegen anfangs bei ${eur(first.interest)} im Monat, die Rate muss höher sein.`
      : 'Erhöhe den Prozentsatz oder den Mindestbetrag.';
    status = `<p class="status alert">${iconHTML('warn')}<span>Die Rate deckt die Zinsen nicht, die Schuld wächst. ${esc(need)}</span></p>`;
  } else if (a.status === 'long') {
    status = `<p class="status alert">${iconHTML('warn')}<span>Mit dieser Rate dauert die Tilgung länger als 50 Jahre.</span></p>`;
  }
  const payoff = a.status === 'ok'
    ? (a.months <= 0 ? `${monthLong(a.payoff)} · diesen Monat` : `${monthLong(a.payoff)} · in ${monthsTxt(a.months)}`)
    : a.status === 'paid' ? 'Erledigt' : 'Nicht absehbar';
  const rows = a.plan.map((r, k) => {
    const cls = [r.type === 'extra' ? 'is-extra' : '', a.status === 'ok' && k === a.plan.length - 1 ? 'is-last' : ''].filter(Boolean).join(' ');
    const interest = r.type === 'extra' ? '<td class="lbl">Sondertilgung</td>' : `<td>${nfAmt.format(r.interest / 100)}</td>`;
    return `<tr${cls ? ` class="${cls}"` : ''}><td>${dfShort.format(toDate(r.date))}</td><td>${nfAmt.format(r.pay / 100)}</td>${interest}<td>${nfAmt.format(r.rest / 100)}</td></tr>`;
  }).join('');
  const extras = [...d.extras].sort(byDate).reverse().map(x => `
          <li>
            <span class="num xl-date">${esc(dateTxt(x.date))}</span>
            <span class="xl-main"><span class="num">${esc(eur(cents(x.amount)))}</span>${x.settled ? '<span class="tag">im Restbetrag enthalten</span>' : x.date > todayStr() ? '<span class="tag">geplant</span>' : ''}</span>
            <button type="button" class="icon-btn sm" data-del-extra="${esc(x.id)}" aria-label="${esc(`Sondertilgung vom ${dateTxt(x.date)} löschen`)}">${ICON_X}</button>
          </li>`).join('');
  const color = colorVar(d.color);
  openSheet(d.name, body => {
    body.innerHTML = `
      <div class="detail-top" style="--c:${color}">
        <p class="eyebrow">Restbetrag heute</p>
        <p class="detail-amt">${esc(eur(a.current))}</p>
        <span class="bar lg" aria-hidden="true"><i style="width:${p}%"></i></span>
        <p class="hint">${p} % getilgt · Startbetrag ${esc(eur(Math.max(cents(d.startAmount), cents(d.amount))))}</p>
      </div>
      ${status}
      <dl class="kv">
        <div><dt>Rate</dt><dd>${esc(payLong(d))}</dd></div>
        <div><dt>Zinssatz</dt><dd>${esc(pctTxt(d.rate))} p.&nbsp;a.</dd></div>
        <div><dt>Nächste Rate</dt><dd>${a.next ? esc(`${eur(a.next.pay)} am ${dateTxt(a.next.date)}`) : '–'}</dd></div>
        <div><dt>Schuldenfrei</dt><dd>${esc(payoff)}</dd></div>
        <div><dt>Noch zu zahlen</dt><dd>${finite ? esc(`${eur(a.totalLeft)} · ${ratesTxt(a.upcoming.length)}`) : '–'}</dd></div>
        <div><dt>Davon Zinsen</dt><dd>${finite ? esc(eur(a.interestLeft)) : '–'}</dd></div>
      </dl>
      ${extras ? `
      <h3 class="sub-h">Sondertilgungen</h3>
      <ul class="xlist">${extras}</ul>` : ''}
      ${a.plan.length ? `
      <h3 class="sub-h">Tilgungsplan</h3>
      <div class="table-wrap">
        <table class="plan">
          <caption>Beträge in Euro${a.status === 'ok' ? '' : ' · die ersten 10 Jahre'}${d.extras.some(x => !x.settled && x.date > todayStr()) ? ' · inklusive geplanter Sondertilgungen' : ''}</caption>
          <thead><tr><th scope="col">Datum</th><th scope="col">Rate</th><th scope="col">Zinsen</th><th scope="col">Rest</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>` : ''}
      <div class="sheet-actions">
        <button type="button" class="btn" id="dt-edit">Bearbeiten</button>
        ${a.status === 'paid' ? '' : '<button type="button" class="btn ghost" id="dt-extra">Sondertilgung</button>'}
        <button type="button" class="btn ghost danger" id="dt-delete">Löschen</button>
      </div>`;
    $('#dt-edit', body).addEventListener('click', () => openForm(id));
    if (a.status !== 'paid') $('#dt-extra', body).addEventListener('click', () => openExtraForm(id, true));
    $('#dt-delete', body).addEventListener('click', () => deleteDebt(id));
    body.querySelectorAll('[data-del-extra]').forEach(b => b.addEventListener('click', () => deleteExtra(id, b.dataset.delExtra)));
  }, color);
}

// ----- Formular: anlegen & bearbeiten -----
const field = (fid, label, value, placeholder, unit) => `
      <div class="field">
        <label for="${fid}">${label}</label>
        <div class="input"><input id="${fid}" inputmode="decimal" autocomplete="off" placeholder="${placeholder}" value="${esc(value)}" aria-describedby="${fid}-err"><span class="unit">${unit}</span></div>
        <p class="err" id="${fid}-err"></p>
      </div>`;

function readForm(form, isEdit) {
  const val = id => $('#' + id, form).value;
  const mode = $('#f-mode-percent', form).checked ? 'percent' : 'fixed';
  const v = {
    name: val('f-name').trim(),
    amount: parseNum(val('f-amount'), true),
    rate: val('f-rate').trim() === '' ? 0 : parseNum(val('f-rate'), false),
    mode,
    payment: parseNum(val('f-payment'), true),
    percent: parseNum(val('f-percent'), false),
    minPayment: parseNum(val('f-min'), true),
    firstDue: val('f-date')
  };
  const errs = {};
  if (!v.name) errs['f-name'] = 'Bitte gib an, wo die Schuld besteht.';
  const amountOk = isEdit ? v.amount >= 0 && v.amount <= 1e10 : v.amount > 0 && v.amount <= 1e10;
  if (!amountOk) errs['f-amount'] = isEdit ? 'Bitte gib den Restbetrag ein (0 oder mehr).' : 'Bitte gib einen Betrag über 0 ein.';
  if (!(v.rate >= 0 && v.rate <= 100)) errs['f-rate'] = 'Bitte einen Zinssatz von 0 bis 100 eingeben.';
  if (mode === 'fixed') {
    if (!(v.payment >= 0.01 && v.payment <= 1e10)) errs['f-payment'] = 'Bitte gib die monatliche Rate ein.';
  } else {
    if (!(v.percent > 0 && v.percent <= 100)) errs['f-percent'] = 'Bitte einen Wert über 0 bis 100 eingeben.';
    if (!(v.minPayment >= 0.01 && v.minPayment <= 1e10)) errs['f-min'] = 'Bitte gib den Mindestbetrag ein.';
  }
  if (!isYMD(v.firstDue)) errs['f-date'] = 'Bitte wähle ein Datum.';
  for (const k of ['amount', 'payment', 'minPayment']) v[k] = Number.isFinite(v[k]) && v[k] >= 0 ? round2(v[k]) : 0;
  for (const k of ['rate', 'percent']) v[k] = Number.isFinite(v[k]) && v[k] >= 0 ? round4(v[k]) : 0;
  return { v, errs };
}
function showErrs(form, errs) {
  form.querySelectorAll('.err').forEach(p => { p.textContent = ''; });
  form.querySelectorAll('.field.invalid').forEach(f => f.classList.remove('invalid'));
  form.querySelectorAll('[aria-invalid]').forEach(i => i.removeAttribute('aria-invalid'));
  for (const [fid, msg] of Object.entries(errs)) {
    const input = $('#' + fid, form), p = $('#' + fid + '-err', form);
    if (p) p.textContent = msg;
    if (input) {
      input.setAttribute('aria-invalid', 'true');
      input.closest('.field').classList.add('invalid');
    }
  }
}
function clearErr(form, fid) {
  if (!fid) return;
  const p = $('#' + fid + '-err', form);
  if (p) p.textContent = '';
  const input = $('#' + fid, form);
  if (input && input.closest('.field')) {
    input.removeAttribute('aria-invalid');
    input.closest('.field').classList.remove('invalid');
  }
}

function openForm(id) {
  const t = todayStr();
  const d = id ? state.debts.find(x => x.id === id) : null;
  if (id && !d) return;
  const a = d ? analyze(d, t) : null;
  const pre = d ? {
    name: d.name,
    amount: inputMoney(a.current / 100),
    rate: d.rate ? inputPct(d.rate) : '',
    mode: d.mode,
    payment: d.payment ? inputMoney(d.payment) : '',
    percent: d.percent ? inputPct(d.percent) : '',
    minPayment: d.minPayment ? inputMoney(d.minPayment) : '',
    firstDue: a.next ? a.next.date : t
  } : { name: '', amount: '', rate: '', mode: 'fixed', payment: '', percent: '', minPayment: '', firstDue: firstOfNextMonth(t) };
  openSheet(d ? 'Schuld bearbeiten' : 'Neue Schuld', body => {
    body.innerHTML = `
    <form class="form" id="debt-form" novalidate>
      <div class="field">
        <label for="f-name">Wo? <span class="opt">Bank, Karte oder Zweck</span></label>
        <div class="input"><input id="f-name" type="text" maxlength="60" autocomplete="off" placeholder="z. B. Kreditkarte, Autokredit" value="${esc(pre.name)}" aria-describedby="f-name-err"${d ? '' : ' autofocus'}></div>
        <p class="err" id="f-name-err"></p>
      </div>
      <div class="row2">
        ${field('f-amount', d ? 'Restbetrag heute' : 'Wie viel?', pre.amount, '5.000', '€')}
        ${field('f-rate', 'Zinssatz', pre.rate, '0', '% p.&nbsp;a.')}
      </div>
      <fieldset class="field">
        <legend>Rückzahlung</legend>
        <div class="seg">
          <input type="radio" name="f-mode" id="f-mode-fixed" value="fixed"${pre.mode === 'fixed' ? ' checked' : ''}><label for="f-mode-fixed">Festbetrag</label>
          <input type="radio" name="f-mode" id="f-mode-percent" value="percent"${pre.mode === 'percent' ? ' checked' : ''}><label for="f-mode-percent">Prozentual</label>
        </div>
      </fieldset>
      <div class="group" id="grp-fixed">
        ${field('f-payment', 'Monatliche Rate', pre.payment, '250', '€')}
      </div>
      <div class="group" id="grp-percent">
        <div class="row2">
          ${field('f-percent', 'Vom Restbetrag', pre.percent, '3', '%')}
          ${field('f-min', 'Mindestens', pre.minPayment, '25', '€')}
        </div>
        <p class="hint">Die Rate ist ein Anteil vom Restbetrag, aber nie weniger als der Mindestbetrag. Typisch bei Kreditkarten.</p>
      </div>
      <div class="field">
        <label for="f-date">${d ? 'Nächste Rate am' : 'Erste Rate am'}</label>
        <div class="input"><input id="f-date" type="date" value="${esc(pre.firstDue)}" aria-describedby="f-date-hint f-date-err"></div>
        <p class="hint" id="f-date-hint">${d ? 'Ab diesem Datum rechnet die App mit dem Restbetrag oben weiter.' : 'Liegt das Datum in der Vergangenheit, zieht die App die Raten bis heute automatisch ab.'}</p>
        <p class="err" id="f-date-err"></p>
      </div>
      <div class="preview" id="f-preview" aria-live="polite"></div>
      <div class="sheet-actions">
        <button type="submit" class="btn">${d ? 'Speichern' : 'Schuld anlegen'}</button>
        ${d ? '<button type="button" class="btn ghost danger" id="f-delete">Löschen</button>' : ''}
      </div>
    </form>`;
    const form = $('#debt-form', body);
    const syncMode = () => {
      const percent = $('#f-mode-percent', form).checked;
      $('#grp-fixed', form).hidden = percent;
      $('#grp-percent', form).hidden = !percent;
    };
    const dueDayFor = v => (d && v.firstDue === pre.firstDue ? d.dueDay : parseYMD(v.firstDue).d);
    const preview = () => {
      const { v, errs } = readForm(form, !!d);
      delete errs['f-name'];
      const box = $('#f-preview', form);
      box.replaceChildren();
      if (Object.keys(errs).length) {
        box.append(el('span', '', 'Sobald Betrag, Rate und Datum stimmen, siehst du hier die Prognose.'));
        return;
      }
      const probe = normalizeDebt({ ...v, name: v.name || 'Vorschau', startAmount: v.amount, dueDay: dueDayFor(v) });
      if (!probe) { box.append(el('span', '', 'Bitte prüfe die Eingaben.')); return; }
      const r = analyze(probe, todayStr());
      if (r.status === 'ok') {
        box.append(el('strong', '', r.months <= 0 ? 'Schuldenfrei diesen Monat' : `Schuldenfrei in ${monthsTxt(r.months)}`));
        box.append(el('span', '', `${monthLong(r.payoff)} · ${ratesTxt(r.upcoming.length)} · davon Zinsen ${eur(r.interestLeft)}`));
      } else if (r.status === 'paid') {
        box.append(el('strong', '', 'Bereits abbezahlt'));
      } else {
        let msg = 'Mit dieser Rate dauert die Tilgung länger als 50 Jahre.';
        if (r.status === 'never') {
          msg = v.mode === 'fixed' && r.upcoming[0]
            ? `Die Rate deckt die Zinsen nicht. Sie liegen anfangs bei ${eur(r.upcoming[0].interest)} im Monat.`
            : 'Die Rate deckt die Zinsen nicht. Erhöhe den Prozentsatz oder den Mindestbetrag.';
        }
        const line = el('span', 'alert');
        line.append(icon('warn'), el('span', '', msg));
        box.append(line);
      }
    };
    syncMode();
    preview();
    form.addEventListener('change', e => { if (e.target.name === 'f-mode') syncMode(); preview(); });
    form.addEventListener('input', e => { clearErr(form, e.target.id); preview(); });
    form.addEventListener('submit', e => {
      e.preventDefault();
      const { v, errs } = readForm(form, !!d);
      showErrs(form, errs);
      const first = Object.keys(errs)[0];
      if (first) { $('#' + first, form).focus(); return; }
      const fields = { name: v.name, amount: v.amount, rate: v.rate, mode: v.mode, payment: v.payment, percent: v.percent, minPayment: v.minPayment };
      if (d) {
        const dueDay = dueDayFor(v);
        Object.assign(d, fields, { firstDue: v.firstDue, dueDay, startAmount: round2(Math.max(d.startAmount, v.amount)) });
        // Der Restbetrag heute enthält alle Sondertilgungen bis heute schon
        for (const x of d.extras) if (x.date <= t) x.settled = true;
        commit('Änderungen gespeichert');
      } else {
        if (state.demo) { state.debts = []; state.demo = false; }
        state.debts.push({ id: uid(), ...fields, startAmount: v.amount, firstDue: v.firstDue, dueDay: parseYMD(v.firstDue).d, color: null, createdAt: todayStr(), extras: [] });
        assignColors(state.debts);
        commit('Schuld angelegt');
      }
    });
    if (d) $('#f-delete', form).addEventListener('click', () => deleteDebt(d.id));
  });
}

// ----- Sondertilgung -----
// id gesetzt: Schuld steht fest (aus der Detailansicht). Sonst Auswahl aus allen offenen Schulden.
function openExtraForm(id, fromDetail) {
  const t = todayStr();
  const open = state.debts.filter(d => analyze(d, t).status !== 'paid');
  const fixed = id ? state.debts.find(x => x.id === id) : null;
  if (id ? !fixed : !open.length) return;
  const title = fixed ? `Sondertilgung · ${fixed.name}` : 'Sondertilgung';
  openSheet(title, body => {
    body.innerHTML = `
    <form class="form" id="extra-form" novalidate>
      ${fixed ? '' : `
      <div class="field">
        <label for="e-debt">Für welche Schuld?</label>
        <div class="input select"><select id="e-debt">${open.map(d => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('')}</select></div>
      </div>`}
      <div class="row2">
        ${field('e-amount', 'Betrag', '', '1.000', '€')}
        <div class="field">
          <label for="e-date">Am</label>
          <div class="input"><input id="e-date" type="date" value="${esc(t)}" aria-describedby="e-date-err"></div>
          <p class="err" id="e-date-err"></p>
        </div>
      </div>
      <p class="hint">Eine Sondertilgung senkt den Restbetrag sofort. Bei einer festen Rate bist du dadurch früher fertig, bei einer prozentualen Rate sinken die nächsten Raten.</p>
      <div class="preview" id="e-preview" aria-live="polite"></div>
      <div class="sheet-actions">
        <button type="submit" class="btn">Sondertilgung speichern</button>
      </div>
    </form>`;
    const form = $('#extra-form', body);
    const debt = () => fixed || state.debts.find(x => x.id === $('#e-debt', form).value);
    const read = () => {
      const v = { amount: parseNum($('#e-amount', form).value, true), date: $('#e-date', form).value };
      const errs = {};
      if (!(v.amount >= 0.01 && v.amount <= 1e10)) errs['e-amount'] = 'Bitte gib einen Betrag über 0 ein.';
      if (!isYMD(v.date)) errs['e-date'] = 'Bitte wähle ein Datum.';
      if (Number.isFinite(v.amount)) v.amount = round2(v.amount);
      return { v, errs };
    };
    const preview = () => {
      const box = $('#e-preview', form);
      box.replaceChildren();
      const d = debt();
      const { v, errs } = read();
      if (!d || Object.keys(errs).length) {
        box.append(el('span', '', 'Gib Betrag und Datum ein, dann siehst du hier, was die Sondertilgung bringt.'));
        return;
      }
      const now = todayStr();
      const before = analyze(d, now);
      const after = analyze({ ...d, extras: [...d.extras, { id: '__probe', date: v.date, amount: v.amount, settled: false }].sort(byDate) }, now);
      const ev = after.events.find(e => e.id === '__probe');
      const alert = msg => {
        const line = el('span', 'alert');
        line.append(icon('warn'), el('span', '', msg));
        box.append(line);
      };
      if (!ev) { alert('Zu diesem Datum ist die Schuld schon abbezahlt.'); return; }
      if (after.status === 'paid' || (after.status === 'ok' && after.plan[after.plan.length - 1] === ev)) {
        box.append(el('strong', '', `Damit ist „${d.name}“ ${after.status === 'paid' ? 'abbezahlt' : `am ${dateTxt(v.date)} abbezahlt`}`));
      } else if (after.status === 'ok' && before.status === 'ok') {
        const diff = before.months - after.months;
        box.append(el('strong', '', diff > 0 ? `${diff} ${diff === 1 ? 'Monat' : 'Monate'} früher abbezahlt` : 'Gleiche Laufzeit, kleinere Raten'));
      } else if (after.status === 'ok') {
        box.append(el('strong', '', `Abbezahlt im ${monthLong(after.payoff)}`));
      } else {
        alert(after.status === 'never' ? 'Auch danach deckt die Rate die Zinsen nicht.' : 'Auch danach dauert die Tilgung länger als 50 Jahre.');
      }
      const facts = [];
      if (after.status === 'ok' && after.payoff) facts.push(`Ende ${monthLong(after.payoff)}`);
      if (before.status === 'ok' && after.status !== 'never' && after.status !== 'long') {
        const saved = before.interestLeft - after.interestLeft;
        if (saved > 0) facts.push(`${eur(saved)} weniger Zinsen`);
      }
      if (ev.pay < cents(v.amount)) facts.push(`nötig sind nur ${eur(ev.pay)}`);
      if (facts.length) box.append(el('span', '', facts.join(' · ')));
    };
    preview();
    form.addEventListener('input', e => { clearErr(form, e.target.id); preview(); });
    form.addEventListener('change', preview);
    form.addEventListener('submit', e => {
      e.preventDefault();
      const { v, errs } = read();
      showErrs(form, errs);
      const first = Object.keys(errs)[0];
      if (first) { $('#' + first, form).focus(); return; }
      const d = debt();
      if (!d) return;
      const before = snapshot();
      d.extras.push({ id: uid(), date: v.date, amount: v.amount, settled: false });
      d.extras.sort(byDate);
      persist();
      render();
      if (fromDetail) openDetail(d.id);
      else closeSheet();
      toast('Sondertilgung gespeichert', { label: 'Rückgängig', run: () => restore(before) });
    });
  });
}

function deleteExtra(debtId, extraId) {
  const d = state.debts.find(x => x.id === debtId);
  if (!d) return;
  const before = snapshot();
  d.extras = d.extras.filter(x => x.id !== extraId);
  persist();
  render();
  openDetail(debtId);
  toast('Sondertilgung gelöscht', { label: 'Rückgängig', run: () => restore(before) });
}

// ----- Plus-Button mit Auswahl -----
const fabBtn = $('#fab');
const fabMenu = $('#fab-menu');
function openFabMenu() {
  const t = todayStr();
  const hasOpen = state.debts.some(d => analyze(d, t).status !== 'paid');
  $('#m-extra').disabled = !hasOpen;
  $('#m-extra-sub').textContent = hasOpen ? 'Extra-Zahlung auf eine Schuld' : 'Keine offene Schuld';
  fabMenu.hidden = false;
  fabBtn.setAttribute('aria-expanded', 'true');
  fabBtn.classList.add('is-open');
  $('#m-debt').focus();
}
function closeFabMenu() {
  if (fabMenu.hidden) return;
  fabMenu.hidden = true;
  fabBtn.setAttribute('aria-expanded', 'false');
  fabBtn.classList.remove('is-open');
}
fabBtn.addEventListener('click', () => (fabMenu.hidden ? openFabMenu() : closeFabMenu()));
$('#m-debt').addEventListener('click', () => { closeFabMenu(); openForm(); });
$('#m-extra').addEventListener('click', () => { closeFabMenu(); openExtraForm(); });
document.addEventListener('pointerdown', e => {
  if (!fabMenu.hidden && !fabMenu.contains(e.target) && !fabBtn.contains(e.target)) closeFabMenu();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !fabMenu.hidden) { closeFabMenu(); fabBtn.focus(); }
});

// ----- Bedienelemente der Seite -----
$('#btn-empty-add').addEventListener('click', () => openForm());
$('#btn-empty-demo').addEventListener('click', () => {
  state.debts = demoDebts();
  state.demo = true;
  persist();
  render();
});
$('#btn-demo-clear').addEventListener('click', () => {
  const before = snapshot();
  state.debts = [];
  state.demo = false;
  commit('Beispieldaten entfernt', before);
});
$('#debt-list').addEventListener('click', e => {
  const b = e.target.closest('.debt');
  if (b) openDetail(b.dataset.id);
});
$('#btn-more').addEventListener('click', () => {
  state.payMonths += 6;
  if (view) renderPayments(view.list, view.t);
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && view && view.t !== todayStr()) render();
});

// ===== Speichern (localStorage), Import & Export =====
const STORE_KEY = 'restlos.v1';
const OLD_KEYS = ['schuldenfrei.v1']; // Daten aus der Version vor der Umbenennung
const storageOK = (() => {
  try {
    const k = '__schuldenfrei_probe';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch (e) {
    return false;
  }
})();

function readStore() {
  if (!storageOK) return null;
  for (const key of [STORE_KEY, ...OLD_KEYS]) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) return JSON.parse(raw);
    } catch (e) {
      // nächsten Schlüssel versuchen
    }
  }
  return null;
}

function persist() {
  if (!storageOK) return;
  try {
    if (state.demo) localStorage.removeItem(STORE_KEY);
    else localStorage.setItem(STORE_KEY, JSON.stringify({ app: 'Restlos', version: 1, savedAt: new Date().toISOString(), debts: state.debts }));
    OLD_KEYS.forEach(k => localStorage.removeItem(k));
  } catch (e) {
    toast('Speichern hat nicht geklappt. Exportiere deine Daten zur Sicherheit.');
  }
}

const exportJSON = () => JSON.stringify({ app: 'Restlos', version: 1, exportedAt: new Date().toISOString(), debts: state.debts }, null, 2);

// In Claude fragt "Als Datei speichern" über einen Dialog nach; selbst gehostet ist es ein normaler Download.
const claudeHost = window.claude && typeof window.claude.use === 'function' ? window.claude : null;
let downloads;
const downloadsReady = claudeHost
  ? Promise.resolve().then(() => claudeHost.use('downloads')).catch(() => null)
  : Promise.resolve(null);
downloadsReady.then(ns => {
  downloads = ns || null;
  const b = document.getElementById('x-save');
  if (b && claudeHost && !downloads) b.hidden = true;
});

function setDataMsg(msg) {
  const p = document.getElementById('x-msg');
  if (p) p.textContent = msg;
  else toast(msg);
}

async function saveFile() {
  setDataMsg('');
  const json = exportJSON();
  const filename = `restlos-${todayStr()}.json`;
  if (claudeHost) {
    const ns = await downloadsReady;
    if (!ns) { setDataMsg('Als Datei speichern geht hier nicht. Nutze „Kopieren“.'); return; }
    try {
      const res = await ns.save({ filename, data: json });
      if (res && res.status === 'saved') toast('Datei gespeichert');
    } catch (err) {
      const code = err && err.code;
      if (code === 'declined') toast('Export abgebrochen');
      else if (code === 'rate_limited') toast('Bitte kurz warten und dann erneut versuchen.');
      else setDataMsg('Speichern als Datei ist gerade nicht möglich. Nutze „Kopieren“.');
    }
    return;
  }
  try {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (e) {
    setDataMsg('Download nicht möglich. Nutze „Kopieren“.');
  }
}

function copyJSON() {
  setDataMsg('');
  const json = exportJSON();
  const ta = document.getElementById('x-text');
  const fallback = () => {
    ta.value = json;
    ta.hidden = false;
    ta.focus();
    ta.select();
    setDataMsg('Automatisches Kopieren ist hier gesperrt. Der Text unten ist markiert, kopiere ihn von Hand.');
  };
  try {
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') { fallback(); return; }
    navigator.clipboard.writeText(json).then(() => toast('In die Zwischenablage kopiert'), fallback);
  } catch (e) {
    fallback();
  }
}

const readFile = file => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result || ''));
  r.onerror = () => reject(r.error);
  r.readAsText(file);
});

function applyImport(res, how) {
  const before = snapshot();
  const merge = how === 'merge' && !state.demo;
  const ids = new Set(merge ? state.debts.map(d => d.id) : []);
  const incoming = res.list.map(d => {
    const c = { ...d };
    if (ids.has(c.id)) c.id = uid();
    ids.add(c.id);
    return c;
  });
  state.debts = merge ? state.debts.concat(incoming) : incoming;
  state.demo = false;
  assignColors(state.debts);
  const n = incoming.length;
  commit(`${n} ${n === 1 ? 'Schuld' : 'Schulden'} importiert${res.skipped ? ` · ${res.skipped} übersprungen` : ''}`, before);
}

function handleImport(text) {
  const err = document.getElementById('i-err'), choice = document.getElementById('i-choice');
  err.textContent = '';
  choice.hidden = true;
  const res = parseImport(text);
  if (res.error) { err.textContent = res.error; return; }
  if (state.demo || !state.debts.length) { applyImport(res, 'replace'); return; }
  const n = res.list.length;
  const p = el('p');
  p.append(
    el('strong', '', `${n} ${n === 1 ? 'Schuld' : 'Schulden'} gefunden`),
    document.createTextNode(`${res.skipped ? ` (${res.skipped} ungültig, werden übersprungen)` : ''}. Was soll mit deinen ${state.debts.length} vorhandenen Einträgen passieren?`)
  );
  const row = el('div', 'btn-row');
  const replace = el('button', 'btn', 'Ersetzen');
  replace.type = 'button';
  replace.addEventListener('click', () => applyImport(res, 'replace'));
  const add = el('button', 'btn ghost', 'Ergänzen');
  add.type = 'button';
  add.addEventListener('click', () => applyImport(res, 'merge'));
  row.append(replace, add);
  choice.replaceChildren(p, row);
  choice.hidden = false;
  choice.scrollIntoView({ block: 'nearest' });
}

// ----- Darstellung: System, Hell oder Dunkel (js/theme.js setzt sie schon vor dem ersten Zeichnen) -----
const THEME_KEY = 'restlos.theme';
function getTheme() {
  const v = document.documentElement.getAttribute('data-theme');
  return v === 'light' || v === 'dark' ? v : 'system';
}
function setTheme(v) {
  if (v === 'light' || v === 'dark') document.documentElement.setAttribute('data-theme', v);
  else document.documentElement.removeAttribute('data-theme');
  try {
    if (v === 'light' || v === 'dark') localStorage.setItem(THEME_KEY, v);
    else localStorage.removeItem(THEME_KEY);
  } catch (e) {
    // Darstellung gilt dann nur bis zum Neuladen
  }
}

function openSettings() {
  const theme = getTheme();
  const radio = (name, value, label, checked, disabled) =>
    `<input type="radio" name="${name}" id="${name}-${value}" value="${value}"${checked ? ' checked' : ''}${disabled ? ' disabled' : ''}><label for="${name}-${value}">${label}</label>`;
  openSheet('Einstellungen', body => {
    body.innerHTML = `
      <section class="data-sec">
        <h3 class="sub-h" id="s-theme-h">Darstellung</h3>
        <div class="seg three" role="radiogroup" aria-labelledby="s-theme-h">
          ${radio('s-theme', 'system', 'System', theme === 'system')}
          ${radio('s-theme', 'light', 'Hell', theme === 'light')}
          ${radio('s-theme', 'dark', 'Dunkel', theme === 'dark')}
        </div>
      </section>
      <section class="data-sec">
        <h3 class="sub-h" id="s-lang-h">Sprache</h3>
        <div class="seg" role="radiogroup" aria-labelledby="s-lang-h">
          ${radio('s-lang', 'de', 'Deutsch', true)}
          ${radio('s-lang', 'en', 'English <span class="soon">bald</span>', false, true)}
        </div>
        <p class="hint">Weitere Sprachen kommen bald.</p>
      </section>
      <section class="data-sec">
        <h3 class="sub-h">Exportieren</h3>
        <p class="hint">Sichert alle Schulden als JSON, als Backup oder für ein anderes Gerät.</p>
        <div class="btn-row">
          <button type="button" class="btn" id="x-save">Als Datei speichern</button>
          <button type="button" class="btn ghost" id="x-copy">Kopieren</button>
        </div>
        <p class="hint x-msg" id="x-msg" aria-live="polite"></p>
        <textarea class="code" id="x-text" readonly hidden aria-label="Exportierte Daten"></textarea>
      </section>
      <section class="data-sec">
        <h3 class="sub-h">Importieren</h3>
        <p class="hint">Wähle eine exportierte JSON-Datei oder füge den kopierten Text ein.</p>
        <div class="btn-row">
          <button type="button" class="btn ghost" id="i-pick">Datei wählen</button>
          <button type="button" class="btn ghost" id="i-paste-open" aria-expanded="false" aria-controls="i-paste">Text einfügen</button>
        </div>
        <input type="file" id="i-file" class="sr-only" accept=".json,application/json,text/plain" tabindex="-1" aria-hidden="true">
        <div class="paste" id="i-paste" hidden>
          <textarea class="code" id="i-text" placeholder='{ "debts": [ … ] }' aria-label="Daten zum Importieren"></textarea>
          <button type="button" class="btn" id="i-go">Importieren</button>
        </div>
        <p class="err" id="i-err" role="alert"></p>
        <div class="choice" id="i-choice" hidden></div>
      </section>
      <section class="data-sec">
        <h3 class="sub-h">Speicher</h3>
        <p class="hint" id="d-info"></p>
        <div class="btn-row"><button type="button" class="btn ghost danger" id="d-clear">Alle Daten löschen</button></div>
      </section>`;
    const q = s => body.querySelector(s);
    body.querySelectorAll('input[name="s-theme"]').forEach(r => r.addEventListener('change', () => setTheme(r.value)));
    if (claudeHost && downloads === null) q('#x-save').hidden = true;
    q('#x-save').addEventListener('click', saveFile);
    q('#x-copy').addEventListener('click', copyJSON);
    q('#i-pick').addEventListener('click', () => q('#i-file').click());
    q('#i-file').addEventListener('change', async e => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try { handleImport(await readFile(file)); }
      catch (err) { q('#i-err').textContent = 'Die Datei konnte nicht gelesen werden.'; }
    });
    q('#i-paste-open').addEventListener('click', e => {
      const box = q('#i-paste');
      box.hidden = !box.hidden;
      e.currentTarget.setAttribute('aria-expanded', String(!box.hidden));
      if (!box.hidden) q('#i-text').focus();
    });
    q('#i-go').addEventListener('click', () => handleImport(q('#i-text').value));
    q('#d-info').textContent = !storageOK
      ? 'Dieser Browser erlaubt hier kein Speichern. Exportiere deine Daten, bevor du die Seite schließt.'
      : state.demo
        ? 'Gerade siehst du Beispieldaten. Sie werden nicht gespeichert.'
        : 'Deine Daten liegen im localStorage dieses Browsers. Auf anderen Geräten oder nach dem Löschen der Browserdaten sind sie nicht da.';
    const clear = q('#d-clear');
    clear.hidden = !state.debts.length;
    clear.addEventListener('click', () => {
      const before = snapshot();
      state.debts = [];
      state.demo = false;
      commit('Alle Daten gelöscht', before);
    });
  });
}
$('#btn-settings').addEventListener('click', openSettings);
$('#btn-empty-import').addEventListener('click', openSettings);

// ===== Offline (PWA) =====
// Service Worker nur über http(s), nicht beim direkten Öffnen der Datei und nicht in Claude
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !claudeHost) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
// Browser bitten, die Daten nicht automatisch zu löschen
if (storageOK && navigator.storage && typeof navigator.storage.persist === 'function') {
  navigator.storage.persist().catch(() => {});
}

// ===== Start =====
function boot() {
  const saved = readStore();
  const list = saved && Array.isArray(saved.debts) ? saved.debts : Array.isArray(saved) ? saved : null;
  if (list) {
    state.debts = assignColors(list.map(normalizeDebt).filter(Boolean));
    state.demo = false;
  } else {
    state.debts = demoDebts();
    state.demo = true;
  }
  render();
}
boot();
