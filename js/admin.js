import { configured, app as fbApp, db, doc, getDocs, setDoc, updateDoc, onSnapshot, collection, writeBatch } from './firebase.js';
import { getAuth, signInWithEmailAndPassword, GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { COMPANIES, SEED, TOTAL_ROUNDS, DEFAULT_MINUTES, MASK_NAMES } from './config.js';
import { fmt, esc, mmss, totalPct, applyChanges, settleOrder, totalOf, assignRanks, maskName } from './engine.js';

const $ = (id) => document.getElementById(id);
const CODES = COMPANIES.map((c) => c.code);
const PHASES = ['briefing', 'open', 'closed', 'result'];
const PHASE_NAME = { lobby: '대기', briefing: '브리핑', open: '투자 접수', closed: '마감', result: '결과 공개', final: '최종 결과' };
const SCREEN = {
  lobby: '입장 대기 화면', briefing: '브리핑 대기 화면', open: '투자 입력창 열림',
  closed: '입력창 잠김', result: '결과 · 순위 화면', final: '최종 순위 화면'
};

let state = null;
let stateLoaded = false;
let scenario = null;
let players = [];
let selRound = 0;
let busy = false;
let minutes = DEFAULT_MINUTES;
let unsubs = [];
let kickId = '';

const stateRef = () => doc(db, 'game', 'state');
const scenarioRef = () => doc(db, 'admin', 'scenario');
const initPrices = () => Object.fromEntries(COMPANIES.map((c) => [c.code, c.price]));
const initialState = () => ({
  round: 1, phase: 'lobby', deadline: 0, history: [initPrices()], revealed: {}, top: [], playerCount: 0
});

function flash(msg) { $('flash').textContent = msg || ''; }

function explain(e) {
  console.error(e);
  if (e && e.code === 'permission-denied') {
    return '권한이 없습니다. firestore.rules에 적은 관리자 이메일과 로그인한 이메일이 같은지 확인해 주세요.';
  }
  return (e && e.message) || '알 수 없는 오류가 발생했습니다.';
}

if (!configured) {
  flash('js/config.js에 Firebase 설정값을 먼저 넣어 주세요.');
} else {
  const auth = getAuth(fbApp);
  onAuthStateChanged(auth, (user) => {
    unsubs.forEach((u) => u());
    unsubs = [];
    $('login').style.display = user ? 'none' : 'flex';
    $('panel').style.display = user ? 'flex' : 'none';
    $('who').innerHTML = user ? esc(user.email) + ' · <button class="link" id="logout" type="button">로그아웃</button>' : '';
    if (user) {
      $('logout').addEventListener('click', () => signOut(auth));
      start();
    }
  });
  $('login').addEventListener('submit', async (e) => {
    e.preventDefault();
    flash('');
    try {
      await signInWithEmailAndPassword(auth, $('em').value.trim(), $('pw').value);
    } catch (err) {
      console.error(err);
      flash('로그인에 실패했습니다. 이메일과 비밀번호를 확인해 주세요.');
    }
  });
  
  $('resetBtn').addEventListener('click', resetGame);
  $('csvBtn').addEventListener('click', downloadCsv);
  $('players').addEventListener('click', onPlayersClick);
  $('control').addEventListener('click', onControlClick);
  $('control').addEventListener('input', (e) => {
    if (e.target.id === 'minutes') minutes = Math.max(1, Math.min(30, parseInt(e.target.value, 10) || DEFAULT_MINUTES));
  });
  $('scenario').addEventListener('click', onScenarioClick);
  $('scenario').addEventListener('input', patchScenarioPrices);
  $('scenario').addEventListener('change', onScenarioFile);
  setInterval(tick, 500);
}

function start() {
  unsubs.push(onSnapshot(stateRef(), (s) => {
    const prevRound = state && state.round;
    state = s.exists() ? s.data() : null;
    stateLoaded = true;
    if (state && (!selRound || prevRound !== state.round)) { selRound = state.round; renderScenario(); }
    else if (!selRound) { selRound = 1; renderScenario(); }
    else patchScenarioPrices();
    renderControl();
    renderSubs();
    renderPlayers();
  }, (e) => flash(explain(e))));
  unsubs.push(onSnapshot(scenarioRef(), (s) => {
    scenario = s.exists() ? s.data() : null;
    if (!selRound) selRound = 1;
    renderScenario();
  }, (e) => flash(explain(e))));
  unsubs.push(onSnapshot(collection(db, 'players'), (qs) => {
    players = qs.docs.map((d) => Object.assign({ id: d.id }, d.data()));
    renderSubs();
    renderPlayers();
  }, (e) => flash(explain(e))));
}

/* ───────── 라운드 통제 ───────── */
function actionLabel() {
  if (!state) return '게임 만들기';
  const r = state.round;
  switch (state.phase) {
    case 'lobby': return 'ROUND 1 브리핑 시작';
    case 'briefing': return '투자 접수 시작';
    case 'open': return '투자 마감하기';
    case 'closed': return '주가 반영 · 결과 공개';
    case 'result': return r < TOTAL_ROUNDS ? 'ROUND ' + (r + 1) + ' 브리핑 시작' : '최종 결과 발표';
    default: return '게임 종료됨';
  }
}

function renderControl() {
  if (!stateLoaded) return;
  const phase = state ? state.phase : 'lobby';
  const round = state ? state.round : 1;
  const idx = PHASES.indexOf(phase);
  let steps = '';
  PHASES.forEach((p, i) => {
    const c = phase === 'final' || i < idx ? 'done' : i === idx ? 'cur' : '';
    steps += '<div class="' + c + '"><span>' + (c === 'done' ? '완료' : c === 'cur' ? '진행 중' : (i + 1) + '단계') + '</span><b>' + PHASE_NAME[p] + '</b></div>';
  });
  let tabs = '';
  for (let i = 1; i <= TOTAL_ROUNDS; i++) {
    tabs += '<span class="pill ' + (state && i === round && phase !== 'lobby' ? 'gold' : 'dark') + '" style="font-size:14px;padding:8px 12px">R' + i + '</span>';
  }
  const canBack = state && (phase === 'open' || phase === 'closed' || (phase === 'briefing' && round === 1));
  $('control').innerHTML =
    '<div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-start;gap:12px">' +
    '<div style="display:flex;flex-direction:column;gap:6px"><span class="sub" style="font-size:14px">' +
    (state ? (phase === 'lobby' ? '시작 전' : 'ROUND ' + round + ' 진행 단계') : '게임이 아직 없습니다') + '</span>' +
    '<span style="font-size:26px;font-weight:700">' + PHASE_NAME[phase] + '</span>' +
    '<span class="sub" style="font-size:14px">참가자 화면: <b style="color:var(--text)">' + SCREEN[phase] + '</b></span></div>' +
    '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px"><div style="display:flex;gap:6px">' + tabs + '</div>' +
    '<span class="sub" style="font-size:13px">투자 마감까지</span><span id="timer" style="font-size:40px;font-weight:700;color:var(--accent)">--:--</span></div></div>' +
    '<div class="steps">' + steps + '</div>' +
    '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center">' +
    '<button class="btn" type="button" data-act="advance" style="flex:1 1 260px;height:60px;font-size:18px"' + (busy || phase === 'final' ? ' disabled' : '') + '>' + (busy ? '처리 중…' : actionLabel()) + '</button>' +
    '<button class="btn ghost" type="button" data-act="plus"' + (phase === 'open' && !busy ? '' : ' disabled') + '>타이머 +1분</button>' +
    '<button class="btn ghost" type="button" data-act="back"' + (canBack && !busy ? '' : ' disabled') + '>이전 단계로</button></div>' +
    '<div style="display:flex;align-items:center;gap:10px"><label for="minutes" class="sub" style="font-size:14px">투자 접수 시간(분)</label>' +
    '<input class="num" id="minutes" type="number" min="1" max="30" value="' + minutes + '" style="width:72px"></div>';
  tick();
}

function tick() {
  const el = $('timer');
  if (!el) return;
  el.textContent = state && state.phase === 'open' && state.deadline
    ? mmss(Math.ceil((state.deadline - Date.now()) / 1000)) : '--:--';
}

async function onControlClick(e) {
  const t = e.target.closest('[data-act]');
  if (!t || busy) return;
  busy = true;
  flash('');
  renderControl();
  try {
    if (t.dataset.act === 'advance') await advance();
    else if (t.dataset.act === 'plus') await updateDoc(stateRef(), { deadline: Math.max(state.deadline || 0, Date.now()) + 60000 });
    else if (t.dataset.act === 'back') await goBack();
  } catch (err) {
    flash(explain(err));
  }
  busy = false;
  renderControl();
}

async function advance() {
  if (!state) { await setDoc(stateRef(), initialState()); return; }
  const round = state.round;
  switch (state.phase) {
    case 'lobby': await updateDoc(stateRef(), { phase: 'briefing', round: 1, deadline: 0 }); break;
    case 'briefing': await updateDoc(stateRef(), { phase: 'open', deadline: Date.now() + minutes * 60000 }); break;
    case 'open': await updateDoc(stateRef(), { phase: 'closed', deadline: 0 }); break;
    case 'closed': await settle(); break;
    case 'result':
      if (round < TOTAL_ROUNDS) await updateDoc(stateRef(), { phase: 'briefing', round: round + 1, deadline: 0 });
      else await updateDoc(stateRef(), { phase: 'final' });
      break;
    default: break;
  }
}

async function goBack() {
  if (state.phase === 'closed') await updateDoc(stateRef(), { phase: 'open', deadline: Date.now() + 60000 });
  else if (state.phase === 'open') await updateDoc(stateRef(), { phase: 'briefing', deadline: 0 });
  else if (state.phase === 'briefing' && state.round === 1) await updateDoc(stateRef(), { phase: 'lobby' });
}

// 주문 체결 → 주가 변동 반영 → 순위 계산을 한 번에(원자적으로) 저장
async function settle() {
  const round = state.round;
  if (state.history.length !== round) throw new Error('이 라운드는 이미 결과가 반영되었습니다.');
  const sc = scenario && scenario.rounds && scenario.rounds['r' + round];
  if (!sc || !sc.changes) throw new Error('ROUND ' + round + ' 시나리오가 없습니다. 아래에서 변동률을 입력하고 저장해 주세요.');
  const missing = COMPANIES.filter((c) => totalPct(sc.changes[c.code]) === 0).map((c) => c.name);
  if (missing.length === COMPANIES.length) throw new Error('ROUND ' + round + ' 변동률이 모두 0입니다. 시나리오를 확인해 주세요.');

  const prev = state.history[round - 1];
  const next = applyChanges(prev, sc.changes);
  const snap = await getDocs(collection(db, 'players'));
  const list = snap.docs.map((d) => {
    const p = d.data();
    let cash = Number(p.cash) || 0;
    let holdings = p.holdings || {};
    if (p.order && p.order.round === round) {
      const r = settleOrder(cash, holdings, p.order.qty || {}, prev, CODES);
      cash = r.cash;
      holdings = r.holdings;
    }
    return {
      ref: d.ref, name: p.name, cash: cash, holdings: holdings,
      prevTotal: totalOf(Number(p.cash) || 0, p.holdings || {}, prev),
      prevRank: p.rank || 0,
      total: totalOf(cash, holdings, next)
    };
  });
  const sorted = assignRanks(list);
  if (sorted.length > 450) throw new Error('참가자가 450명을 넘어 한 번에 저장할 수 없습니다.');

  const pct = {};
  const surprised = [];
  for (const c of COMPANIES) {
    pct[c.code] = totalPct(sc.changes[c.code]);
    if (Number(sc.changes[c.code] && sc.changes[c.code].surprise)) surprised.push(c.code);
  }
  const top = sorted.slice(0, 10).map((p) => ({
    name: MASK_NAMES ? maskName(p.name) : p.name,
    total: p.total,
    rank: p.rank,
    move: p.prevRank ? p.prevRank - p.rank : 0
  }));

  const batch = writeBatch(db);
  for (const p of sorted) {
    batch.update(p.ref, {
      cash: p.cash, holdings: p.holdings, total: p.total, prevTotal: p.prevTotal,
      rank: p.rank, prevRank: p.prevRank, settledRound: round
    });
  }
  const upd = {
    phase: 'result', deadline: 0, history: state.history.concat([next]), top: top, playerCount: sorted.length
  };
  upd['revealed.r' + round] = {
    pct: pct, surprised: surprised, surprises: (sc.surprises || []).filter((s) => String(s).trim())
  };
  batch.update(stateRef(), upd);
  await batch.commit();
}

/* ───────── 제출 현황 ───────── */
function renderSubs() {
  if (!stateLoaded) return;
  const round = state ? state.round : 0;
  const done = players.filter((p) => p.order && p.order.round === round);
  const pending = players.filter((p) => !(p.order && p.order.round === round));
  const ratio = players.length ? Math.round((done.length / players.length) * 100) : 0;
  let chips = '';
  for (const p of pending) chips += '<span>' + esc(p.name) + '</span>';
  $('subs').innerHTML =
    '<span class="sub" style="font-size:14px">이번 라운드 주문 제출</span>' +
    '<div style="display:flex;align-items:baseline;gap:8px"><span style="font-size:40px;font-weight:700">' + done.length + '</span>' +
    '<span class="sub" style="font-size:18px">/ ' + players.length + '명</span></div>' +
    '<div class="bar"><i style="width:' + ratio + '%"></i></div>' +
    '<span style="font-size:13px;font-weight:600;color:var(--mid)">미제출 (' + pending.length + ')</span>' +
    '<div class="chips">' + (chips || '<span>없음</span>') + '</div>' +
    '<span class="sub" style="font-size:12px;line-height:1.5">제출하지 않은 참가자는 기존 보유 종목이 그대로 유지돼요.</span>';
}

/* ───────── 시나리오 ───────── */
function basePrices(n) {
  const h = state && state.history ? state.history : [initPrices()];
  if (h.length >= n) return h[n - 1];
  let p = h[h.length - 1];
  for (let i = h.length; i < n; i++) {
    const sc = scenario && scenario.rounds && scenario.rounds['r' + i];
    p = applyChanges(p, (sc && sc.changes) || {});
  }
  return p;
}

function renderScenario() {
  if (!selRound) return;
  const sc = (scenario && scenario.rounds && scenario.rounds['r' + selRound]) || {};
  const ch = sc.changes || {};
  const base = basePrices(selRound);
  const locked = !!(state && state.history && state.history.length > selRound);
  let tabs = '';
  for (let i = 1; i <= TOTAL_ROUNDS; i++) {
    tabs += '<button type="button" data-round="' + i + '" class="' + (i === selRound ? 'on' : '') + '">R' + i + '</button>';
  }
  let rows = '';
  for (const c of COMPANIES) {
    const b = ch[c.code] && ch[c.code].brief != null ? ch[c.code].brief : '';
    const s = ch[c.code] && ch[c.code].surprise ? ch[c.code].surprise : '';
    rows += '<tr><td style="font-weight:600">' + esc(c.name) + '</td><td class="sub">' + esc(c.ind) + '</td>' +
      '<td class="r">' + fmt(base[c.code]) + '</td>' +
      '<td class="r"><input class="num" type="number" step="1" data-k="brief" data-code="' + c.code + '" value="' + esc(b) + '" aria-label="' + esc(c.name) + ' 브리핑 반영 변동률"' + (locked ? ' disabled' : '') + '></td>' +
      '<td class="r"><input class="num' + (s ? ' hot' : '') + '" type="number" step="1" data-k="surprise" data-code="' + c.code + '" value="' + esc(s) + '" placeholder="—" aria-label="' + esc(c.name) + ' 돌발 이슈 변동률"' + (locked ? ' disabled' : '') + '></td>' +
      '<td class="r" id="after-' + c.code + '" style="font-weight:700"></td></tr>';
  }
  $('scenario').innerHTML =
    '<div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:12px">' +
    '<h2>ROUND ' + selRound + ' 시나리오' + (locked ? ' <span class="sub" style="font-size:14px">(결과 반영 완료)</span>' : '') + '</h2>' +
    '<div class="rtabs">' + tabs + '</div></div>' +
    '<p class="sub" style="font-size:13px;line-height:1.6">이 내용은 관리자만 볼 수 있고, "결과 공개"를 누를 때 참가자에게 반영됩니다. 수정한 뒤에는 꼭 저장을 눌러 주세요.</p>' +
    '<div><label for="briefing" class="sub" style="font-size:13px">브리핑 대본 (진행 참고용, 참가자에게 보이지 않음)</label>' +
    '<textarea class="area" id="briefing"' + (locked ? ' disabled' : '') + '>' + esc(sc.briefing || '') + '</textarea></div>' +
    '<div class="scroll"><table class="tbl" style="min-width:760px"><thead><tr><th>회사</th><th>산업</th><th class="r">현재가</th>' +
    '<th class="r">브리핑 반영 (%)</th><th class="r">돌발 이슈 (%)</th><th class="r">적용 후 가격</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
    '<div><label for="surprises" class="sub" style="font-size:13px">돌발 이슈 문구 (한 줄에 하나, 결과 공개 때 참가자·스크린에 표시)</label>' +
    '<textarea class="area" id="surprises"' + (locked ? ' disabled' : '') + '>' + esc((sc.surprises || []).join('\n')) + '</textarea></div>' +
    '<div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center">' +
    '<button class="btn" type="button" data-act="save"' + (locked ? ' disabled' : '') + '>ROUND ' + selRound + ' 저장</button>' +
    '<label class="btn ghost" style="display:inline-flex;align-items:center;cursor:pointer">시나리오 파일 불러오기 (scenario.json)' +
    '<input type="file" id="scFile" accept=".json,application/json" style="display:none"></label>' +
    '<span class="sub" id="scMsg" style="font-size:14px">' + (scenario ? '' : '아직 저장된 시나리오가 없습니다. 파일을 불러오거나 직접 입력하세요.') + '</span></div>';
  patchScenarioPrices();
}

function readChanges() {
  const ch = {};
  for (const c of COMPANIES) ch[c.code] = { brief: 0, surprise: 0 };
  $('scenario').querySelectorAll('input[data-k]').forEach((el) => {
    ch[el.dataset.code][el.dataset.k] = Number(el.value) || 0;
  });
  return ch;
}

function patchScenarioPrices() {
  if (!selRound || !$('briefing')) return;
  const base = basePrices(selRound);
  const ch = readChanges();
  const after = applyChanges(base, ch);
  for (const c of COMPANIES) {
    const el = $('after-' + c.code);
    if (!el) continue;
    const pct = totalPct(ch[c.code]);
    el.textContent = fmt(after[c.code]) + '  ' + (pct >= 0 ? '▲' : '▼') + Math.abs(pct) + '%';
    el.className = 'r ' + (pct >= 0 ? 'up' : 'down');
  }
}

async function onScenarioClick(e) {
  const tab = e.target.closest('[data-round]');
  if (tab) { selRound = Number(tab.dataset.round); renderScenario(); return; }
  const save = e.target.closest('[data-act="save"]');
  if (!save) return;
  flash('');
  try {
    const data = {
      briefing: $('briefing').value.trim(),
      changes: readChanges(),
      surprises: $('surprises').value.split('\n').map((s) => s.trim()).filter(Boolean)
    };
    const rounds = Object.assign({}, (scenario && scenario.rounds) || {});
    rounds['r' + selRound] = data;
    await setDoc(scenarioRef(), { rounds: rounds });
    $('scMsg').textContent = 'ROUND ' + selRound + ' 저장 완료';
  } catch (err) {
    flash(explain(err));
  }
}

async function onScenarioFile(e) {
  if (e.target.id !== 'scFile' || !e.target.files[0]) return;
  flash('');
  try {
    const data = JSON.parse(await e.target.files[0].text());
    if (!data.rounds) throw new Error('시나리오 파일 형식이 올바르지 않습니다. (rounds 항목 없음)');
    await setDoc(scenarioRef(), { rounds: data.rounds });
    flash('');
  } catch (err) {
    flash(explain(err));
  }
}

/* ───────── 참가자 목록 · 초기화 · CSV ───────── */
function liveList() {
  const prices = state && state.history ? state.history[state.history.length - 1] : initPrices();
  return assignRanks(players.map((p) => ({
    id: p.id, name: p.name, cash: p.cash, total: totalOf(p.cash, p.holdings || {}, prices),
    submitted: !!(state && p.order && p.order.round === state.round)
  })));
}

function renderPlayers() {
  if (!stateLoaded) return;
  let rows = '';
  for (const p of liveList()) {
    const ret = (p.total / SEED - 1) * 100;
    rows += '<tr><td>' + p.rank + '</td><td style="font-weight:600">' + esc(p.name) + '</td>' +
      '<td>' + (p.submitted ? '<span class="ok">제출</span>' : '<span class="sub">미제출</span>') + '</td>' +
      '<td class="r">' + fmt(p.cash) + '</td><td class="r">' + fmt(p.total) + '</td>' +
      '<td class="r ' + (ret >= 0 ? 'up' : 'down') + '">' + (ret >= 0 ? '+' : '−') + Math.abs(ret).toFixed(2) + '%</td>' +
      '<td class="r">' + (kickId === p.id
        ? '<button class="btn" type="button" data-kick="' + esc(p.id) + '" style="height:40px;font-size:14px;background:var(--up);color:#fff">정말 내보내기</button> ' +
          '<button class="btn ghost" type="button" data-kick-cancel="1" style="height:40px;font-size:14px">취소</button>'
        : '<button class="btn ghost" type="button" data-kick-ask="' + esc(p.id) + '" style="height:40px;font-size:14px" aria-label="' + esc(p.name) + ' 내보내기">내보내기</button>') +
      '</td></tr>';
  }
  $('players').innerHTML = '<h2>참가자 ' + players.length + '명</h2>' +
    '<p class="sub" style="font-size:13px;line-height:1.6">내보내면 그 참가자의 기록이 지워지고 휴대폰은 입장 화면으로 돌아갑니다. 스크린 순위표에는 다음 결과 공개 때 반영됩니다.</p>' +
    '<div class="scroll"><table class="tbl" style="min-width:680px"><thead><tr>' +
    '<th>순위</th><th>이름</th><th>이번 라운드</th><th class="r">현금</th><th class="r">총자산</th><th class="r">수익률</th><th class="r">관리</th></tr></thead><tbody>' +
    (rows || '<tr><td colspan="7" class="sub">아직 입장한 참가자가 없습니다.</td></tr>') + '</tbody></table></div>';
}

async function onPlayersClick(e) {
  const ask = e.target.closest('[data-kick-ask]');
  if (ask) { kickId = ask.dataset.kickAsk; renderPlayers(); return; }
  if (e.target.closest('[data-kick-cancel]')) { kickId = ''; renderPlayers(); return; }
  const go = e.target.closest('[data-kick]');
  if (!go) return;
  const id = go.dataset.kick;
  kickId = '';
  flash('');
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'players', id));
    await batch.commit();
  } catch (err) {
    flash(explain(err));
    renderPlayers();
  }
}

async function resetGame() {
  if ($('resetWord').value.trim() !== '초기화') { flash('초기화하려면 입력란에 "초기화"를 적어 주세요.'); return; }
  if (busy) return;
  busy = true;
  flash('');
  try {
    const snap = await getDocs(collection(db, 'players'));
    for (let i = 0; i < snap.docs.length; i += 400) {
      const batch = writeBatch(db);
      snap.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
    await setDoc(stateRef(), initialState());
    $('resetWord').value = '';
  } catch (err) {
    flash(explain(err));
  }
  busy = false;
  renderControl();
}

function downloadCsv() {
  const lines = ['순위,이름,현금,총자산,수익률(%)'];
  for (const p of liveList()) {
    lines.push([p.rank, '"' + String(p.name).replace(/"/g, '""') + '"', p.cash, p.total, ((p.total / SEED - 1) * 100).toFixed(2)].join(','));
  }
  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '모의투자_결과.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}
