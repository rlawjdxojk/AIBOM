// AIBOM · 네이버 로그인 콜백 (Vercel Serverless)
// 등록된 Callback URL: https://<도메인>/api/auth/naver/callback
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
function rand(n){ const c="abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"; let s=""; for(let i=0;i<n;i++) s+=c[Math.floor(Math.random()*c.length)]; return s; }
function go(res, path){ res.writeHead(302, { Location: path }); res.end(); }

module.exports = async (req, res) => {
  const url = new URL(req.url, "http://x");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const ck = cookies(req);

  if (url.searchParams.get("error")) return go(res, "/?login=denied");
  if (!code) return go(res, "/?login=error");
  if (!state || state !== ck.aibom_ost) return go(res, "/?login=state");
  if (!KV) return go(res, "/?login=nokv");

  try {
    const tokenUrl = "https://nid.naver.com/oauth2.0/token"
      + "?grant_type=authorization_code"
      + "&client_id=" + encodeURIComponent(process.env.NAVER_CLIENT_ID || "")
      + "&client_secret=" + encodeURIComponent(process.env.NAVER_CLIENT_SECRET || "")
      + "&code=" + encodeURIComponent(code)
      + "&state=" + encodeURIComponent(state);
    const tr = await fetch(tokenUrl);
    const tj = await tr.json();
    if (!tj.access_token) return go(res, "/?login=token");

    const ur = await fetch("https://openapi.naver.com/v1/nid/me", {
      headers: { Authorization: "Bearer " + tj.access_token }
    });
    const uj = await ur.json();
    const r = uj.response || {};
    if (!r.id) return go(res, "/?login=profile");

    const name = r.name || r.nickname || "네이버 사용자";
    const user = { provider: "naver", id: "naver:" + r.id, name };

    const sid = rand(24);
    await redis(["SET", "aibom:sess:" + sid, JSON.stringify(user)]);
    await redis(["EXPIRE", "aibom:sess:" + sid, 2592000]);

    res.setHeader("Set-Cookie", [
      "aibom_sess=" + sid + "; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000",
      "aibom_ost=; Path=/; Max-Age=0"
    ]);
    return go(res, "/?login=ok");
  } catch (e) {
    return go(res, "/?login=error");
  }
};
