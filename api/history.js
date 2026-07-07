// AIBOM · 사용 내역 저장/조회 (Vercel Serverless)
// GET  /api/history        → 로그인 사용자의 저장된 내역 반환
// POST /api/history {problem, data} → 한 건 저장 (최근 50건 유지)
// 로그인(세션 쿠키) 필요.
const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const KV = !!(KV_URL && KV_TOKEN);

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
    return res.status(200).json({ ok: true, count: list.length });
  }

  return res.status(405).json({ error: "GET 또는 POST만 허용됩니다." });
};
