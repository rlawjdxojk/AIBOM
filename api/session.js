// AIBOM · 세션 엔드포인트 (Vercel Serverless)
// GET /api/session?a=login&provider=kakao|naver  → 각 제공사 로그인 화면으로 리다이렉트
// GET /api/session?a=me                           → { user: {provider,name} | null }
// GET /api/session?a=logout                       → 세션 삭제
// 세션은 Upstash KV(aibom:sess:<sid>)에 저장하고 브라우저에는 sid 쿠키만 둔다.

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
function baseUrl(req){ return "https://" + (req.headers["x-forwarded-host"] || req.headers.host); }
function rand(n){ const c="abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"; let s=""; for(let i=0;i<n;i++) s+=c[Math.floor(Math.random()*c.length)]; return s; }

module.exports = async (req, res) => {
  const url = new URL(req.url, "http://x");
  const a = url.searchParams.get("a") || "me";
  const ck = cookies(req);

  if (a === "login") {
    const provider = url.searchParams.get("provider");
    const redirect = baseUrl(req) + "/api/auth/" + provider + "/callback";
    const state = rand(16);
    res.setHeader("Set-Cookie", "aibom_ost="+state+"; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600");
    let auth;
    if (provider === "kakao") {
      const id = process.env.KAKAO_REST_API_KEY;
      if (!id) return res.status(500).json({ error: "KAKAO_REST_API_KEY 미설정" });
      auth = "https://kauth.kakao.com/oauth/authorize?response_type=code&client_id="+id+"&redirect_uri="+encodeURIComponent(redirect)+"&state="+state;
    } else if (provider === "naver") {
      const id = process.env.NAVER_CLIENT_ID;
      if (!id) return res.status(500).json({ error: "NAVER_CLIENT_ID 미설정" });
      auth = "https://nid.naver.com/oauth2.0/authorize?response_type=code&client_id="+id+"&redirect_uri="+encodeURIComponent(redirect)+"&state="+state;
    } else {
      return res.status(400).json({ error: "provider는 kakao 또는 naver" });
    }
    res.writeHead(302, { Location: auth }); res.end(); return;
  }

  if (a === "logout") {
    const sid = ck.aibom_sess;
    if (sid && KV) { try { await redis(["DEL","aibom:sess:"+sid]); } catch(_){} }
    res.setHeader("Set-Cookie", "aibom_sess=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
    return res.status(200).json({ ok: true });
  }

  // a === "me"
  const sid = ck.aibom_sess;
  if (!sid || !KV) return res.status(200).json({ user: null });
  try {
    const raw = await redis(["GET","aibom:sess:"+sid]);
    if (!raw) return res.status(200).json({ user: null });
    const u = JSON.parse(raw);
    return res.status(200).json({ user: { provider: u.provider, name: u.name } });
  } catch(_) {
    return res.status(200).json({ user: null });
  }
};
