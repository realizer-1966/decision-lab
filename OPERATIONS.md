# decision-lab 운영 노트 (2026-09-30)

## 오늘 해결된 이슈

### 1. 연결테스트 HTTP 404
- **원인**: `worker/wrangler.toml`의 `main = "src/worker.js"` 배포 시 0.35KiB 빈 스크립트로 업로드됨
  (루트 wrangler.jsonc의 assets-only 설정이 worker 스크립트를 덮어씀)
- **해결**: `main = "worker-root.js"`(bundled ES모듈)로 지정 → /api/decide 부활 (커밋 20dd80d)

### 2. 연결테스트 HTTP 401
- **원인**: 404 복구 과정에서 Worker 시크릿이 유실되어 ollaya 데몬 키를 잘못 심음.
  ollama.com용 `OLLAMA_COM_KEY`는 ollaya 데몬 키와 별개의 API 키.
- **해결**: 올바른 ollama.com 키로 재심 (값은 Worker 시크릿으로만 보관).

## Cloudflare 시크릿 재심 절차 (재발 시 그대로 사용)
1. `wrangler.toml`에 시크릿 이름이 [vars]에 있으면 제거 후 deploy (Binding name conflict 방지)
2. `printf '<키>' | npx wrangler secret put OLLAMA_COM_KEY --config ./wrangler.toml`
3. secret put은 active 승격이 자동이 아님 → Cloudflare API `/versions` 에서 created_on 내림차순으로
   신규 버전 ID 확인 → `npx wrangler versions deploy <버전ID>@100 --config ./wrangler.toml`
4. 검증: `curl -X POST /api/decide` → 200 (chat-completions-decision 엔진)

## 현재 배포 상태
- 앱: https://decision-lab.dydtnsp.workers.dev (?v16)
- 엔진 라우팅: 내 ollaya 모델(★) → 노트북 ollaya / tev1·nimble → 노트북 ollama / 나머지 → 클라우드 Worker
- Worker 시크릿: OLLAMA_COM_KEY (ollama.com API 키)
