# 아이봄(AIBOM) — Vercel 배포 가이드

아이디어 검증 프로토타입을 **본인의 Anthropic API 키**로 온라인 배포합니다.
API 키는 **서버(환경변수)에만** 두고, 프론트엔드는 `/api/claude` 프록시만 호출합니다.
**사용량 상한에 도달하면 자동으로 중지**됩니다.

## 파일 구성
```
index.html          # 프론트엔드 (/api/claude 호출)
api/claude.js        # 서버리스 프록시 (여기서만 API 키 사용 + 사용량 상한)
vercel.json          # 함수 설정
package.json         # Node 런타임
```

## 배포 절차

### 1) GitHub에 업로드
이 4개 파일(폴더 구조 그대로)을 레포 `rlawjdxojk/AIBOM`의 `main` 브랜치 최상단에 올립니다.
`index.html`은 반드시 루트에 있어야 합니다(그래야 첫 화면이 열립니다).

### 2) Anthropic API 키 발급 + 지출 한도 설정 ★중요
1. https://console.anthropic.com → **API Keys** 에서 키 발급 (`sk-ant-...`)
2. **Billing** 에서 결제수단 등록 / 크레딧 충전
3. **Billing → Usage limits(월 지출 한도)** 를 원하는 금액으로 설정
   - 이것이 **진짜 하드스톱**입니다. 이 금액을 넘기면 Anthropic이 호출을 막고,
     본 앱은 그 오류를 감지해 화면에 "사용 한도 도달 — 중지"를 표시합니다.
   - ⚠️ 이 구독(Claude Pro/Max)과 **API 사용료는 별개**로 과금됩니다.

### 3) Vercel에서 환경변수 설정
Vercel → New Project → GitHub 레포 Import → **Environment Variables** 에 입력:

| 변수 | 필수 | 설명 |
|---|---|---|
| `ANTHROPIC_API_KEY` | ✅ | 발급받은 `sk-ant-...` 키 |
| `MAX_CALLS` | 선택 | 이번 달 허용 호출 수(기본 300). 이 수에 도달하면 앱이 자동 중지 |
| `CLAUDE_MODEL` | 선택 | 기본 `claude-haiku-4-5-20251001`(가장 저렴). 품질 우선이면 `claude-sonnet-5` 등으로 변경 — 정확한 모델 ID는 콘솔에서 확인 |
| `MAX_TOKENS` | 선택 | 응답 최대 토큰(기본 1000) |

그런 다음 **Deploy** 를 누릅니다.

### 4) (선택) 정확한 전역 사용량 카운터 — Vercel KV
`MAX_CALLS` 상한을 여러 사용자에 걸쳐 **정확히** 집계하려면 KV를 붙이세요.
- Vercel 프로젝트 → **Storage → Create → KV(Upstash)** 생성 후 프로젝트에 연결
- `KV_REST_API_URL`, `KV_REST_API_TOKEN` 이 자동 주입됩니다(추가 코드 불필요)
- KV가 없으면 서버 인스턴스 메모리로 근사 집계하며, 콜드스타트 시 초기화될 수 있습니다.
  (그래도 2)의 Anthropic 지출 한도가 최종 안전장치입니다.)

## 사용량 상한 동작 방식 (2겹 안전장치)
1. **앱 상한(`MAX_CALLS`)**: 호출 수가 상한에 도달하면 `/api/claude`가 429를 반환하고,
   화면 상단에 중지 배너가 뜨며 이후 호출이 막힙니다. 헤더에 `사용량 %`가 표시됩니다.
2. **Anthropic 지출 한도**: 금액 기준 하드스톱. 초과 시 앱이 감지해 동일하게 중지 처리.

## 보안 주의
- **API 키를 절대 `index.html`이나 프론트 코드에 넣지 마세요.** 소스에서 노출됩니다.
- 키는 오직 Vercel 환경변수 → `api/claude.js` 안에서만 사용됩니다.
- 링크를 불특정 다수에게 공개할 경우 `MAX_CALLS`를 낮게 잡고 Anthropic 지출 한도를 함께 설정하세요.

## 로컬 미리보기(선택)
```
npm i -g vercel
vercel dev        # ANTHROPIC_API_KEY 등 환경변수를 .env.local 에 두고 실행
```

## 참고
- 페르소나 데이터 구조는 NVIDIA **Nemotron-Personas-Korea**(CC BY 4.0)를 따릅니다.
  실제 700만 레코드/상권 통계 연동은 별도 백엔드 작업이 필요합니다(프로토타입은 구조 기반 생성).
- 네트워크/일시 오류 시에는 끊김 없이 "오프라인 샘플" 응답으로 대체됩니다(시연 안전).
