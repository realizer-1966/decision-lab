// decision-lab Worker — ollama.com /v1/systemone 프록시
// API 키는 wrangler secret OLLAMA_COM_KEY 로만 주입 (코드에 하드코딩 금지)
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/decide' && request.method === 'POST') {
      if (!env.OLLAMA_COM_KEY) {
        return jres(500, { error: { message: 'OLLAMA_COM_KEY 시크릿 미설정 — wrangler secret put OLLAMA_COM_KEY' } });
      }
      let body;
      try {
        body = await request.json();
      } catch (e) {
        return jres(400, { error: { message: 'JSON 파싱 실패' } });
      }
      const { model, state, questions, options } = body;
      if (!model || !questions || typeof questions !== 'object') {
        return jres(422, { error: { message: 'model과 questions(객체)는 필수입니다' } });
      }
      if (state === undefined) {
        return jres(422, { error: { message: 'state는 필수입니다 (문자열 또는 객체)' } });
      }

      const payload = { model, state, questions };
      if (options && typeof options === 'object') payload.options = options;

      const upstream = await fetch('https://ollama.com/v1/systemone', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + env.OLLAMA_COM_KEY,
          'User-Agent': 'decision-lab-proxy/1.0'
        },
        body: JSON.stringify(payload)
      });

      const text = await upstream.text();
      // upstream이 JSON이면 그대로 통과, 아니면 래핑
      let data;
      try { data = JSON.parse(text); } catch (e) { data = null; }
      if (data !== null) return new Response(JSON.stringify(data), {
        status: upstream.status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store'
        }
      });
      return new Response(JSON.stringify({ error: { message: 'ollama.com 비JSON 응답', status: upstream.status, body: text.slice(0, 500) } }), {
        status: upstream.status === 200 ? 502 : upstream.status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // CORS preflight (앱이 다른 도메인에서 쓸 경우 대비)
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type'
        }
      });
    }

    return env.ASSETS.fetch(request);
  }
};

function jres(status, obj) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}