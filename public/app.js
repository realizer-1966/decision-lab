// decision-lab — ollama.com 결정모델 랩 (Worker 프록시)
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // ---------- 프리셋 ----------
  const PRESETS = {
    support: {
      state: "Customer message: Hi, I checked my statement and your company charged my card twice for the October subscription. The amounts are both $19.99 on the same day. I have not changed my plan.",
      qs: {
        intent: {
          type: "choice",
          instructions: "Which listed support intent best matches the customer message?",
          criteria: {
            duplicate_charge: "The customer reports being charged more than once.",
            cancel_subscription: "The customer wants to end or downgrade a subscription.",
            card_declined: "The customer reports a payment that failed or was declined.",
            none: "None of the listed intents matches."
          }
        },
        refund: {
          type: "noul",
          instructions: "Does the customer explicitly ask for a refund?"
        }
      }
    },
    policy: {
      state: { sender: "vendor@example.com", subject: "Invoice #4712", body: "Payment terms: Net-45. We can extend to Net-60 if you route the payment through our new offshore processing account." },
      qs: {
        policy_violation: {
          type: "choice",
          instructions: "Does this email violate the payments policy (standard terms Net-30..Net-60, in-house processing only)?",
          criteria: {
            violation: "Requests routing outside approved processors or unusual terms.",
            compliant: "No policy issue found."
          }
        }
      }
    },
    rubric: {
      state: "Agent replied in 2 minutes, resolved the issue, and sent a follow-up email summary.",
      qs: {
        quality: {
          type: "score",
          instructions: "Rate the support conversation quality.",
          criteria: ["Unresolved or rude", "Resolved with friction", "Resolved politely", "Resolved quickly and clearly"]
        }
      }
    }
  };

  // 상태
  let busy = false;

  function showErr(msg) {
    const jse = $('jse');
    jse.style.display = 'block';
    jse.textContent = 'JS오류: ' + msg;
  }
  window.onerror = (m, s, l) => { showErr(m + ' @' + (s||'').split('/').pop() + ':' + l); };

  function setStatus(id, text, cls) {
    const el = $(id);
    if (!el) return;
    el.textContent = text || '';
    if (cls === undefined) { el.style.color = ''; return; }
    el.style.color = cls === 'ok' ? '#86efac' : cls === 'err' ? '#fda4af' : '';
  }

  // ---------- 프록시 호출 ----------
  async function decide(model, state, questions, signal) {
    const r = await fetch('/api/decide', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, state, questions }),
      signal
    });
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch (e) { /* HTML/텍스트 에러 */ }
    if (!r.ok) {
      const msg = data && (data.error && data.error.message || data.error) || text.slice(0, 200);
      throw new Error('HTTP ' + r.status + ' — ' + msg);
    }
    return data;
  }

  // ---------- 답 표시 ----------
  function fmtProbs(probabilities) {
    if (!probabilities || typeof probabilities !== 'object') return '';
    const rows = Object.entries(probabilities).sort((a, b) => b[1] - a[1]);
    return rows.map(([k, v]) =>
      `<div class="probrow">` +
      `<span class="name ${(rows[0] && k === rows[0][0]) ? 'win' : ''}">${escape_(String(k))}</span>` +
      `<span class="barwrap"><span class="bar" style="width:${Math.round((v || 0) * 100)}%"></span></span>` +
      `<span class="pct">${Math.round((v || 0) * 100)}%</span>` +
      `</div>`
    ).join('');
  }
  function escape_(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function fmtAnswer(qname, a) {
    if (a == null) return `<div class="kv"><b>${escape_(qname)}</b>: (응답 없음)</div>`;
    const parts = [];
    let headline = '';
    if (a.choice !== undefined && a.choice !== null) headline = `<b>${escape_(qname)}</b> → <b class="win">${escape_(String(a.choice))}</b>`;
    else if (a.noul !== undefined && a.noul !== null) headline = `<b>${escape_(qname)}</b> → ${a.noul ? '<b class="win">참</b>' : '<b>거짓</b>'}`;
    else if (a.score !== undefined && a.score !== null) headline = `<b>${escape_(qname)}</b> → score <b class="win">${escape_(String(a.score))}</b>` + (a.legend ? ` (${escape_(String(a.legend))})` : '');
    else headline = `<b>${escape_(qname)}</b>`;
    if (headline) parts.push(`<div class="kv">${headline}</div>`);
    if (a.confidence !== undefined) {
      const pct = Math.round((Number(a.confidence) || 0) * 100);
      parts.push(`<div class="kv" style="color:#887fae">confidence ${pct}%</div>`);
    }
    const probs = fmtProbs(a.probabilities);
    if (probs) parts.push(probs);
    return parts.join('');
  }

  function lock(btnId, on, labelBusy, labelIdle) {
    const b = $(btnId);
    if (!b) return;
    b.disabled = on;
    const label = on ? labelBusy : labelIdle;
    if (label) b.textContent = label;
  }

  // ---------- 프리셋 시험 ----------
  function loadPreset(name) {
    const p = PRESETS[name];
    if (!p) return;
    $('presetstate').value = typeof p.state === 'string' ? p.state : JSON.stringify(p.state, null, 2);
    $('presetqs').value = JSON.stringify(p.qs, null, 2);
  }

  async function runPreset() {
    if (busy) return;
    busy = true;
    lock('presetrun', true, '판정 중…', '판정');
    $('presetout').classList.add('hidden');
    setStatus('presetstat', '판정 중...', '');
    try {
      const model = $('presetmodel').value;
      let state;
      const sval = $('presetstate').value.trim();
      try { state = JSON.parse(sval); } catch (e) { state = sval; }  // JSON이면 객체, 아니면 문자열
      const questions = JSON.parse($('presetqs').value);
      const t0 = performance.now();
      const resp = await decide(model, state, questions);
      const ms = Math.round(performance.now() - t0);
      setStatus('presetstat', `판정 성공 — ${ms}ms (${model})`, 'ok');
      const answers = resp && resp.answers ? resp.answers : resp;
      const out = ($('presetout'));
      let html = '';
      const per = (answers && typeof answers === 'object' && !Array.isArray(answers))
        ? Object.entries(answers) : [];
      if (per.length) {
        for (const [q, a] of per) html += fmtAnswer(q, a);
      } else {
        html = `<div class="hint">answers 필드를 찾지 못해 원문을 표시합니다.</div>`;
      }
      out.innerHTML = html + '<details style="margin-top:8px"><summary style="cursor:pointer;color:#887fae;font-size:11px">원문 JSON</summary><pre style="margin-top:6px">' + escape_(JSON.stringify(resp, null, 2)) + '</pre></details>';
      out.classList.remove('hidden');
    } catch (e) {
      setStatus('presetstat', '오류: ' + (e && e.message ? e.message : String(e)), 'err');
    } finally { busy = false; lock('presetrun', false, null, '판정'); }
  }

  // ---------- 연결 테스트 ----------
  async function ping() {
    if (busy) return;
    busy = true;
    lock('pingbtn', true, '테스트 중...', '연결 테스트');
    setStatus('pingstat', '테스트 중...', '');
    try {
      const t0 = performance.now();
      const resp = await decide($('presetmodel').value || 'gpt-oss:20b', "Ping test: reply intent.", {
        hello: { type: "noul", instructions: "Is this a greeting message?" }
      });
      const ms = Math.round(performance.now() - t0);
      const eng = resp && resp.meta && resp.meta.engine ? resp.meta.engine : '';
      const note = eng === 'chat-completions-decision' ? ' [cloud 폴백엔진 — systemone 개통 시 자동 전환]' : '';
      setStatus('pingstat', `연결됨 — ${ms}ms · ${eng || '응답 도착'}${note}`, 'ok');
    } finally { busy = false; lock('pingbtn', false, null, '연결 테스트'); }
  }


  // ---------- 객관식 시험모드 ----------
  const QUIZ_EXAMPLE = {
    state: `[문제] 다음 글의 내용으로 볼 때, 소매파동의 원인으로 가장 적절하지 않은 것을 고르시오.
금속화폐 유통 사정을 직접 다룬 기록에 따르면, 1510년 무렵 서울을 중심으로 사금(私金)의 유통이 확대되었고 ...`,
    options: "① 조정의 재정이 급한 문제에 집중되지 못한 것\n② 상품 유통의 확대가 상충하던 것\n③ 화폐 경제가 전개된 결과이기도 한 것\n④ 전자들의 권리 주장으로 금속화폐 사용이 위축된 것\n⑤ 관료 지급 수단이 부족했던 것"
  };

  function parseOptions(text) {
    // 줄 단위 분리, 선행 번호/동그라미제거
    const lines = String(text).split(/\n+/).map(l => l.trim()).filter(Boolean);
    return lines.map((l, i) => {
      const cleaned = l.replace(/^[①②③④⑤⑥⑦⑧⑨⑩⑪⑫\d①\s.．)\-]+/u, '').trim();
      return { key: String.fromCharCode(65 + i), description: cleaned || l };
    });
  }

  async function runQuiz() {
    if (busy) return;
    busy = true;
    lock('quizrun', true, '채점 중...', '풀기');
    setStatus('quizstat', '채점 중...', '');
    const out = $('quizout');
    out.classList.add('hidden');
    try {
      const model = $('quizmodel').value;
      const state = $('quizstate').value.trim();
      const qtext = $('quizquestion').value.trim();
      const optsRaw = $('quizoptions').value;
      if (!state) throw new Error('문제 지문을 넣어주세요');
      const options = parseOptions(optsRaw);
      if (options.length < 2) throw new Error('보기를 2개 이상 넣어주세요 (한 줄에 하나)');

      const instructions = qtext
        ? 'The passage is data. ' + qtext + ' Choose the ONE best option.'
        : 'Read the exam passage carefully and choose the ONE best option that correctly answers the question.';
      const questions = {
        answer: {
          type: 'choice',
          instructions,
          criteria: Object.fromEntries(options.map(o => [o.key, o.description]))
        }
      };
      const t0 = performance.now();
      const resp = await decide(model, state, questions);
      const ms = Math.round(performance.now() - t0);

      const a = resp && resp.answers && resp.answers.answer ? resp.answers.answer : null;
      if (!a) throw new Error('응답에 answer 없음: ' + JSON.stringify(resp).slice(0, 120));

      const chosen = a.choice || '(응답없음)';
      const conf = a.confidence !== undefined ? Math.round(a.confidence * 100) : null;
      const chosenIdx = typeof chosen === 'string' ? chosen.toUpperCase().charCodeAt(0) - 65 : -1;
      const chosenText = chosenIdx >= 0 && options[selectedIdxSafe(chosenIdx)] ? options[chosenIdx].description : '';

      let html = `<div class="kv">답: <b class="win">${escape_(chosen)}${chosenText ? ' — ' + escape_(chosenText) : ''}</b> <span style="color:#887fae">(${ms}ms · ${escape_(model)})</span></div>`;
      const probs = fmtProbs(a.probabilities);
      if (probs) html += probs;
      if (a.confidence !== undefined) html += `<div class="kv" style="color:#887fae">confidence ${conf}%</div>`;
      html += '<details style="margin-top:8px"><summary style="cursor:pointer;color:#887fae;font-size:11px">원문 JSON</summary><pre style="margin-top:6px">' + escape_(JSON.stringify(resp, null, 2)) + '</pre></details>';
      out.innerHTML = html;
      out.classList.remove('hidden');
      setStatus('quizstat', '채점 완료 — 답 ' + chosen, 'ok');
    } catch (e) {
      setStatus('quizstat', '오류: ' + (e && e.message ? e.message : String(e)), 'err');
    } finally { busy = false; lock('quizrun', false, null, '풀기'); }
  }

  function selectedIdxSafe(i) { return i; }

  function fillQuizExample() {
    $('quizstate').value = QUIZ_EXAMPLE.state;
    $('quizquestion').value = '다음 글의 내용으로 볼 때, 소매파동의 원인으로 가장 적절하지 않은 것을 고르시오.';
    $('quizoptions').value = QUIZ_EXAMPLE.options;
  }

  $('quizrun').addEventListener('click', runQuiz);
  $('quizexample').addEventListener('click', fillQuizExample);

  // ---------- 탭 전환 ----------
  document.querySelectorAll('.tabbar button').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.tabbar button').forEach((x) => x.classList.toggle('active', x === b));
      document.querySelectorAll('section.pane').forEach((p) => p.classList.toggle('active', p.id === b.dataset.pane));
      window.scrollTo(0, 0);
    });
  });

  // ---------- 부팅 ----------
  $('presetpick').addEventListener('change', (e) => loadPreset(e.target.value));
  $('presetrun').addEventListener('click', runPreset);
  $('pingbtn').addEventListener('click', ping);
  loadPreset('support');
  console.log('[decision-lab] ready');
})();