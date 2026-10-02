const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const S = { tab: 'sort', authed: false, quiz: null, teams: [], players: [], scores: [], tips: [], tipRound: 1, scoreRound: null, last: null };

const num = v => { v = String(v).trim().replace(',', '.'); return /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : null; };
const q = async p => { const { data, error } = await p; if (error) throw error; return data; };
const tname = id => (S.teams.find(t => t.id === id) || {}).display_name || '';
const short = n => (/^Tým \d+$/.test(n) ? n.slice(4) : n);   // "Tým 2" -> "2", "Sovy" -> "Sovy"
const joinCz = a => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' a ' + a[a.length - 1];

function toast(t, ok = false) {
  const el = $('#toast'); el.textContent = t; el.style.background = ok ? 'var(--ok)' : 'var(--err)'; el.style.display = 'block';
  clearTimeout(toast.t); toast.t = setTimeout(() => el.style.display = 'none', 3500);
}
async function act(fn) {
  try { await fn(); $('#banner').hidden = true; }
  catch (e) { console.error(e); toast('⚠ Uložení se nezdařilo. Zkontrolujte připojení a zkuste to znovu.'); }
}
function confirmDlg(text, yes, fn) { $('#dlgq').textContent = text; $('#dlgy').textContent = yes; $('#dlgy').onclick = () => { $('#dlg').close(); fn(); }; $('#dlg').showModal(); }
window.addEventListener('offline', () => $('#banner').hidden = false);
window.addEventListener('online', () => { $('#banner').hidden = true; act(load); });

async function load() {
  const qz = await q(db.from('quizzes').select('*').eq('active', true).order('created_at', { ascending: false }).limit(1));
  S.quiz = qz[0] || null;
  if (S.quiz) {
    const id = S.quiz.id;
    [S.teams, S.players, S.scores, S.tips] = await Promise.all([
      q(db.from('teams').select('*').eq('quiz_id', id).order('team_number')),
      q(db.from('players').select('*').eq('quiz_id', id).order('player_number')),
      q(db.from('round_scores').select('*').eq('quiz_id', id)),
      q(db.from('tip_results').select('*').eq('quiz_id', id))]);
    if (!S.scoreRound) S.scoreRound = Math.min(S.quiz.current_round, 5);
  }
  render();
}

function ranking() {
  const l = S.teams.map(t => ({ ...t, total: S.scores.filter(s => s.team_id === t.id).reduce((a, s) => a + Number(s.points), 0) }));
  l.sort((a, b) => b.total - a.total || a.team_number - b.team_number);
  l.forEach(x => x.rank = 1 + l.filter(y => y.total > x.total).length);
  return l;
}
const rankTable = () => `<table><tr><th>Pořadí</th><th>Tým</th><th class="n">Body</th></tr>${ranking().map(x =>
  `<tr><td>${x.rank}</td><td>${esc(x.display_name)}</td><td class="n"><b>${Number(x.total.toFixed(2))}</b></td></tr>`).join('')}</table>`;

function render() {
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.t === S.tab));
  $('#hdr').innerHTML = S.quiz ? '<button class="gold" style="padding:6px 12px;min-height:36px" onclick="askNew()">Nový kvíz</button>' : '';
  const v = { sort: viewSort, tip: viewTip, res: viewRes }[S.tab];
  $('#app').innerHTML = !S.authed ? viewLogin() : !S.quiz ? viewNew() : v();
}

/* ---------- přihlášení a nový kvíz ---------- */
const viewLogin = () => `<div class="card"><h2>Přihlášení moderátora</h2>
  <label>E-mail</label><input id="em" type="email" autocomplete="username"><label>Heslo</label><input id="pw" type="password" autocomplete="current-password">
  <p></p><button onclick="login()">Přihlásit se</button></div>`;
async function login() {
  const { error } = await db.auth.signInWithPassword({ email: $('#em').value.trim(), password: $('#pw').value });
  if (error) return toast('Přihlášení se nezdařilo. Zkontrolujte e-mail a heslo.');
  S.authed = true; act(load);
}
const viewNew = () => `<div class="card"><h2>NOVÝ KVÍZ</h2><label>Počet týmů</label>
  <input id="tc" inputmode="numeric" placeholder="např. 4"><p></p><button class="gold" onclick="createQuiz()">Vytvořit kvíz</button></div>`;
async function createQuiz() {
  const n = num($('#tc').value);
  if (n === null) return toast('Zadejte počet týmů.');
  if (!Number.isInteger(n) || n < 2 || n > 20) return toast('Počet týmů musí být celé číslo od 2 do 20.');
  act(async () => {
    await q(db.from('quizzes').update({ active: false }).eq('active', true));
    const [qz] = await q(db.from('quizzes').insert({ team_count: n, current_round: 1, active: true }).select());
    await q(db.from('teams').insert(Array.from({ length: n }, (_, i) => ({ quiz_id: qz.id, team_number: i + 1, display_name: 'Tým ' + (i + 1) }))));
    Object.assign(S, { tipRound: 1, scoreRound: null, last: null, tab: 'sort' });
    await load(); toast('✓ Kvíz je připraven', true);
  });
}
const askNew = () => confirmDlg('Opravdu chcete začít nový kvíz? Tím se smaže aktuální rozřazení, body a výsledky.', 'Ano, nový kvíz', async () => {
  await act(async () => { await q(db.from('quizzes').update({ active: false }).eq('active', true)); S.quiz = null; Object.assign(S, { last: null, scoreRound: null }); render(); });
});

/* ---------- 1. Rozřazení ---------- */
function viewSort() {
  const qz = S.quiz, T = S.teams.length;
  let h = `<div class="card"><b>✓ Kvíz je připraven</b><br>${T} týmy/ů · 5 kol</div>`;
  if (!qz.player_count) return h + `<div class="card"><h2>ROZŘAZENÍ</h2><p>Počet týmů: <b>${T}</b></p><label>Počet hráčů</label>
    <input id="pc" inputmode="numeric" placeholder="např. 10"><p></p><button class="gold" onclick="setPlayers()">Zahájit rozřazování</button></div>`;
  const P = qz.player_count, n = S.players.length, done = n >= P;
  if (S.last && S.last.quiz === qz.id) {
    const nm = tname(S.last.team);
    h += `<div class="card hero"><h1>Jsi v týmu ${esc(short(nm))} 🎉</h1><p>Hráč ${S.last.n}</p><button class="ghost" onclick="S.last=null;render()">Další hráč</button></div>`;
  } else h += `<div class="card"><h2>ROZŘAZENÍ</h2><p><b>Rozřazeno: ${n} / ${P} hráčů</b></p>
    ${done ? '<p class="res">✓ Všichni hráči jsou rozřazeni.</p>' : ''}<button class="big gold" ${done ? 'disabled' : ''} onclick="allocate()">ROZŘAĎ MNE</button></div>`;
  h += `<div class="card"><table>${S.teams.map(t => `<tr><td>${esc(t.display_name)}</td><td class="n">${S.players.filter(p => p.team_id === t.id).length} hráči</td></tr>`).join('')}</table></div>`;
  if (n) h += `<div class="card"><table><tr><th>Hráč</th><th>Tým</th></tr>${S.players.map(p => `<tr><td>Hráč ${p.player_number}</td><td>${esc(tname(p.team_id))}</td></tr>`).join('')}</table></div>`;
  return h;
}
function setPlayers() {
  const n = num($('#pc').value);
  if ($('#pc').value.trim() === '') return toast('Zadejte počet hráčů.');
  if (n === null || !Number.isInteger(n)) return toast('Zadejte platné číslo.');
  if (n < 1) return toast('Počet hráčů musí být alespoň 1.');
  act(async () => { await q(db.from('quizzes').update({ player_count: n }).eq('id', S.quiz.id)); await load(); });
}
function allocate() {
  act(async () => {
    const players = await q(db.from('players').select('*').eq('quiz_id', S.quiz.id));   // čerstvá data ze serveru
    const P = S.quiz.player_count, T = S.teams.length;
    if (players.length >= P) { await load(); return toast('Všichni hráči jsou již rozřazeni.'); }
    const base = Math.floor(P / T), extra = P % T;               // cílové velikosti: `extra` týmů má base+1, ostatní base
    const cnt = Object.fromEntries(S.teams.map(t => [t.id, 0])); players.forEach(p => cnt[p.team_id]++);
    const full = S.teams.filter(t => cnt[t.id] > base).length;   // týmy, které už mají „větší“ velikost
    const eligible = S.teams.filter(t => cnt[t.id] < base || (cnt[t.id] === base && full < extra));
    const team = eligible[Math.floor(Math.random() * eligible.length)];
    const n = players.length + 1;
    await q(db.from('players').insert({ quiz_id: S.quiz.id, player_number: n, team_id: team.id }));
    S.last = { quiz: S.quiz.id, n, team: team.id };
    await load();
  });
}

/* ---------- 2. Tipovačka ---------- */
function tipEval(correct, answers) {   // answers: [{t, a}]
  const d = answers.map(x => ({ ...x, d: Math.round(Math.abs(x.a - correct) * 1e6) / 1e6 }));
  const m = Math.min(...d.map(x => x.d)), w = d.filter(x => x.d === m);
  return w.length > 1 ? `Shoda – ${joinCz(w.map(x => x.t.display_name))}` : `Bod za tip získává tým ${short(w[0].t.display_name)}`;
}
function viewTip() {
  const r = S.tipRound, st = S.tips.filter(x => x.round_number === r), val = id => (st.find(x => x.team_id === id) || {}).answer ?? '';
  const stored = st.length === S.teams.length;
  return `<div class="card"><h2>TIPOVAČKA – KOLO ${r}</h2>
  <div class="nav2"><button class="ghost" ${r === 1 ? 'disabled' : ''} onclick="tipGo(-1)">←</button><b>KOLO ${r}</b><button class="ghost" ${r === 5 ? 'disabled' : ''} onclick="tipGo(1)">→</button></div>
  <table><tr><td><b>Správná odpověď</b></td><td><input id="tc" inputmode="decimal" value="${stored ? st[0].correct_answer : ''}"></td></tr>
  ${S.teams.map(t => `<tr><td>${esc(t.display_name)}</td><td><input data-id="${t.id}" class="ta" inputmode="decimal" value="${val(t.id)}"></td></tr>`).join('')}</table>
  <p></p><button class="gold" onclick="tipSave()">Vyhodnotit tip</button>
  ${stored ? `<div class="res">${tipEval(Number(st[0].correct_answer), S.teams.map(t => ({ t, a: Number(val(t.id)) })))}</div>` : ''}</div>`;
}
const tipGo = d => { S.tipRound += d; render(); };
function tipSave() {
  const c = num($('#tc').value), a = [...document.querySelectorAll('.ta')].map(i => ({ id: i.dataset.id, raw: i.value.trim(), v: num(i.value) }));
  if ($('#tc').value.trim() === '') return toast('Zadejte správnou odpověď.');
  if (a.some(x => x.raw === '')) return toast('Vyplňte odpověď všech týmů.');
  if (c === null || a.some(x => x.v === null)) return toast('Zadejte platné číslo.');
  act(async () => {
    await q(db.from('tip_results').upsert(a.map(x => ({ quiz_id: S.quiz.id, team_id: x.id, round_number: S.tipRound, correct_answer: c, answer: x.v, difference: Math.abs(x.v - c) })), { onConflict: 'team_id,round_number' }));
    await load();
  });
}

/* ---------- 3. Výsledky ---------- */
function viewRes() {
  const cur = S.quiz.current_round, r = S.scoreRound, val = id => (S.scores.find(s => s.team_id === id && s.round_number === r) || {}).points ?? '';
  let h = cur > 5 ? `<div class="done">KVÍZ DOKONČEN<br>🏆 KONEČNÉ POŘADÍ</div>` : '';
  h += `<div class="chips">${[1, 2, 3, 4, 5].map(i => `<button class="${i === cur ? 'cur' : ''} ${i === r ? 'sel' : ''}" ${i > cur ? 'disabled' : ''} onclick="S.scoreRound=${i};render()">${i}${i < cur ? ' ✓' : i > cur ? ' 🔒' : ''}</button>`).join('')}</div>
  <div class="card"><h2>KOLO ${r}</h2><table><tr><th>Tým</th><th class="n">Body</th></tr>
  ${S.teams.map(t => `<tr><td>${esc(t.display_name)}</td><td><input class="sc" data-id="${t.id}" inputmode="decimal" value="${val(t.id)}"></td></tr>`).join('')}</table>
  <p></p><button class="gold" onclick="sendScores()">ODESLAT BODY</button></div>
  <div class="card"><h2>${cur > 5 ? 'KONEČNÉ POŘADÍ' : 'Průběžné pořadí'}</h2>${rankTable()}</div>
  <details class="card"><summary><b>Názvy týmů</b></summary>${S.teams.map(t => `<label>Tým ${t.team_number}</label><input class="nm" data-id="${t.id}" value="${esc(t.display_name)}" maxlength="30">`).join('')}
  <p></p><button class="ghost" onclick="saveNames()">Uložit názvy</button></details>`;
  return h;
}
function sendScores() {
  const a = [...document.querySelectorAll('.sc')].map(i => ({ id: i.dataset.id, raw: i.value.trim(), v: num(i.value) }));
  if (a.some(x => x.raw === '')) return toast('Zadejte body pro všechny týmy.');
  if (a.some(x => x.v === null)) return toast('Zadejte platné číslo.');
  const r = S.scoreRound;
  act(async () => {
    await q(db.from('round_scores').upsert(a.map(x => ({ quiz_id: S.quiz.id, team_id: x.id, round_number: r, points: x.v })), { onConflict: 'team_id,round_number' })); // opakované odeslání kolo přepíše
    if (r === S.quiz.current_round) await q(db.from('quizzes').update({ current_round: r + 1 }).eq('id', S.quiz.id));
    S.scoreRound = null; await load(); toast(`✓ Body kola ${r} uloženy`, true);
  });
}
function saveNames() {
  const a = [...document.querySelectorAll('.nm')].map(i => ({ id: i.dataset.id, n: i.value.trim() }));
  if (a.some(x => !x.n)) return toast('Název týmu nesmí být prázdný.');
  act(async () => { for (const x of a) await q(db.from('teams').update({ display_name: x.n }).eq('id', x.id)); await load(); toast('✓ Názvy uloženy', true); });
}

document.querySelector('nav').addEventListener('click', e => { const t = e.target.closest('button'); if (t) { S.tab = t.dataset.t; render(); } });
(async () => {
  try { S.authed = !!(await db.auth.getSession()).data.session; if (S.authed) await load(); else render(); }
  catch (e) { console.error(e); render(); toast('⚠ Připojení k serveru bylo ztraceno.'); }
})();
