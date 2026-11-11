import { configured, db, doc, getDoc, setDoc, updateDoc, onSnapshot } from './firebase.js';
import { COMPANIES, INDUSTRIES, SEED, TOTAL_ROUNDS } from './config.js';
import { fmt, esc, pctText, cls, mmss, totalOf } from './engine.js';

const app = document.getElementById('app');
const KEY = 'mockinvest_pid';
const store = {
  get() { try { return localStorage.getItem(KEY); } catch (e) { return null; } },
  set(v) { try { v ? localStorage.setItem(KEY, v) : localStorage.removeItem(KEY); } catch (e) { /* 무시 */ } }
};

let pid = store.get();
let state = null;
let stateLoaded = false;
let me = null;
let unsubMe = null;
let draft = {};        // 회사별 목표 보유 수량
let draftRound = 0;
let viewKey = '';
let joinError = '';
let tradeError = '';
let sending = false;

if (!configured) {
  app.innerHTML = '<div class="center"><h2>설정이 필요해요</h2><p>js/config.js에 Firebase 설정값을 넣어 주세요.</p></div>';
} else {
  onSnapshot(doc(db, 'game', 'state'), (s) => {
    state = s.exists() ? s.data() : null;
    stateLoaded = true;
    render();
  }, fatal);
  if (pid) watchMe();
  setInterval(tick, 500);
  app.addEventListener('click', onClick);
  app.addEventListener('input', onInput);
  app.addEventListener('submit', onSubmit);
}

function fatal(e) {
  console.error(e);
  viewKey = '';
  app.innerHTML = '<div class="center"><h2>연결에 문제가 생겼어요</h2><p>인터넷 연결을 확인하고 새로고침해 주세요.</p></div>';
}

function watchMe() {
  if (unsubMe) unsubMe();
  unsubMe = onSnapshot(doc(db, 'players', pid), (s) => {
    if (!s.exists()) { leave(); return; }
    me = s.data();
    render();
  }, fatal);
}

function leave() {
  if (unsubMe) unsubMe();
  unsubMe = null;
  pid = null;
  me = null;
  draftRound = 0;
  store.set(null);
  render();
}

/* ───────── 공통 ───────── */
const prices = () => state.history[state.history.length - 1];
const prevPrices = () => (state.history.length > 1 ? state.history[state.history.length - 2] : null);
const myTotal = () => totalOf(me.cash, me.holdings || {}, prices());
const cumPct = () => (myTotal() / SEED - 1) * 100;

function setView(key, html) {
  viewKey = key;
  app.innerHTML = html;
}

function head() {
  return '<header class="top"><span class="brand">경제인의 밤 모의투자</span>' +
    '<button class="link" data-act="leave">' + esc(me.name) + ' · 나가기</button></header>';
}

function bars() {
  let h = '<div class="bars">';
  for (let i = 1; i <= TOTAL_ROUNDS; i++) h += '<i class="' + (state && i <= state.round ? 'on' : '') + '"></i>';
  return h + '</div>';
}

function assetCard() {
  const total = myTotal();
  const cum = cumPct();
  const stock = total - me.cash;
  const rank = me.rank ? '현재 순위 <b style="color:var(--text)">' + me.rank + '위</b>' : '';
  return '<div class="card" style="display:flex;flex-direction:column;gap:12px">' +
    '<div style="display:flex;justify-content:space-between" class="sub"><span style="font-size:13px">내 총자산</span><span style="font-size:13px">' + rank + '</span></div>' +
    '<div style="display:flex;align-items:baseline;gap:10px"><span class="big">' + fmt(total) + '원</span>' +
    '<b class="' + cls(cum) + '" style="font-size:15px">' + pctText(cum, 2) + '</b></div>' +
    '<div class="grid2"><div class="mini"><span>현금</span><b>' + fmt(me.cash) + '원</b></div>' +
    '<div class="mini"><span>주식 평가액</span><b>' + fmt(stock) + '원</b></div></div></div>';
}

function render() {
  if (!stateLoaded) return;
  if (!pid) return renderJoin();
  if (!me) return;
  if (!state || state.phase === 'lobby') return renderLobby();
  if (state.phase === 'briefing') return renderBriefing();
  if (state.phase === 'open') return renderTrade();
  if (state.phase === 'closed') return renderClosed();
  if (state.phase === 'result') return renderResult();
  return renderFinal();
}

/* ───────── 입장 ───────── */
function renderJoin() {
  if (viewKey === 'join') {
    const e = document.getElementById('joinErr');
    if (e) e.textContent = joinError;
    return;
  }
  setView('join',
    '<form class="pad join" id="joinForm" style="padding-top:56px;gap:28px">' +
    '<div style="display:flex;flex-direction:column;gap:14px">' +
    '<span class="accent" style="font-size:14px;font-weight:600;letter-spacing:.08em">경제인의 밤</span>' +
    '<h1>모의투자<br>챌린지</h1>' +
    '<p class="sub" style="font-size:15px;line-height:1.6">' + TOTAL_ROUNDS + '라운드 동안 ' + COMPANIES.length + '개 기업에 투자하고<br>최고 수익률에 도전하세요.</p></div>' +
    '<div class="grid3">' +
    '<div class="mini" style="background:var(--card);border:1px solid var(--line)"><span>시드머니</span><b>' + fmt(SEED / 10000) + '만 원</b></div>' +
    '<div class="mini" style="background:var(--card);border:1px solid var(--line)"><span>투자 대상</span><b>' + COMPANIES.length + '개 기업</b></div>' +
    '<div class="mini" style="background:var(--card);border:1px solid var(--line)"><span>진행</span><b>' + TOTAL_ROUNDS + '라운드</b></div></div>' +
    '<div><label for="nm">이름</label><input class="field" id="nm" maxlength="10" autocomplete="off" placeholder="이름을 입력하세요"></div>' +
    '<div><label for="pw">비밀번호 (숫자 4자리, 직접 정하기)</label><input class="field" id="pw" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" placeholder="예: 1234" style="letter-spacing:.3em"></div>' +
    '<div class="err" id="joinErr">' + esc(joinError) + '</div>' +
    '<button class="btn" type="submit" id="joinBtn">입장하기</button>' +
    '<p class="sub" style="font-size:13px;line-height:1.6;text-align:center;margin-top:auto">같은 이름과 비밀번호로 다시 들어오면<br>하던 곳에서 이어서 진행돼요.</p></form>');
}

async function join() {
  const name = document.getElementById('nm').value.trim().replace(/[\/\s]+/g, '').slice(0, 10);
  const pin = document.getElementById('pw').value.trim();
  if (!name) { joinError = '이름을 입력해 주세요.'; return renderJoin(); }
  if (!/^\d{4}$/.test(pin)) { joinError = '비밀번호는 숫자 4자리로 입력해 주세요.'; return renderJoin(); }
  const btn = document.getElementById('joinBtn');
  btn.disabled = true;
  joinError = '';
  renderJoin();
  try {
    const id = pin + '-' + name;
    const ref = doc(db, 'players', id);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, { name: name, cash: SEED, holdings: {}, createdAt: Date.now() });
    }
    pid = id;
    store.set(id);
    viewKey = '';
    watchMe();
  } catch (e) {
    console.error(e);
    joinError = '입장에 실패했어요. 잠시 후 다시 시도해 주세요.';
    btn.disabled = false;
    renderJoin();
  }
}

/* ───────── 대기 · 브리핑 ───────── */
function renderLobby() {
  setView('lobby', '<div class="pad">' + head() +
    '<div class="card center"><h2>입장 완료!<br>곧 시작합니다</h2><p>진행자의 안내를 기다려 주세요.<br>이 화면은 자동으로 바뀌어요.</p></div>' +
    (state ? assetCard() : '') + '</div>');
}

function renderBriefing() {
  setView('briefing', '<div class="pad">' + head() + bars() +
    '<div class="card center">' +
    '<span class="pill live"><i></i>ROUND ' + state.round + ' · 뉴스 브리핑 중</span>' +
    '<h2>앞 스크린의<br>뉴스 브리핑에 집중해 주세요</h2>' +
    '<p>브리핑이 끝나면 투자 창이<br>이 화면에서 자동으로 열려요.</p></div>' +
    assetCard() + '</div>');
}

/* ───────── 투자 ───────── */
function initDraft() {
  const hold = me.holdings || {};
  const o = me.order && me.order.round === state.round ? (me.order.qty || {}) : {};
  draft = {};
  for (const c of COMPANIES) draft[c.code] = Math.max(0, (hold[c.code] || 0) + (o[c.code] || 0));
  draftRound = state.round;
  tradeError = '';
}

function calc() {
  const p = prices();
  const hold = me.holdings || {};
  let buy = 0;
  let sell = 0;
  const qty = {};
  for (const c of COMPANIES) {
    const d = draft[c.code] - (hold[c.code] || 0);
    if (d > 0) buy += d * p[c.code];
    if (d < 0) sell += -d * p[c.code];
    if (d !== 0) qty[c.code] = d;
  }
  return { buy: buy, sell: sell, qty: qty, cashAfter: me.cash - buy + sell };
}

function sameQty(a, b) {
  const ka = Object.keys(a);
  const kb = Object.keys(b || {});
  return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
}

function renderTrade() {
  if (draftRound !== state.round) initDraft();
  const key = 'trade-' + state.round;
  if (viewKey === key) return patchTrade();
  const p = prices();
  const pp = prevPrices();
  let rows = '';
  for (const ind of INDUSTRIES) {
    rows += '<div class="ind">' + esc(ind) + '</div>';
    for (const c of COMPANIES.filter((x) => x.ind === ind)) {
      const chg = pp ? (p[c.code] / pp[c.code] - 1) * 100 : null;
      rows += '<div class="row"><div class="nm"><b>' + esc(c.name) + '</b><span id="h-' + c.code + '"></span></div>' +
        '<div class="pr"><b>' + fmt(p[c.code]) + '</b>' +
        (chg === null ? '<span class="sub">시작가</span>' : '<span class="' + cls(chg) + '">' + pctText(chg) + '</span>') + '</div>' +
        '<div class="step"><button type="button" class="down" data-act="dec" data-code="' + c.code + '" aria-label="' + esc(c.name) + ' 1주 줄이기">−</button>' +
        '<input type="number" inputmode="numeric" min="0" step="1" data-code="' + c.code + '" id="t-' + c.code + '" aria-label="' + esc(c.name) + ' 목표 보유 수량">' +
        '<button type="button" class="up" data-act="inc" data-code="' + c.code + '" aria-label="' + esc(c.name) + ' 1주 늘리기">+</button></div></div>';
    }
  }
  setView(key,
    '<div class="tradehead"><div style="display:flex;justify-content:space-between;align-items:center">' +
    '<div style="display:flex;align-items:center;gap:8px"><span class="pill gold">ROUND ' + state.round + ' / ' + TOTAL_ROUNDS + '</span>' +
    '<b class="ok" style="font-size:14px">투자 접수 중</b></div>' +
    '<div style="display:flex;flex-direction:column;align-items:flex-end"><span class="sub" style="font-size:11px">마감까지</span><span class="timer" id="timer">--:--</span></div></div>' +
    '<div class="grid2"><div class="mini" style="background:var(--card);border:1px solid var(--line)"><span>총자산</span><b>' + fmt(myTotal()) + '원</b></div>' +
    '<div class="mini" style="background:var(--card);border:1px solid var(--line)"><span>주문 후 현금</span><b id="cashAfter"></b></div></div>' +
    '<p class="sub" style="font-size:12px">숫자는 이번 라운드가 끝났을 때 보유할 주식 수예요. 늘리면 매수, 줄이면 매도!</p></div>' +
    '<div class="list">' + rows + '</div>' +
    '<div class="foot"><div class="sum"><span>매수 <b class="up" id="buySum"></b></span><span>매도 <b class="down" id="sellSum"></b></span></div>' +
    '<div class="err" id="tradeMsg" style="text-align:center"></div>' +
    '<button class="btn" type="button" id="submitBtn" data-act="submit"></button></div>');
  patchTrade();
  tick();
}

function patchTrade() {
  const hold = me.holdings || {};
  const p = prices();
  const r = calc();
  for (const c of COMPANIES) {
    const h = hold[c.code] || 0;
    const d = draft[c.code] - h;
    const el = document.getElementById('h-' + c.code);
    if (!el) return;
    el.textContent = '보유 ' + h + '주' + (d > 0 ? ' · 매수 +' + d : d < 0 ? ' · 매도 −' + (-d) : '');
    el.style.color = d === 0 ? '' : (d > 0 ? 'var(--up)' : 'var(--down)');
    const input = document.getElementById('t-' + c.code);
    if (document.activeElement !== input) input.value = draft[c.code];
    const row = input.parentElement;
    row.querySelector('[data-act="dec"]').disabled = draft[c.code] <= 0;
    row.querySelector('[data-act="inc"]').disabled = r.cashAfter < p[c.code];
  }
  const ca = document.getElementById('cashAfter');
  ca.textContent = fmt(r.cashAfter) + '원';
  ca.style.color = r.cashAfter < 0 ? 'var(--up)' : '';
  document.getElementById('buySum').textContent = fmt(r.buy) + '원';
  document.getElementById('sellSum').textContent = fmt(r.sell) + '원';

  const submitted = !!(me.order && me.order.round === state.round);
  const clean = submitted && sameQty(r.qty, me.order.qty);
  const btn = document.getElementById('submitBtn');
  const msg = document.getElementById('tradeMsg');
  btn.className = 'btn' + (clean ? ' done' : '');
  btn.disabled = sending || r.cashAfter < 0 || clean;
  btn.textContent = sending ? '제출 중…' : clean ? '제출 완료' : submitted ? '수정 내용 다시 제출' : '주문 제출';
  if (r.cashAfter < 0) { msg.textContent = '현금이 ' + fmt(-r.cashAfter) + '원 부족해요.'; msg.className = 'err'; }
  else if (tradeError) { msg.textContent = tradeError; msg.className = 'err'; }
  else if (clean) { msg.textContent = '제출 완료 · 마감 전까지 수정할 수 있어요'; msg.className = 'err ok'; }
  else { msg.textContent = submitted ? '수정한 내용은 다시 제출해야 반영돼요.' : ''; msg.className = 'err sub'; }
}

async function submitOrder() {
  if (sending) return;
  const r = calc();
  if (r.cashAfter < 0) return;
  sending = true;
  tradeError = '';
  patchTrade();
  try {
    await updateDoc(doc(db, 'players', pid), { order: { round: state.round, qty: r.qty, at: Date.now() } });
  } catch (e) {
    console.error(e);
    tradeError = '제출하지 못했어요. 이미 마감됐거나 연결이 불안정해요.';
  }
  sending = false;
  if (viewKey.indexOf('trade-') === 0) patchTrade();
}

/* ───────── 마감 ───────── */
function orderLines() {
  const o = me.order && me.order.round === state.round ? (me.order.qty || {}) : {};
  let html = '';
  for (const c of COMPANIES) {
    const q = o[c.code] || 0;
    if (!q) continue;
    html += '<div class="pl"><div class="nm"><b>' + esc(c.name) + '</b></div><div class="v"><b class="' + (q > 0 ? 'up' : 'down') + '">' +
      (q > 0 ? '매수 +' + q : '매도 −' + (-q)) + '주</b></div></div>';
  }
  return html || '<p class="sub" style="font-size:14px;padding:8px 0">제출한 주문이 없어요. 보유 종목이 그대로 유지돼요.</p>';
}

function renderClosed() {
  setView('closed', '<div class="pad">' + head() + bars() +
    '<div class="card center" style="flex:0;padding:28px 24px"><span class="pill dark">ROUND ' + state.round + ' · 투자 마감</span>' +
    '<h2>결과를 집계하고 있어요</h2><p>앞 스크린에서 주가 변동을 확인하세요.</p></div>' +
    '<div class="card"><div class="ind" style="padding-top:0">이번 라운드 내 주문</div>' + orderLines() + '</div></div>');
}

/* ───────── 결과 ───────── */
function renderResult() {
  const r = state.round;
  const now = prices();
  const prev = prevPrices() || now;
  const rev = (state.revealed && state.revealed['r' + r]) || {};
  const total = myTotal();
  const settled = me.settledRound === r;
  const base = settled && me.prevTotal ? me.prevTotal : total;
  const roundPct = (total / base - 1) * 100;
  const cum = cumPct();
  const move = settled && me.prevRank ? me.prevRank - me.rank : 0;
  const hold = me.holdings || {};

  let surprises = '';
  for (const s of (rev.surprises || [])) {
    surprises += '<div class="warn"><b>돌발 이슈</b><span style="font-size:14px;line-height:1.5">' + esc(s) + '</span></div>';
  }
  let rows = '';
  for (const c of COMPANIES) {
    const q = hold[c.code] || 0;
    if (!q) continue;
    const pnl = q * (now[c.code] - prev[c.code]);
    const pct = (now[c.code] / prev[c.code] - 1) * 100;
    rows += '<div class="pl"><div class="nm"><b>' + esc(c.name) + '</b><span>' + q + '주 · ' + fmt(now[c.code]) + '원</span></div>' +
      '<div class="v ' + cls(pnl) + '"><b>' + (pnl >= 0 ? '+' : '−') + fmt(Math.abs(pnl)) + '원</b><span>' + pctText(pct) + '</span></div></div>';
  }
  if (!rows) rows = '<p class="sub" style="font-size:14px;padding:8px 0">보유한 주식이 없어요.</p>';

  setView('result-' + r, '<div class="pad">' +
    '<header class="top"><span class="pill dark">ROUND ' + r + ' 결과</span><button class="link" data-act="leave">' + esc(me.name) + ' · 나가기</button></header>' +
    '<div class="card" style="display:flex;flex-direction:column;gap:6px"><span class="sub" style="font-size:13px">내 총자산</span>' +
    '<span style="font-size:30px;font-weight:700">' + fmt(total) + '원</span>' +
    '<span class="sub" style="font-size:14px">이번 라운드 <b class="' + cls(roundPct) + '">' + pctText(roundPct, 2) + ' (' + (total - base >= 0 ? '+' : '−') + fmt(Math.abs(total - base)) + ')</b></span>' +
    '<span class="sub" style="font-size:14px">누적 수익률 <b class="' + cls(cum) + '">' + pctText(cum, 2) + '</b></span></div>' +
    '<div class="grid2"><div class="mini" style="background:var(--card);border:1px solid var(--line)"><span>현재 순위</span><b style="font-size:20px">' +
    (settled ? me.rank + '위' : '–') + (move ? ' <span class="' + (move > 0 ? 'up' : 'down') + '" style="font-size:13px">' + (move > 0 ? '▲' : '▼') + Math.abs(move) + '</span>' : '') +
    '</b><span>' + (state.playerCount || 0) + '명 중</span></div>' +
    '<div class="mini" style="background:var(--card);border:1px solid var(--line)"><span>현금</span><b style="font-size:20px">' + fmt(me.cash) + '원</b><span>다음 라운드 투자 가능</span></div></div>' +
    surprises +
    '<div><div class="ind">보유 종목 손익</div>' + rows + '</div>' +
    '<p class="sub" style="font-size:13px;text-align:center;margin-top:auto">' +
    (r < TOTAL_ROUNDS ? '잠시 후 ROUND ' + (r + 1) + ' 브리핑이 시작돼요' : '잠시 후 최종 결과가 발표돼요') + '</p></div>');
}

function renderFinal() {
  const total = myTotal();
  const cum = cumPct();
  setView('final', '<div class="pad">' + head() +
    '<div class="card center"><span class="pill gold">최종 결과</span>' +
    '<h2 style="font-size:44px">' + (me.rank ? me.rank + '위' : '–') + '</h2>' +
    '<p>' + (state.playerCount || 0) + '명 중</p>' +
    '<span class="big">' + fmt(total) + '원</span>' +
    '<b class="' + cls(cum) + '" style="font-size:20px">' + pctText(cum, 2) + '</b>' +
    '<p>참여해 주셔서 감사합니다!</p></div></div>');
}

/* ───────── 이벤트 ───────── */
function tick() {
  const el = document.getElementById('timer');
  if (!el || !state) return;
  el.textContent = state.deadline ? mmss(Math.ceil((state.deadline - Date.now()) / 1000)) : '--:--';
}

function onClick(e) {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const act = t.dataset.act;
  if (act === 'leave') return leave();
  if (act === 'submit') return submitOrder();
  const code = t.dataset.code;
  if (act === 'inc') {
    if (calc().cashAfter >= prices()[code]) draft[code] += 1;
  } else if (act === 'dec') {
    if (draft[code] > 0) draft[code] -= 1;
  }
  tradeError = '';
  patchTrade();
}

function onInput(e) {
  const code = e.target.dataset && e.target.dataset.code;
  if (!code || !(code in draft)) return;
  const n = parseInt(e.target.value, 10);
  draft[code] = Number.isFinite(n) && n > 0 ? Math.min(n, 100000) : 0;
  tradeError = '';
  patchTrade();
}

function onSubmit(e) {
  e.preventDefault();
  if (e.target.id === 'joinForm') join();
}
