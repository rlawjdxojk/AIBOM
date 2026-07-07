// AIBOM · 카카오 로그인 콜백 (Vercel Serverless)
// 등록된 Redirect URI: https://<도메인>/api/auth/kakao/callback
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

  const redirect = baseUrl(req) + "/api/auth/kakao/callback";
  try {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: process.env.KAKAO_REST_API_KEY || "",
      redirect_uri: redirect,
      code
    });
    if (process.env.KAKAO_CLIENT_SECRET) body.set("client_secret", process.env.KAKAO_CLIENT_SECRET);

    const tr = await fetch("https://kauth.kakao.com/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded;charset=utf-8" },
      body: body.toString()
    });
    const tj = await tr.json();
    if (!tj.access_token) return go(res, "/?login=token");

    const ur = await fetch("https://kapi.kakao.com/v2/user/me", {
      headers: { Authorization: "Bearer " + tj.access_token }
    });
    const uj = await ur.json();
    if (!uj.id) return go(res, "/?login=profile");

    const acc = uj.kakao_account || {};
    const prof = acc.profile || {};
    const name = prof.nickname || "카카오 사용자";
    const user = { provider: "kakao", id: "kakao:" + uj.id, name };

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
