import { allCases, putCase, deleteCase, newCase } from "./db.js";
import { PROMPTS, STEP_RULES } from "./prompts.js";

const $ = (s) => document.querySelector(s);
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "html") el.innerHTML = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
  return el;
};
const brl = (n) => "R$ " + Math.round(Number(n) || 0).toLocaleString("pt-BR");
const pref = {
  get: (k) => { try { return localStorage.getItem("encarregado." + k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem("encarregado." + k, v); } catch {} },
};

// ---------- Estado ----------
let cases = [];
let C = null;
let tab = pref.get("tab") || "diag";
const status = {}; // chave da ferramenta → { msg, err, busy }

const save = (c = C) => { c.updatedAt = Date.now(); return putCase(c).catch((e) => console.error(e)); };

// ---------- Fotos ----------
// Reduz a foto para no máximo 1280 px antes de guardar e enviar.
async function prepPhoto(file) {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return await new Promise((r) => canvas.toBlob((b) => r(b || file), "image/jpeg", 0.82));
  } catch { return file; }
}
const urls = new WeakMap();
const photoURL = (blob) => { if (!urls.has(blob)) urls.set(blob, URL.createObjectURL(blob)); return urls.get(blob); };
const toImage = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve({ media_type: blob.type || "image/jpeg", data: String(r.result).split(",")[1] });
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

// ---------- Claude (via servidor do app) ----------
const ERRORS = {
  not_granted: "Código de acesso incorreto.",
  no_key: "O servidor está sem a chave da API do Claude.",
  rate_limited: "Muitas consultas seguidas. Espere um pouco e tente de novo.",
  image_rejected: "A foto não foi aceita. Tente outra.",
  refused: "O Claude não respondeu a esse pedido. Reformule a descrição.",
  invalid_json: "A resposta veio fora do formato. Toque de novo para repetir.",
  empty_completion: "Resposta vazia. Simplifique a descrição e tente de novo.",
  offline: "Sem internet. Tente de novo quando conectar.",
};
const errText = (e) => ERRORS[e?.code] || e?.message || "Falha de conexão. Tente de novo.";

async function callClaude({ system, messages, images, quick }, retry = true) {
  if (!navigator.onLine) throw { code: "offline" };
  const body = { system, messages, quick, images: images?.length ? await Promise.all(images.map(toImage)) : undefined };
  let res;
  try {
    res = await fetch("api/claude", {
      method: "POST",
      headers: { "content-type": "application/json", "x-app-code": pref.get("code") || "" },
      body: JSON.stringify(body),
    });
  } catch { throw { code: "offline" }; }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && retry) {
    const code = window.prompt("Código de acesso do app:");
    if (code) { pref.set("code", code.trim()); return callClaude({ system, messages, images, quick }, false); }
  }
  if (!res.ok) throw data.error || { message: "Erro " + res.status };
  return data.text;
}

function parseJSON(text) {
  const s = text.replace(/```(?:json)?/g, "");
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  try { return JSON.parse(s.slice(a, b + 1)); } catch { throw { code: "invalid_json" }; }
}

function setStatus(key, msg, err = false, busy = false) { status[key] = { msg, err, busy }; render(); }
function statusEl(key) {
  const s = status[key] || {};
  return h("p", { class: "status" + (s.err ? " err" : "") + (s.busy ? " busy" : ""), role: "status" }, s.msg || "");
}
const isBusy = (key) => !!status[key]?.busy;

async function runJSON(key, imgs) {
  const c = C;
  setStatus(key, imgs?.length ? "Analisando a foto…" : "Pensando…", false, true);
  try {
    c[key] = parseJSON(await callClaude({ messages: [{ role: "user", content: PROMPTS[key](c, !!imgs?.length) }] }));
    await save(c);
    setStatus(key, "");
  } catch (e) { setStatus(key, errText(e), true); }
}
const before = () => (C.photoBefore ? [C.photoBefore] : null);

async function copyText(text, key, okMsg) {
  try { await navigator.clipboard.writeText(text); setStatus(key, okMsg); return true; }
  catch { setStatus(key, "Não deu para copiar. Selecione o texto e copie.", true); return false; }
}

// ---------- Abas ----------
const TABS = [
  { id: "diag", name: "Diagnóstico", done: () => !!C.diag },
  { id: "fix", name: "Conserto", done: () => C.chat.length > 1 },
  { id: "quote", name: "Cotação", done: () => !!C.quote },
  { id: "landlord", name: "Locador", done: () => !!C.landlord },
];

function renderTabs() {
  $("#tabs").replaceChildren(...TABS.map((t) => h("button", {
    class: "tab", role: "tab", id: "tab-" + t.id, "aria-selected": String(tab === t.id), "aria-controls": "panel",
    onclick: () => { tab = t.id; pref.set("tab", tab); render(); },
  }, t.name, t.done() ? h("i", { class: "dot", "aria-label": "feito" }) : null)));
}

const alertBox = (title) => C.diag?.alerta ? h("div", { class: "alert", role: "alert" }, h("b", {}, title), h("span", {}, C.diag.alerta)) : null;

// ---------- Diagnóstico + compras ----------
const GAUGE = [["10min", "10 min"], ["fim_de_semana", "Fim de semana"], ["profissional", "Profissional"]];

function panelDiag() {
  const out = [
    h("h2", {}, "Diagnóstico"),
    h("button", { class: "btn", disabled: isBusy("diag"), onclick: () => runJSON("diag", before()) }, C.diag ? "Diagnosticar de novo" : "Diagnosticar"),
    statusEl("diag"),
  ];
  if (!C.diag) return out;
  const d = C.diag;
  const lvl = GAUGE.findIndex((g) => g[0] === d.nivel);
  out.push(alertBox("Pare aqui"), h("article", { class: "card" },
    h("span", { class: "tag" }, "Confiança " + ({ alta: "alta", media: "média", baixa: "baixa" }[d.confianca] || "—")),
    h("h3", {}, d.provavel),
    h("div", { class: "gauge", role: "img", "aria-label": "Esforço: " + (GAUGE[lvl]?.[1] || "") }, GAUGE.map((g, i) => h("div", { class: `l${i + 1}${i === lvl ? " on" : ""}` }, g[1]))),
    h("div", { class: "kv" }, h("span", { class: "lbl" }, "Causa"), h("p", {}, d.causa)),
    h("div", { class: "kv" }, h("span", { class: "lbl" }, "Por que esse nível"), h("p", {}, d.porque_nivel)),
    d.confirmar ? h("div", { class: "kv" }, h("span", { class: "lbl" }, "Para ter certeza"), h("p", {}, d.confirmar)) : null));

  out.push(h("h3", { class: "sub" }, "Lista de compras"),
    h("button", { class: "btn", disabled: isBusy("list"), onclick: () => runJSON("list", before()) }, C.list ? "Refazer lista" : "Montar lista"),
    statusEl("list"));
  if (C.list) out.push(listCard());
  return out;
}

function listCard() {
  const items = Array.isArray(C.list.itens) ? C.list.itens : [];
  const ownedKey = (it, i) => String(i) + "|" + it.nome;
  const isOwned = (it, i) => C.owned[ownedKey(it, i)] ?? !!it.provavelmente_tem;
  let min = 0, max = 0;
  const ul = h("ul", { class: "items" }, items.map((it, i) => {
    const owned = isOwned(it, i);
    if (!owned) { min += Number(it.custo_min) || 0; max += Number(it.custo_max) || 0; }
    return h("li", { class: "item" + (owned ? " owned" : "") },
      h("input", { type: "checkbox", id: "own-" + i, "aria-label": "Já tenho " + it.nome, checked: owned,
        onchange: (e) => { C.owned[ownedKey(it, i)] = e.target.checked; save(); render(); } }),
      h("label", { for: "own-" + i, class: "nm" }, it.nome,
        it.provavelmente_tem ? h("span", { class: "chip have" }, "já tem?") : h("span", { class: "chip" }, { peca: "peça", ferramenta: "ferramenta", consumivel: "consumível" }[it.tipo] || it.tipo),
        h("div", { class: "sp" }, [it.especificacao, it.qtd].filter(Boolean).join(" · "))),
      h("div", { class: "pr" }, it.custo_max ? `${brl(it.custo_min)}–${Math.round(it.custo_max)}` : "—"));
  }));
  const copy = () => {
    const txt = items.filter((it, i) => !isOwned(it, i)).map((it) => `• ${it.qtd || "1"} ${it.nome}${it.especificacao ? " — " + it.especificacao : ""}`).join("\n");
    copyText("Lista de compras:\n" + txt, "list", "Lista copiada.");
  };
  return h("article", { class: "card" },
    h("span", { class: "tag" }, "Marque o que você já tem"), ul,
    h("div", { class: "total" }, h("span", {}, "A comprar"), h("span", { class: "pr" }, `${brl(min)} a ${brl(max)}`)),
    C.list.dica ? h("p", { class: "notice" }, C.list.dica) : null,
    h("div", { class: "btns" }, h("button", { class: "btn ghost", onclick: copy }, "Copiar lista")));
}

// ---------- Conserto: passo a passo, conferência e prevenção ----------
const md = (s) => {
  const esc = s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  return esc.split(/\n{2,}/).map((block) => {
    const lines = block.split("\n");
    if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) return "<ul>" + lines.map((l) => "<li>" + l.replace(/^\s*[-*•]\s+/, "") + "</li>").join("") + "</ul>";
    return "<p>" + lines.join("<br>") + "</p>";
  }).join("").replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
};

async function stepSend(text) {
  const c = C;
  c.chat.push({ role: "user", content: text });
  setStatus("steps", "Pensando…", false, true);
  try {
    const out = await callClaude({ system: STEP_RULES(c), messages: c.chat, images: c.chat.length === 1 ? (c.photoBefore ? [c.photoBefore] : null) : null });
    c.chat.push({ role: "assistant", content: out });
    await save(c);
    setStatus("steps", "");
  } catch (e) {
    c.chat.pop();
    setStatus("steps", errText(e), true);
  }
}

function photoPicker(label, file, onPick) {
  return h("label", { class: "photo" },
    h("input", { type: "file", accept: "image/*", capture: "environment", onchange: async (e) => { const f = e.target.files?.[0]; if (f) { onPick(await prepPhoto(f)); render(); } } }),
    h("span", { class: "thumb", "aria-hidden": "true" }, file ? h("img", { src: photoURL(file), alt: "" }) : "📷"),
    h("span", {}, h("b", {}, label), h("small", {}, file ? "Toque para trocar" : "Tirar ou escolher")));
}

function panelFix() {
  const busy = isBusy("steps");
  const out = [h("h2", {}, "Conserto"), alertBox("Não faça sozinho")];
  if (!C.chat.length) {
    out.push(h("button", { class: "btn", disabled: busy, onclick: () => stepSend("Pode começar.") }, "Começar o conserto"), statusEl("steps"));
  } else {
    const q = h("input", { id: "stepQ", "aria-label": "Dúvida sobre o passo atual", placeholder: "Dúvida?", disabled: busy });
    out.push(
      h("div", { class: "chat", "aria-live": "polite" },
        C.chat.slice(1).map((m) => m.role === "user" ? h("div", { class: "msg me" }, m.content) : h("div", { class: "msg ai", html: md(m.content) }))),
      statusEl("steps"),
      h("form", { class: "composer", onsubmit: (e) => { e.preventDefault(); if (q.value.trim()) stepSend(q.value.trim()); } },
        h("button", { class: "btn tape done-btn", type: "button", disabled: busy, onclick: () => stepSend("concluído") }, "Concluído ✓"),
        q, h("button", { class: "btn ghost", type: "submit", disabled: busy }, "Enviar")),
      h("div", { class: "btns" }, h("button", { class: "btn ghost", disabled: busy, onclick: () => { C.chat = []; save(); render(); } }, "Recomeçar")));
  }

  // Ficou certo?
  const notes = h("textarea", { id: "afterNotes", "aria-label": "Seu relato", oninput: (e) => { C.afterNotes = e.target.value; save(); } });
  notes.value = C.afterNotes;
  out.push(h("h3", { class: "sub" }, "Ficou certo?"),
    photoPicker("Foto depois do conserto", C.photoAfter, (b) => { C.photoAfter = b; save(); }),
    h("label", { class: "field" }, h("span", { class: "lbl" }, "Seu relato (opcional)"), notes),
    h("button", { class: "btn", disabled: isBusy("after"), onclick: () => runJSON("after", [C.photoBefore, C.photoAfter].filter(Boolean)) }, "Avaliar meu conserto"),
    statusEl("after"));
  if (C.after) {
    const v = { ok: ["Ficou certo", "v-ok"], atencao: ["Quase lá", "v-warn"], refazer: ["Refazer", "v-crit"] }[C.after.veredito] || ["Avaliado", "v-muted"];
    out.push(h("article", { class: "card" },
      h("div", { class: "verdict" }, h("span", { class: "big " + v[1] }, v[0])),
      h("p", {}, C.after.resumo),
      h("div", { class: "kv" }, h("span", { class: "lbl" }, "Verifique em 24 h"), h("ul", { class: "plain" }, (C.after.verificar_24h || []).map((x) => h("li", {}, x)))),
      h("div", { class: "kv" }, h("span", { class: "lbl" }, "Sinais de que falhou"), h("ul", { class: "plain" }, (C.after.sinais_de_falha || []).map((x) => h("li", {}, x))))));
  }

  // Nunca mais
  out.push(h("h3", { class: "sub" }, "Nunca mais"),
    h("button", { class: "btn", disabled: isBusy("never"), onclick: () => runJSON("never", null) }, C.never ? "Refazer prevenção" : `Prevenção para ${C.room.toLowerCase()}`),
    statusEl("never"));
  if (C.never) {
    const items = C.never.checklist || [];
    const done = items.filter((_, i) => C.checks[i]).length;
    out.push(
      h("article", { class: "card" },
        h("div", { class: "kv" }, h("span", { class: "lbl" }, "O que causou"), h("p", {}, C.never.causa)),
        h("div", { class: "kv" }, h("span", { class: "lbl" }, "Como evitar"), h("ul", { class: "plain" }, (C.never.prevencao || []).map((x) => h("li", {}, x))))),
      h("article", { class: "card" },
        h("div", { class: "head-row" }, h("h3", {}, `Revisão mensal · ${C.room}`), h("span", { class: "lbl" }, `${done}/${items.length}`)),
        h("div", {}, items.map((it, i) => h("label", { class: "check" },
          h("input", { type: "checkbox", checked: !!C.checks[i], onchange: (e) => { C.checks[i] = e.target.checked; save(); render(); } }),
          h("span", {}, h("b", {}, it.item), h("small", {}, it.como))))),
        h("div", { class: "btns" }, h("button", { class: "btn ghost", onclick: () => { C.checks = {}; save(); render(); } }, "Zerar para o próximo mês"))));
  }
  return out;
}

// ---------- Cotação ----------
function panelQuote() {
  const amt = h("input", { id: "quoteAmount", inputmode: "decimal", "aria-label": "Valor cotado em reais", oninput: (e) => { C.quoteAmount = e.target.value; save(); } });
  amt.value = C.quoteAmount;
  const out = [
    h("h2", {}, "Cotação"),
    h("label", { class: "field" }, h("span", { class: "lbl" }, "Valor cotado"), h("div", { class: "money" }, h("span", {}, "R$"), amt)),
    h("button", { class: "btn", disabled: isBusy("quote"), onclick: () => {
      if (!C.quoteAmount.trim()) { setStatus("quote", "Informe o valor cotado.", true); return; }
      runJSON("quote", before());
    } }, "Conferir cotação"),
    statusEl("quote"),
  ];
  if (C.quote) {
    const v = { justo: ["Preço justo", "v-ok"], alto: ["Acima do comum", "v-crit"], baixo: ["Abaixo do comum", "v-warn"], incerto: ["Difícil dizer", "v-muted"] }[C.quote.veredito] || ["Avaliado", "v-muted"];
    out.push(h("article", { class: "card" },
      h("span", { class: "tag" }, "Cotado: R$ " + C.quoteAmount),
      h("div", { class: "verdict" }, h("span", { class: "big " + v[1] }, v[0])),
      h("div", { class: "kv" }, h("span", { class: "lbl" }, "Faixa estimada"), h("p", { style: "font-family:var(--f-mono)" }, C.quote.faixa)),
      h("p", {}, C.quote.raciocinio),
      h("div", { class: "kv" }, h("span", { class: "lbl" }, "Pergunte antes de aceitar"), h("ol", { class: "qs" }, (C.quote.perguntas || []).map((x) => h("li", {}, x))))));
  }
  return out;
}

// ---------- Locador ----------
function panelLandlord() {
  const field = (id, label, key) => {
    const el = h("input", { id, oninput: (e) => { C[key] = e.target.value; save(); } });
    el.value = C[key];
    return h("label", { class: "field" }, h("span", { class: "lbl" }, label), el);
  };
  const letter = h("textarea", { id: "letter", class: "letter", rows: "9", "aria-label": "Mensagem ao locador", oninput: (e) => { C.landlord = e.target.value; save(); } });
  letter.value = C.landlord;
  const write = async () => {
    const c = C;
    setStatus("landlord", "Escrevendo…", false, true);
    try {
      c.landlord = (await callClaude({ messages: [{ role: "user", content: PROMPTS.landlord(c) }], quick: true })).trim();
      await save(c);
      setStatus("landlord", "");
    } catch (e) { setStatus("landlord", errText(e), true); }
  };
  return [
    h("h2", {}, "Locador"),
    h("div", { class: "row2" }, field("llName", "Para", "llName"), field("myName", "Assinado por", "myName")),
    h("button", { class: "btn", disabled: isBusy("landlord"), onclick: write }, C.landlord ? "Escrever de novo" : "Escrever mensagem"),
    statusEl("landlord"),
    C.landlord ? letter : null,
    C.landlord ? h("button", { class: "btn tape", onclick: () => copyText(letter.value, "landlord", "Mensagem copiada. Cole no WhatsApp ou e-mail e anexe a foto.") }, "Copiar mensagem") : null,
  ];
}

const PANELS = { diag: panelDiag, fix: panelFix, quote: panelQuote, landlord: panelLandlord };

function render() {
  if (!PANELS[tab]) tab = "diag";
  renderTabs();
  const focusId = document.activeElement?.id;
  $("#panels").replaceChildren(h("section", { class: "tool", id: "panel", role: "tabpanel", "aria-labelledby": "tab-" + tab }, PANELS[tab]()));
  if (focusId && ["afterNotes", "quoteAmount", "llName", "myName", "stepQ", "letter"].includes(focusId)) document.getElementById(focusId)?.focus();
}

// ---------- Ficha e lista de casos ----------
const caseLabel = (c) => (c.what.trim().split("\n")[0].slice(0, 40) || "Caso sem descrição") + " · " + new Date(c.createdAt).toLocaleDateString("pt-BR");

function renderCaseList() {
  cases.sort((a, b) => b.updatedAt - a.updatedAt);
  $("#caseList").replaceChildren(...cases.map((c) => h("option", { value: c.id, selected: c.id === C.id }, caseLabel(c))));
}

function renderCase() {
  $("#caseWhat").value = C.what; $("#caseRoom").value = C.room; $("#caseArea").value = C.area;
  $("#pbThumb").replaceChildren(C.photoBefore ? h("img", { src: photoURL(C.photoBefore), alt: "" }) : "📷");
  $("#pbHint").textContent = C.photoBefore ? "Toque para trocar" : "Tirar ou escolher";
}

function selectCase(c) {
  C = c; pref.set("case", c.id);
  for (const k of Object.keys(status)) delete status[k];
  renderCaseList(); renderCase(); render();
}

async function createCase() {
  const c = newCase();
  cases.push(c); await save(c); selectCase(c);
  $("#caseWhat").focus();
}

$("#caseWhat").addEventListener("input", (e) => {
  C.what = e.target.value; save();
  const opt = $("#caseList").selectedOptions[0]; if (opt) opt.textContent = caseLabel(C);
});
$("#caseArea").addEventListener("input", (e) => { C.area = e.target.value; save(); });
$("#caseRoom").addEventListener("change", (e) => { C.room = e.target.value; save(); render(); });
$("#photoBefore").addEventListener("change", async (e) => {
  const f = e.target.files?.[0]; if (!f) return;
  C.photoBefore = await prepPhoto(f); save(); renderCase();
});
$("#caseList").addEventListener("change", (e) => selectCase(cases.find((c) => c.id === e.target.value)));
$("#caseNew").addEventListener("click", createCase);
$("#caseDel").addEventListener("click", async () => {
  if (!window.confirm("Apagar este caso e as fotos dele?")) return;
  await deleteCase(C.id);
  cases = cases.filter((c) => c.id !== C.id);
  if (cases.length) selectCase(cases[0]); else createCase();
});

// ---------- Início ----------
cases = await allCases().catch(() => []);
const last = cases.find((c) => c.id === pref.get("case")) || cases.sort((a, b) => b.updatedAt - a.updatedAt)[0];
if (last) selectCase(last); else await createCase();

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
