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

  // ---------- 호출처(엔진) ----------
  const LS_ENGINE = 'decision-lab-engine';
  const LAPTOP_BASE = 'https://dydtn.tailc2a754.ts.net/decision';
  // 노트북(o llama 0.35)에 실제 존재하는 결정모델 — 이 이름은 노트북으로 라우팅
  const LAPTOP_MODELS = ['tev1:0.8b', 'tev1:latest', 'nimble', 'nimble:latest'];
  function isLaptopModel(m) { return LAPTOP_MODELS.includes(m); }
  function getEngine() {
    return localStorage.getItem(LS_ENGINE) || 'auto';
  }
  function setEngine(v) {
    localStorage.setItem(LS_ENGINE, v);
    const sel = $('enginesel');
    if (sel) sel.value = v;
    renderEngineLabel();
  }
  function engineLabelText() {
    const eng = getEngine();
    if (eng === 'laptop') return '노트북 native (ts.net/decision) — 전부 노트북';
    if (eng === 'auto') return '자동 — 결정모델(tev1·nimble)은 노트북, 나머지는 클라우드';
    return '클라우드 (Worker 프록시) — 전부 클라우드';
  }
  function renderEngineLabel() {
    const txt = engineLabelText();
    const el = $('enginelabel');
    if (el) el.textContent = txt;
    const q = $('quizenginelabel');
    if (q) q.textContent = txt;
  }
  function engineEndpoint(model) {
    // auto: 결정전용 모델(tev1·nimble)은 노트북, 나머지는 클라우드
    if (getEngine() === 'laptop') return LAPTOP_BASE + '/v1/systemone';
    if (getEngine() === 'auto') return isLaptopModel(model) ? LAPTOP_BASE + '/v1/systemone' : '/api/decide';
    return '/api/decide';
  }

  // ---------- 호출 ----------
  async function decide(model, state, questions, signal) {
    const r = await fetch(engineEndpoint(model), {
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
    const wentLaptop = (engineEndpoint(model) === LAPTOP_BASE + '/v1/systemone');
    if (wentLaptop && data && !data.meta) data.meta = { engine: 'systemone-native', model: data.model || model };
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


  // ---------- 프리셋 ----------
  const BASE_PRESETS = {
    support: {
      name: "고객지원 의도 분류 (choice+noul)",
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
      name: "정책 위반 판정 (choice)",
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
      name: "만족도 평가 (score)",
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

  const LS_USER_PRESETS = 'decision-lab-user-presets';
  function getUserPresets() {
    try { return JSON.parse(localStorage.getItem(LS_USER_PRESETS) || '{}'); } catch (e) { return {}; }
  }
  function saveUserPresets(obj) {
    localStorage.setItem(LS_USER_PRESETS, JSON.stringify(obj));
  }
  function allPresets() {
    return Object.assign({}, BASE_PRESETS, getUserPresets());
  }




  // ---------- 프리셋 UI ----------
  function renderPresetOptions() {
    const sel = $('presetpick');
    const cur = sel.value;
    // 기본 + 사용자 프리셋 (optgroup 없이 이름으로)
    const users = getUserPresets();
    let html = '';
    for (const [k, v] of Object.entries(BASE_PRESETS)) html += `<option value="${escapeAttr(k)}">${escape_(v.name || k)}</option>`;
    const uk = Object.keys(users);
    if (uk.length) html += '<optgroup label="내 프리셋">' + uk.map(k => `<option value="u:${escapeAttr(k)}">${escape_(k)}</option>`).join('') + '</optgroup>';
    sel.innerHTML = html;
    restoreSel(sel, cur);
  }
  function escapeAttr(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function restoreSel(sel, want) {
    if (want && [...sel.options].some(o => o.value === want)) sel.value = want;
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

  async function ping() {
    if (busy) return;
    busy = true;
    lock('pingbtn', true, '테스트 중...', '연결 테스트');
    setStatus('pingstat', '테스트 중...', '');
    try {
      const t0 = performance.now();
      let msg;
      const eng = getEngine();
      if (eng === 'laptop' || (eng === 'auto')) {
        // 노트북 모드 — 서버 존재 + systemone 기능 테스트(모델 무관 tev1 사용)
        const vr = await fetch(LAPTOP_BASE + '/api/version');
        if (!vr.ok) throw new Error('HTTP ' + vr.status + ' — 서버 version 응답 이상');
        const vv = await vr.json();
        const gr = await decide('tev1:0.8b', "Ping test: reply intent.", {
          hello: { type: "noul", instructions: "Is this a greeting message?" }
        });
        const ms = Math.round(performance.now() - t0);
        msg = `연결됨 — ollama ${vv.version || '?'} · ${ms}ms ${eng === 'auto' ? '(자동: 노트북 결정모델)' : '(노트북 native)'}`;
      } else {
        const resp = await decide($('presetmodel').value || 'gpt-oss:20b', "Ping test: reply intent.", {
          hello: { type: "noul", instructions: "Is this a greeting message?" }
        });
        const ms = Math.round(performance.now() - t0);
        const eng = resp && resp.meta && resp.meta.engine ? resp.meta.engine : '';
        const note = eng === 'chat-completions-decision' ? ' [cloud 폴백엔진 — systemone 개통 시 자동 전환]' : '';
        msg = `연결됨 — ${ms}ms · ${eng || '응답 도착'}${note}`;
      }
      setStatus('pingstat', msg, 'ok');
    } catch (e) {
      const eng2 = getEngine();
      const hint = (eng2 === 'laptop' || eng2 === 'auto')
        ? ' — 노트북 전원·tailscale VPN 확인 후 재시도 (자동 모드에선 클라우드 모델은 영향 없음)' : '';
      setStatus('pingstat', '오류: ' + (e && e.message ? e.message : String(e)) + hint, 'err');
    } finally { busy = false; lock('pingbtn', false, null, '연결 테스트'); }
  }

  function loadPresetByKey(key) {
    const all = allPresets();
    if (key.startsWith('u:')) {
      const name = key.slice(2);
      const p = getUserPresets()[name];
      if (!p) return;
      $('presetstate').value = p.state || '';
      $('presetqs').value = JSON.stringify(p.qs || {}, null, 2);
      if (p.model) { const ms = $('presetmodel'); restoreSel(ms, p.model); }
    } else {
      const p = BASE_PRESETS[key];
      if (!p) return;
      $('presetstate').value = typeof p.state === 'string' ? p.state : JSON.stringify(p.state, null, 2);
      $('presetqs').value = JSON.stringify(p.qs, null, 2);
    }
  }

  function saveCurrentAsPreset() {
    let name = prompt('프리셋 이름을 입력하세요 (최대 40자):', '');
    if (name == null) { setStatus('presetmgrstat', '', ''); return false; }
    name = name.trim().slice(0, 80);
    if (!name) { setStatus('presetmgrstat', '이름이 비어 저장하지 않았어요.', 'err'); return false; }
    const state = $('presetstate').value.trim();
    const qsRaw = $('presetqs').value.trim();
    if (!state || !qsRaw) { setStatus('presetmgrstat', '지문과 questions를 먼저 넣어주세요.', 'err'); return false; }
    let qs;
    try { qs = JSON.parse(qsRaw); } catch (e) { setStatus('presetmgrstat', 'questions가 올바른 JSON이 아니에요.', 'err'); return false; }
    const model = $('presetmodel').value;
    const users = getUserPresets();
    users[name] = { state, qs, model };
    saveUserPresets(users);
    renderPresetOptions();
    const sel = $('presetpick');
    sel.value = 'u:' + name;
    setStatus('presetmgrstat', `프리셋 "${name}" 저장됨`, 'ok');
    return true;
  }

  function deleteSelectedPreset() {
    const sel = $('presetpick');
    const v = sel.value;
    if (!v.startsWith('u:')) { setStatus('presetmgrstat', '기본 프리셋은 삭제할 수 없어요 — 내 프리셋만 가능.', 'err'); return; }
    const name = v.slice(2);
    const users = getUserPresets();
    if (!users[name]) { setStatus('presetmgrstat', '이미 삭제됐거나 없는 프리셋이에요.', 'err'); return; }
    if (!confirm(`"${name}" 프리셋을 삭제할까요?`)) return;
    delete users[name];
    saveUserPresets(users);
    renderPresetOptions();
    setStatus('presetmgrstat', `프리셋 "${name}" 삭제됨`, 'ok');
  }


  // ---------- 객관식 시험모드 ----------
  // 수능형 문제은행 — 예시 채우기 버튼마다 무작위로 뽑음(보기 순서섞기 포함)
  const QUIZ_BANK = [
 {
  "subject": "역사",
  "state": "금속화폐 유통 사정을 직접 다룬 기록에 따르면, 1510년 무렵 서울을 중심으로 사금(私金)의 유통이 확대되었고, 상품 화폐 경제의 발전에 따른 것으로 보인다. 사금의 확대된 유통은 조정의 재정이 급한 문제에 집중되지 못하게 만들었고, 화폐 경제가 전개된 결과이기도 했다. 한편 전자들의 권리 주장은 금속화폐의 사용을 위축시키는 요인이 되기도 했다.",
  "question": "소매파동의 원인으로 가장 적절하지 않은 것은?",
  "options": [
   "조정의 재정이 급한 문제에 집중되지 못한 것",
   "상품 유통의 확대가 상충하던 것",
   "화폐 경제가 전개된 결과이기도 한 것",
   "전자들의 권리 주장으로 금속화폐 사용이 위축된 것",
   "관료 지급 수단이 부족했던 것"
  ],
  "answer": "B"
 },
 {
  "subject": "역사",
  "state": "고려 후기 무신정권이 수립된 이후 권문세족은 토지를 대량으로 겸병하였고, 이에 따라 양안(量案)의 작성이나 전시과(田柴科)의 재편이 이루어졌다. 권농반(勸農班)이 파견되어 농업 생산을 장려하였으며, 화폐의 유통 시도도 있었으나 실질적 유통은 제한적이었다.",
  "question": "이 글의 내용과 가장 관련이 깊은 인물은?",
  "options": [
   "이성계",
   "최충헌",
   "정도전",
   "김부식",
   "이규보"
  ],
  "answer": "C"
 },
 {
  "subject": "문법",
  "state": "국어의 어형 변화 가운데에는 활용(conjugation)이 있다. 활용어미는 어간에 붙어 문법적 기능을 나타내는 형태소로, 어말어미와 선어말어미로 나뉜다. 선어말어미는 주로 높임·시제 등을 나타내며, 어말어미는 문장 종결·연결 등의 기능을 담당한다.",
  "question": "이 글의 내용과 일치하지 않는 것은?",
  "options": [
   "활용은 국어의 어형 변화에 해당한다",
   "선어말어미는 높임을 나타낼 수 있다",
   "어말어미는 문장의 종결 기능을 할 수 있다",
   "어간과 어미가 결합하여 활용된다",
   "선어말어미는 항상 하나만 쓸 수 있다"
  ],
  "answer": "E"
 },
 {
  "subject": "문법",
  "state": "관형형 전성어미 '-(으)ᆫ/-는'은 뒤에 오는 체언을 수식하는 기능을 가진다. 규칙 활용과 불규칙 활용의 구분은 자음모음 조건에 따라 달라지는데, '-ㅂ' 불규칙 활용은 어간 받침 'ㅂ'이 'ㅜ/우'로 바뀌는 특성이 있다.",
  "question": "위 설명에서 '불규칙 활용'의 예로 적절한 것은?",
  "options": [
   "춥다→추운",
   "좋다→좋은",
   "넓다→넓은",
   "밝다→밝은",
   "작다→작은"
  ],
  "answer": "A"
 },
 {
  "subject": "과학",
  "state": "광합성에서 빛 에너지는 엽록체의 틸라코이드 막에서 광화학 반응에 의해 ATP와 NADPH로 전환된다. 캘빈 회로는 기질(기질 수준)의 인산화를 통해 CO2를 고정하며, 이 과정에서 루비스코(Rubisco) 효소가 핵심 역할을 한다.",
  "question": "광합성에 대한 설명으로 옳지 않은 것은?",
  "options": [
   "광화학 반응은 틸라코이드 막에서 일어난다",
   "ATP와 NADPH는 캘빈 회로에서 사용된다",
   "루비스코는 CO2 고정에 관여한다",
   "캘빈 회로는 빛에 직접 의존한다",
   "캘빈 회로에서 당이 합성될 수 있다"
  ],
  "answer": "D"
 },
 {
  "subject": "과학",
  "state": "뉴턴의 제2법칙(F=ma)은 물체에 작용하는 힘이 물체의 질량과 가속도의 곱과 같다는 것이다. 운동량은 질량과 속도의 곱이며, 외력이 작용하지 않으면 운동량은 보존된다(운동량 보존 법칙). 충돌 문제에서는 운동량 보존 법칙이 널리 활용된다.",
  "question": "위 글을 바탕으로 할 때, 운동량 보존 법칙과 관련된 설명으로 옳은 것은?",
  "options": [
   "외력이 있어도 운동량은 보존된다",
   "운동량은 질량에만 의존한다",
   "충돌 시 운동량은 항상 보존된다",
   "가속도는 운동량과 무관하다",
   "질량이 변하면 운동량도 변한다"
  ],
  "answer": "C"
 },
 {
  "subject": "경제",
  "state": "수요와 공급의 법칙에 따르면, 가격이 상승하면 수요량은 감소하고 공급량은 증가한다. 균형 가격은 수량과 공급량이 일치하는 지점에서 형성되며, 가격 상한제가 설정되면 초과 수요가 발생할 수 있다.",
  "question": "가격 상한제에 대한 설명으로 옳은 것은?",
  "options": [
   "균형 가격보다 높게 설정된다",
   "초과 공급이 발생한다",
   "초과 수요가 발생할 수 있다",
   "수요량이 감소한다",
   "공급량이 증가한다"
  ],
  "answer": "C"
 },
 {
  "subject": "경제",
  "state": "중앙은행의 통화정책 방식에는 기준금리 조정, 지준율 변경, 공개시장조작 등이 있다. 기준금리를 인상하면 시중 유동성이 축소되어 물가 상승 압력이 완화된다. 반대로 인하는 유동성을 확대한다.",
  "question": "중앙은행의 통화정책에 대한 설명으로 옳지 않은 것은?",
  "options": [
   "공개시장조작은 통화 공급 조절 수단이다",
   "지준법정비율을 지준율이라 한다",
   "기준금리 인상은 유동성을 축소시킨다",
   "기준금리 인하는 물가 안정에 도움이 된다",
   "기준금리 인상은 경기를 활성화시킨다"
  ],
  "answer": "E"
 },
 {
  "subject": "영어",
  "state": "The industrial revolution brought about significant changes in labor patterns. Machine production replaced handwork, leading to urbanization as workers moved to industrial centers. Working conditions in factories were often harsh for workers.",
  "question": "What is the main topic of this passage?",
  "options": [
   "Agricultural innovations",
   "Factory conditions and urbanization",
   "International trade",
   "Political reforms",
   "Transportation systems"
  ],
  "answer": "B"
 },
 {
  "subject": "영어",
  "state": "Photosynthesis converts light energy into chemical energy stored in glucose. Plants take in carbon dioxide from the air and water from the soil, and release oxygen as a by-product.",
  "question": "What is released as a by-product of photosynthesis?",
  "options": [
   "Carbon dioxide",
   "Nitrogen",
   "Oxygen",
   "Methane",
   "Hydrogen"
  ],
  "answer": "C"
 },
 {
  "subject": "한문",
  "state": "孟子曰: 民爲貴, 社稷次之, 君爲輕. 이는 나라의 가장 귀한 존재로 백성을 들고, 나라(사직)이 그 다음, 군주는 가장 가볍다고 한 것이다.",
  "question": "이 글에 나타난 맹자의 사상으로 가장 적절한 것은?",
  "options": [
   "법가의 통치 이념",
   "민본(民本) 사상",
   "예치(禮治) 사상",
   "무위(無爲) 사상",
   "진공(靜空) 사상"
  ],
  "answer": "B"
 },
 {
  "subject": "한문",
  "state": "論語에서 孔子는 學而時習之, 不亦說乎라 하였다. 이는 배우고 때로 이를 익히면 닦 기쁘지 아니한가라는 뜻으로, 학문과 반복 숙달의 중요성을 강조한다.",
  "question": "이 글이 강조하는 바로 가장 적절한 것은?",
  "options": [
   "노동의 신성함",
   "학문의 반복 숙달",
   "군주의 리더십",
   "도덕적 수양",
   "예법 준수"
  ],
  "answer": "B"
 },
 {
  "subject": "지리",
  "state": "몬순 기후는 대륙 동안에서 여름철에 남동 계절풍, 겨울철에 북서 계절풍이 부는 특성을 갖는다. 이로 인해 여름철 강수가 집중되는 하계 우기가 나타나며, 농업 생산성이 높은 지역이 많다.",
  "question": "몬순 기후에 대한 설명으로 옳은 것은?",
  "options": [
   "연중 강수가 균등하다",
   "겨울철에 강수가 집중된다",
   "여름철 강수가 집중된다",
   "대륙 서안에서 나타난다",
   "농업 생산성이 낮다"
  ],
  "answer": "C"
 },
 {
  "subject": "지리",
  "state": "도시화가 진행되면 녹지 면적이 감소하고, 아스팔트·콘크리트 면적이 증가한다. 이에 따라 지표면의 열 흡수가 늘어나고, 인공열 배출이 가세하여 도시의 기온이 주변 농촌 지역보다 높아지는 현상이 나타난다.",
  "question": "글에서 설명하는 현상으로 가장 적절한 것은?",
  "options": [
   "열섬(Heat Island) 효과",
   "엘니뇨 현상",
   "우주 기후 변동",
   "사막화",
   "남해안 해수면 상승"
  ],
  "answer": "A"
 }
];

  function loadRandomQuizItem() {
    const item = QUIZ_BANK[Math.floor(Math.random() * QUIZ_BANK.length)];
    // 보기 순서 섞기(Fisher-Yates) — 정답 편향 방지
    const idx = item.options.map((o, i) => i);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    const shuffled = idx.map(i => item.options[i]);
    // 섞인 순서를 ①②③… 로 넘버링해서 textarea에 넣음
    const markers = ['①','②','③','④','⑤','⑥','⑦'];
    $('quizstate').value = item.state;
    $('quizquestion').value = item.question;
    $('quizoptions').value = shuffled.map((o, i) => (markers[i] || (i+1) + '. ') + o).join('\n');
  }

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
    loadRandomQuizItem();
    setStatus('quizstat', '무작위 예시 채움 — 풀기를 누르세요', '');
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
  $('presetpick').addEventListener('change', (e) => loadPresetByKey(e.target.value));
  $('presetrun').addEventListener('click', runPreset);
  $('presetsave').addEventListener('click', saveCurrentAsPreset);
  $('presetdel').addEventListener('click', deleteSelectedPreset);
  $('pingbtn').addEventListener('click', ping);
  $('engineapply').addEventListener('click', () => {
    const v = $('enginesel').value;
    setEngine(v);
    const s = v === 'laptop'
      ? '노트북 엔진으로 전환 — 판정 시 ' + 'ts.net/decision 직접 호출'
      : '클라우드 엔진으로 전환 — Worker 프록시';
    setStatus('presetmgrstat', s, 'ok');
  });
  // 프리셋 모델 select에 노트북 결정모델 옵션 (엔진이 노트북일 때만 의미 있음 — 상시 노출로 단순 유지)
  (function addLaptopModels() {
    const sel = $('presetmodel');
    const mk = (v, t) => { if (![...sel.options].some(o => o.value === v)) {
      const o = document.createElement('option'); o.value = v; o.textContent = t; sel.appendChild(o); } };
    mk('tev1:0.8b', 'tev1:0.8b (노트북 decision)');
    mk('nimble', 'nimble (노트북 decision)');
  })();
  // 엔진 셀렉트에 auto 옵션 보장 + 초기값
  (function ensureAutoOption() {
    const sel = $('enginesel');
    if (![...sel.options].some(o => o.value === 'auto')) {
      const o = document.createElement('option');
      o.value = 'auto'; o.textContent = '자동 (결정모델=노트북, 나머지=클라우드)';
      sel.insertBefore(o, sel.firstChild);
    }
  })();
  $('enginesel').value = getEngine();
  renderEngineLabel();
  renderPresetOptions(); loadPresetByKey('support');
  console.log('[decision-lab] ready');
})();