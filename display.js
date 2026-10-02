const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const rows = {}, board = document.getElementById('board');
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

async function load() {
  try {
    const { data: qz, error } = await db.from('quizzes').select('*').eq('active', true).order('created_at', { ascending: false }).limit(1);
    if (error) throw error;
    const quiz = qz[0];
    document.getElementById('empty').hidden = !!quiz;
    if (!quiz) { board.innerHTML = ''; Object.keys(rows).forEach(k => delete rows[k]); return; }
    const [t, s] = await Promise.all([
      db.from('teams').select('*').eq('quiz_id', quiz.id).order('team_number'),
      db.from('round_scores').select('*').eq('quiz_id', quiz.id)]);
    if (t.error || s.error) throw (t.error || s.error);
    const list = t.data.map(x => ({ id: x.id, name: x.display_name,
      total: s.data.filter(r => r.team_id === x.id).reduce((a, r) => a + Number(r.points), 0) }));
    list.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'cs'));
    list.forEach(x => x.rank = 1 + list.filter(y => y.total > x.total).length);
    document.getElementById('title').textContent = quiz.current_round > 5 ? '🏆 KONEČNÉ POŘADÍ' : '🏆 PRŮBĚŽNÉ POŘADÍ';
    render(list);
  } catch (e) { console.error(e); }
}

function render(list) {
  board.style.setProperty('--n', list.length);
  document.body.style.setProperty('--n', list.length);
  Object.keys(rows).forEach(id => { if (!list.some(x => x.id === id)) { rows[id].remove(); delete rows[id]; } });
  list.forEach((x, i) => {
    let el = rows[x.id];
    if (!el) { el = rows[x.id] = document.createElement('div'); el.className = 'row';
      el.innerHTML = '<span class="k"></span><span class="t"></span><span class="p"></span>';
      el.style.top = `calc(var(--rh) * ${i})`; board.appendChild(el); }
    el.querySelector('.k').textContent = x.rank;
    el.querySelector('.t').textContent = x.name;
    el.querySelector('.p').textContent = Number(x.total.toFixed(2));
    el.classList.toggle('top', x.rank === 1 && x.total > 0);
    requestAnimationFrame(() => el.style.top = `calc(var(--rh) * ${i})`);
  });
}

let timer;
const soon = () => { clearTimeout(timer); timer = setTimeout(load, 150); };
db.channel('board').on('postgres_changes', { event: '*', schema: 'public' }, soon).subscribe();
setInterval(load, 20000); // záloha, kdyby se realtime spojení přerušilo
load();
