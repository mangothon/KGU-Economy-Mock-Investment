// 계산 전용 함수 모음 (화면·서버와 무관)

export const round10 = (n) => Math.round(n / 10) * 10;
export const fmt = (n) => Math.round(n).toLocaleString('ko-KR');

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function pctText(p, digits = 1) {
  return (p >= 0 ? '▲ ' : '▼ ') + Math.abs(p).toFixed(digits) + '%';
}

export const cls = (p) => (p >= 0 ? 'up' : 'down');

export function mmss(sec) {
  const s = Math.max(0, Math.floor(sec));
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
}

// 한 회사의 라운드 변동률(브리핑 반영 + 돌발)
export function totalPct(change) {
  const c = change || {};
  return (Number(c.brief) || 0) + (Number(c.surprise) || 0);
}

// 변동률을 적용한 새 주가표 (10원 단위 반올림)
export function applyChanges(prices, changes) {
  const next = {};
  for (const code of Object.keys(prices)) {
    const pct = totalPct(changes && changes[code]);
    next[code] = Math.max(10, round10(prices[code] * (1 + pct / 100)));
  }
  return next;
}

// 주문 체결: 매도 먼저, 그다음 매수. 현금·보유 수량을 넘는 부분은 체결하지 않음
export function settleOrder(cash, holdings, qty, prices, codes) {
  const h = Object.assign({}, holdings || {});
  let c = Number(cash) || 0;
  const q = (code) => Math.trunc(Number(qty && qty[code]) || 0);
  for (const code of codes) {
    const n = q(code);
    if (n < 0) {
      const sell = Math.min(-n, h[code] || 0);
      h[code] = (h[code] || 0) - sell;
      c += sell * prices[code];
    }
  }
  for (const code of codes) {
    const n = q(code);
    if (n > 0) {
      const buy = Math.min(n, Math.floor(c / prices[code]));
      h[code] = (h[code] || 0) + buy;
      c -= buy * prices[code];
    }
  }
  for (const k of Object.keys(h)) if (!h[k]) delete h[k];
  return { cash: c, holdings: h };
}

export function totalOf(cash, holdings, prices) {
  let t = Number(cash) || 0;
  for (const k of Object.keys(holdings || {})) t += holdings[k] * (prices[k] || 0);
  return t;
}

// 총자산 내림차순 정렬 + 순위 부여(동점은 같은 순위)
export function assignRanks(list) {
  const sorted = list.slice().sort((a, b) => b.total - a.total);
  let rank = 0;
  let last = null;
  sorted.forEach((p, i) => {
    if (p.total !== last) { rank = i + 1; last = p.total; }
    p.rank = rank;
  });
  return sorted;
}

export function maskName(name) {
  const a = Array.from(String(name));
  if (a.length <= 1) return a.join('');
  if (a.length === 2) return a[0] + '*';
  return a[0] + '*'.repeat(a.length - 2) + a[a.length - 1];
}
