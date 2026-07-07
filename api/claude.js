// AIBOM · Claude 프록시 + 사용량/남용 방지 (Vercel Serverless)
// - 프론트는 /api/claude 만 호출. Anthropic 키는 서버에만 존재.
// - 전체 상한(MAX_CALLS) + 1인(IP) 하루 상한(MAX_CALLS_PER_IP)으로 남용 방지.
// - 정확한 전역/IP 카운터를 위해 Vercel KV(Upstash) 연결을 권장(필수에 가까움).
//   KV 미연결 시 전역은 메모리 근사, IP 제한은 비활성(README 참고).

const LIMIT      = parseInt(process.env.MAX_CALLS || "6000", 10);        // 이번 달 전체 허용 호출 수
const MAX_PER_IP = parseInt(process.env.MAX_CALLS_PER_IP || "40", 10);   // 1인(IP) 하루 허용 호출 수
const MODEL      = process.env.CLAUDE_MODEL || "claude-sonnet-5";        // 기본: Sonnet 5 (정교함/비용 균형)
const MAX_TOKENS = parseInt(process.env.MAX_TOKENS || "2000", 10);
const KV_URL     = process.env.KV_REST_API_URL;
const KV_TOKEN   = process.env.KV_REST_API_TOKEN;
const KV         = !!(KV_URL && KV_TOKEN);

function ym(){const d=new Date();return d.getUTCFullYear()+"-"+String(d.getUTCMonth()+1).padStart(2,"0");}
function ymd(){const d=new Date();return ym()+"-"+String(d.getUTCDate()).padStart(2,"0");}

async function redis(cmd){
  const r = await fetch(KV_URL, { method:"POST",
    headers:{ Authorization:"Bearer "+KV_TOKEN, "content-type":"application/json" },
    body: JSON.stringify(cmd) });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}

let mem = { month:"", n:0 };
async function getUsed(){
  if (KV){ const v = await redis(["GET","aibom:calls:"+ym()]); return parseInt(v||"0",10)||0; }
  const m = ym(); if (mem.month!==m) mem={month:m,n:0}; return mem.n;
}
async function bumpGlobal(){
  if (KV){ await redis(["INCR","aibom:calls:"+ym()]); return; }
  const m = ym(); if (mem.month!==m) mem={month:m,n:0}; mem.n++;
}
async function bumpIP(ip){
  if (!KV) return 0;                       // KV 없으면 IP 제한 비활성(통과)
  const key = "aibom:ip:"+ymd()+":"+ip;
  const n = await redis(["INCR", key]);
  if (n===1) await redis(["EXPIRE", key, 172800]); // 2일 후 만료
  return n;
}

module.exports = async (req, res) => {
  let used = 0; try { used = await getUsed(); } catch(_){}

  if (req.method === "GET") {
    return res.status(200).json({ used, limit: LIMIT, capped: used >= LIMIT });
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST만 허용됩니다." });
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: "서버에 ANTHROPIC_API_KEY가 설정되지 않았습니다." });

  // 전체 상한
  if (used >= LIMIT) {
    return res.status(429).json({ capped: true, used, limit: LIMIT, error: "전체 사용 한도(" + LIMIT + "회)에 도달하여 중지되었습니다." });
  }

  // 1인(IP) 하루 상한
  const ip = (((req.headers["x-forwarded-for"] || "").split(",")[0]) || "").trim() || "unknown";
  let ipN = 0; try { ipN = await bumpIP(ip); } catch(_){}
  if (ipN > MAX_PER_IP) {
    return res.status(429).json({ ipLimited: true, error: "1인 체험 한도(" + MAX_PER_IP + "회)에 도달했습니다." });
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch(_){ body = {}; } }
  const messages = body && body.messages;
  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: "messages 배열이 필요합니다." });
  }

  const payload = { model: MODEL, max_tokens: Math.min(Number(body.max_tokens) || 1400, MAX_TOKENS), messages };
  const t = Number(body.temperature);
  if (!isNaN(t)) payload.temperature = Math.max(0, Math.min(1, t));

  try {
    const ar = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type":"application/json", "x-api-key": key, "anthropic-version":"2023-06-01" },
      body: JSON.stringify(payload),
    });
    const data = await ar.json();
    if (!ar.ok) {
      const msg = (data && data.error && data.error.message) || ("Anthropic API 오류 (HTTP " + ar.status + ")");
      const lowCredit = /credit|balance|billing|payment/i.test(msg);
      return res.status(ar.status).json({ apiError: true, lowCredit, used, limit: LIMIT, error: msg });
    }
    try { await bumpGlobal(); } catch(_){}
    let nowUsed = used + 1; try { nowUsed = await getUsed(); } catch(_){}
    return res.status(200).json({ content: data.content, usage: { used: nowUsed, limit: LIMIT, capped: nowUsed >= LIMIT } });
  } catch (e) {
    return res.status(502).json({ error: "프록시 호출 실패: " + String((e && e.message) || e), used, limit: LIMIT });
  }
};
