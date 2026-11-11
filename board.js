import { configured, db, doc, onSnapshot } from './firebase.js';
import { COMPANIES, INDUSTRIES, SEED, TOTAL_ROUNDS } from './config.js';
import { fmt, esc, pctText, cls, mmss } from './engine.js';

const app = document.getElementById('app');
let state = null;

const PHASE_LABEL = {
  lobby: '입장 대기', briefing: '뉴스 브리핑', open: '투자 접수 중', closed: '투자 마감', result: '결과', final: '최종 결과'
};

if (!configured) {
  app.innerHTML = '<div class="empty">js/config.js에 Firebase 설정값을 넣어 주세요.</div>';
} else {
  onSnapshot(doc(db, 'game', 'state'), (s) => {
    state = s.exists() ? s.data() : null;
    render();
  }, (e) => {
    console.error(e);
    app.innerHTML = '<div class="empty">연결에 문제가 생겼어요. 새로고침해 주세요.</div>';
  });
  setInterval(tick, 500);
}

function tick() {
  const el = document.getElementById('clock');
  if (!el || !state) return;
  el.textContent = state.deadline ? mmss(Math.ceil((state.deadline - Date.now()) / 1000)) : '';
}

function spark(code, color) {
  const vals = state.history.map((h) => h[code]);
  if (vals.length < 2) return '<svg viewBox="0 0 300 80" aria-hidden="true"></svg>';
  const min = Math.min.apply(null, vals);
  const max = Math.max.apply(null, vals);
  const span = max - min || 1;
  const pts = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * 300;
    const y = 76 - ((v - min) / span) * 72;
    return x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');
  return '<svg viewBox="0 0 300 80" preserveAspectRatio="none" fill="none" aria-hidden="true">' +
    '<polyline points="' + pts + '" stroke="' + color + '" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"></polyline></svg>';
}

function render() {
  if (!state) {
    app.innerHTML = '<div class="empty">게임이 아직 만들어지지 않았어요.<br>관리자 페이지에서 "게임 만들기"를 눌러 주세요.</div>';
    return;
  }
  const phase = state.phase;
  const round = state.round;
  const h = state.history;
  const now = h[h.length - 1];
  const prev = h.length > 1 ? h[h.length - 2] : null;
  const showResult = phase === 'result' || phase === 'final';
  const rev = (state.revealed && state.revealed['r' + round]) || {};
  const hot = phase === 'result' ? (rev.surprised || []) : [];

  const pill = phase === 'lobby' ? '입장 대기' : phase === 'final' ? '최종 결과' : 'ROUND ' + round + ' · ' + PHASE_LABEL[phase];
  let right = '';
  if (phase === 'open') right = '<span class="clock" id="clock"></span>';
  else if (phase === 'lobby') right = '<span class="s">휴대폰으로 접속해 이름을 입력하세요</span>';
  else if (phase === 'result') right = '<span class="s">참가 ' + (state.playerCount || 0) + '명 · ' + (round < TOTAL_ROUNDS ? '다음은 ROUND ' + (round + 1) : '곧 최종 결과 발표') + '</span>';
  else if (phase === 'final') right = '<span class="s">참가 ' + (state.playerCount || 0) + '명</span>';
  else right = '<span class="s">ROUND ' + round + ' / ' + TOTAL_ROUNDS + '</span>';

  let banners = '';
  if (phase === 'result') {
    for (const s of (rev.surprises || [])) {
      banners += '<div class="banner"><b>돌발</b><span>' + esc(s) + '</span></div>';
    }
  }

  let tiles = '';
  for (const ind of INDUSTRIES) {
    tiles += '<div class="col"><span>' + esc(ind) + '</span>';
    for (const c of COMPANIES.filter((x) => x.ind === ind)) {
      const chg = prev ? (now[c.code] / prev[c.code] - 1) * 100 : null;
      const color = chg === null ? '#9AA4BF' : chg >= 0 ? '#FF6B6B' : '#5B9BFF';
      tiles += '<div class="tile' + (hot.indexOf(c.code) >= 0 ? ' hot' : '') + '"><span class="n">' + esc(c.name) + '</span>' +
        '<span class="p">' + fmt(now[c.code]) + '</span>' +
        (chg === null ? '<span class="c sub">시작가</span>' : '<span class="c ' + cls(chg) + '">' + pctText(chg) + '</span>') +
        spark(c.code, color) + '</div>';
    }
    tiles += '</div>';
  }

  let rank = '';
  const top = state.top || [];
  if (!top.length) {
    rank = '<div class="empty">1라운드 결과가 나오면<br>순위가 표시됩니다</div>';
  } else {
    for (const p of top) {
      const ret = (p.total / SEED - 1) * 100;
      const g = p.rank <= 3 ? ' g' + p.rank : '';
      const mv = !showResult || !p.move ? '<span class="m sub">–</span>'
        : '<span class="m ' + (p.move > 0 ? 'up' : 'down') + '">' + (p.move > 0 ? '▲' : '▼') + Math.abs(p.move) + '</span>';
      rank += '<div class="rk"><span class="b' + g + '">' + p.rank + '</span><span class="n">' + esc(p.name) + '</span>' + mv +
        '<span class="t">' + fmt(p.total) + '원</span>' +
        '<span class="r ' + cls(ret) + '">' + (ret >= 0 ? '+' : '−') + Math.abs(ret).toFixed(2) + '%</span></div>';
    }
  }

  app.innerHTML =
    '<div class="hd"><div style="display:flex;align-items:center;gap:1.25rem"><span class="t">경제인의 밤 모의투자</span><span class="p">' + pill + '</span></div>' + right + '</div>' +
    banners +
    '<div class="main"><div class="tiles">' + tiles + '</div>' +
    '<div class="rank"><div class="rh"><b>' + (phase === 'final' ? '최종 순위 TOP 10' : '수익률 TOP 10') + '</b><span>누적 기준</span></div>' + rank + '</div></div>';
  tick();
}
