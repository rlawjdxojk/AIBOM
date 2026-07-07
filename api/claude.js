// AIBOM · Claude 프록시 (Vercel Serverless Function)
// - 프론트엔드는 이 엔드포인트(/api/claude)만 호출합니다. Anthropic 키는 서버에만 존재.
// - 사용량 상한(MAX_CALLS)에 도달하면 자동 중지(429)합니다.
// - Vercel KV(Upstash)가 연결돼 있으면 월 단위 전역 카운터로 정확히 집계하고,
//   없으면 인스턴스 메모리로 근사 집계합니다(콜드스타트 시 초기화 가능).
// - 진짜 하드스톱은 Anthropic 콘솔의 "월 지출 한도"입니다. 한도 초과 시 여기서 감지해 중지 처리합니다.

const LIMIT = parseInt(process.env.MAX_CALLS || "300", 10);           // 이번 달 허용 호출 수
const MODEL = process.env.CLAUDE_MODEL || "claude-haiku-4-5-20251001"; // 비용 최소 모델(기본). 필요시 claude-sonnet-5 등으로 변경
const MAX_TOKENS = parseInt(process.env.MAX_TOKENS || "1000", 10);
const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

let mem = { month: "", n: 0 };
function ym() {
  const d = new Date();
  return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0");
}
async function kv(path) {
  const r = await fetch(`${KV_URL}/${path}`, { headers: { Authorization: `Bearer ${KV_TOKEN}` } });
  const j = await r.json();
  return j.result;
}
async function getUsed() {
  const m = ym();
  if (KV_URL && KV_TOKEN) {
    const v = await kv(`get/aibom:calls:${m}`);
    return parseInt(v || "0", 10) || 0;
  }
  if (mem.month !== m) mem = { month: m, n: 0 };
  return mem.n;
}
async function bump() {
  const m = ym();
  if (KV_URL && KV_TOKEN) { await kv(`incr/aibom:calls:${m}`); return; }
  if (mem.month !== m) mem = { month: m, n: 0 };
  mem.n++;
}

module.exports = async (req, res) => {
  const used = await getUsed().catch(() => 0);

  // 사용량 조회 (프론트 로드 시)
  if (req.method === "GET") {
    return res.status(200).json({ used, limit: LIMIT, stopped: used >= LIMIT });
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST만 허용됩니다." });
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return res.status(500).json({ error: "서버에 ANTHROPIC_API_KEY가 설정되지 않았습니다. Vercel 환경변수를 확인하세요." });
  }

  // 앱 레벨 상한 도달 → 자동 중지
  if (used >= LIMIT) {
    return res.status(429).json({ stopped: true, used, limit: LIMIT, error: "이번 달 사용 한도(100%)에 도달하여 중지되었습니다." });
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (_) { body = {}; } }
  const messages = body && body.messages;
  if (!Array.isArray(messages) || !messages.length) {
    return res.status(400).json({ error: "messages 배열이 필요합니다." });
  }

  try {
    const ar = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: Math.min(Number(body.max_tokens) || MAX_TOKENS, MAX_TOKENS),
        messages,
      }),
    });
    const data = await ar.json();

    if (!ar.ok) {
      // Anthropic 오류. 지출 한도/크레딧 소진이면 중지로 처리.
      const blob = JSON.stringify(data || {});
      const billing = /credit|billing|quota|balance|payment|limit|exceed/i.test(blob);
      return res.status(ar.status).json({
        stopped: billing,
        used, limit: LIMIT,
        error: (data && data.error && data.error.message) || "Anthropic API 오류",
      });
    }

    await bump().catch(() => {});
    const nowUsed = await getUsed().catch(() => used + 1);
    return res.status(200).json({
      content: data.content,
      usage: { used: nowUsed, limit: LIMIT, stopped: nowUsed >= LIMIT },
    });
  } catch (e) {
    return res.status(502).json({ error: "프록시 호출 실패: " + String((e && e.message) || e), used, limit: LIMIT });
  }
};
