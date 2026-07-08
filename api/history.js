// AIBOM · 사용 내역 저장/조회 (Vercel Serverless)
// GET  /api/history        → 로그인 사용자의 저장된 내역 반환
// POST /api/history {problem, data} → 한 건 저장 (최근 50건 유지)
// 로그인(세션 쿠키) 필요.
const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const KV = !!(KV_URL && KV_TOKEN);

// Supabase(Postgres)에 완주 세션 적재 (REST, 실패해도 KV 저장/응답에 영향 없음)
async function sbInsert(table, row){
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  try {
    await fetch(url.replace(/\/+$/,"") + "/rest/v1/" + table, {
      method: "POST",
      headers: { apikey: key, Authorization: "Bearer " + key, "content-type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(row)
    });
  } catch(_) {}
}

async function redis(cmd){
  const r = await fetch(KV_URL, { method:"POST",
    headers:{ Authorization:"Bearer "+KV_TOKEN, "content-type":"application/json" },
    body: JSON.stringify(cmd) });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}
function cookies(req){
  const h = req.headers.cookie || ""; const o = {};
  h.split(";").forEach(p=>{ const i=p.indexOf("="); if(i>0) o[p.slice(0,i).trim()]=decodeURIComponent(p.slice(i+1).trim()); });
  return o;
}

module.exports = async (req, res) => {
  if (!KV) return res.status(200).json({ user: null, history: [] });
  const sid = cookies(req).aibom_sess;
  let u = null;
  if (sid) { try { const raw = await redis(["GET","aibom:sess:"+sid]); if (raw) u = JSON.parse(raw); } catch(_){} }
  if (!u) return res.status(401).json({ error: "로그인이 필요합니다.", user: null });

  const key = "aibom:hist:" + u.id;

  if (req.method === "GET") {
    let list = [];
    try { const raw = await redis(["GET", key]); if (raw) list = JSON.parse(raw); } catch(_){}
    return res.status(200).json({ user: { provider: u.provider, name: u.name }, history: list });
  }

  if (req.method === "POST") {
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch(_){ body = {}; } }
    let list = [];
    try { const raw = await redis(["GET", key]); if (raw) list = JSON.parse(raw); } catch(_){}
    const item = {
      t: Date.now(),
      problem: String(body && body.problem || "").slice(0, 2000),
      data: (body && body.data) || {}
    };
    list.unshift(item);
    list = list.slice(0, 50);
    await redis(["SET", key, JSON.stringify(list)]);

    // Supabase 분석 테이블에 세션 1행 적재 (집계용 숫자 컬럼 + 원본 jsonb)
    try {
      const d = item.data || {};
      const judges = d.judges || {};
      const jv = Object.keys(judges).map(k => Number(judges[k] && judges[k].score)).filter(n => !isNaN(n));
      const avg = jv.length ? Math.round((jv.reduce((a,b)=>a+b,0)/jv.length)*100)/100 : null;
      const chats = d.chats || {};
      const msgCount = Object.keys(chats).reduce((a,k)=>a + (Array.isArray(chats[k]) ? chats[k].length : 0), 0);
      await sbInsert("validation_runs", {
        user_provider: u.provider, user_id: u.id, user_name: u.name,
        problem: item.problem,
        persona_count: (d.personas || []).length,
        message_count: msgCount,
        avg_judge_score: avg,
        region_count: ((d.solution || {}).regions || []).length,
        cells: d.cells || {}, personas: d.personas || [], selected: d.selected || [],
        chats: chats, judges: judges, solution: d.solution || null
      });
    } catch(_) {}

    return res.status(200).json({ ok: true, count: list.length });
  }

  return res.status(405).json({ error: "GET 또는 POST만 허용됩니다." });
};
