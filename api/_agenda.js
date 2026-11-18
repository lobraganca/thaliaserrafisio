// Regras da agenda da Thalia: horários de atendimento, serviços e cálculo dos horários livres.
// Tudo fica no banco Upstash Redis com o prefixo "th:".
import { pipeline } from "./_db.js";

export const K = {
  cfg: "th:cfg",
  ag: (id) => `th:ag:${id}`,
  lista: "th:ags",                       // ZSET: id -> início do atendimento (ms)
  slot: (dia, hora) => `th:slot:${dia}:${hora}`, // trava o horário (1 agendamento por horário)
  bloq: "th:bloq",                       // SET: "AAAA-MM-DD" (dia todo) ou "AAAA-MM-DD HH:MM"
  sess: (t) => `th:sess:${t}`,
  rl: (ip) => `th:rl:${ip}`,
  videos: "th:videos",
  deps: "th:deps",                       // JSON: depoimentos (pendente/aprovado/oculto)                   // JSON: lista de vídeos do site
};

export const SERVICOS = {
  avaliacao: "Avaliação fisioterapêutica",
  ortopedica: "Fisioterapia ortopédica",
  esportiva: "Fisioterapia esportiva",
  laser: "Laserterapia",
  posop: "Reabilitação pós-operatória",
  recovery: "Recovery / liberação miofascial",
};
export const LOCAIS = { consultorio: "Consultório", domicilio: "Domicílio" };
export const STATUS = ["pendente", "confirmado", "concluido", "faltou", "cancelado"];

// Horário padrão (a Thalia muda isso na Área Adm). 0 = domingo … 6 = sábado.
export const CFG_PADRAO = {
  dur: 60,             // minutos de cada atendimento
  antecedencia: 3,     // horas mínimas entre o pedido e o atendimento
  janela: 30,          // dias à frente abertos para agendar
  dias: {
    0: [],
    1: [["07:00", "12:00"], ["14:00", "19:00"]],
    2: [["07:00", "12:00"], ["14:00", "19:00"]],
    3: [["07:00", "12:00"], ["14:00", "19:00"]],
    4: [["07:00", "12:00"], ["14:00", "19:00"]],
    5: [["07:00", "12:00"], ["14:00", "18:00"]],
    6: [["08:00", "12:00"]],
  },
};

export const isDia = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ""));
export const isHora = (h) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(h || ""));
const min = (h) => +h.slice(0, 2) * 60 + +h.slice(3, 5);
const hhmm = (m) => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
// instante (ms) de um dia/hora no fuso de Itabirito (UTC−3)
export const quando = (dia, hora) => Date.parse(`${dia}T${hora}:00-03:00`);
export const hojeBR = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
export const somaDias = (dia, n) => new Date(Date.parse(dia + "T12:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const diaSemana = (dia) => new Date(dia + "T12:00:00Z").getUTCDay();

export function limparCfg(c) {
  const out = { ...CFG_PADRAO, dias: {} };
  const n = (v, a, b, d) => (Number.isFinite(+v) ? Math.min(b, Math.max(a, Math.round(+v))) : d);
  out.dur = n(c?.dur, 15, 180, CFG_PADRAO.dur);
  out.antecedencia = n(c?.antecedencia, 0, 72, CFG_PADRAO.antecedencia);
  out.janela = n(c?.janela, 1, 120, CFG_PADRAO.janela);
  for (let d = 0; d < 7; d++) {
    const faixas = Array.isArray(c?.dias?.[d]) ? c.dias[d] : CFG_PADRAO.dias[d];
    out.dias[d] = faixas
      .filter((f) => Array.isArray(f) && isHora(f[0]) && isHora(f[1]) && min(f[0]) < min(f[1]))
      .slice(0, 6)
      .sort((a, b) => min(a[0]) - min(b[0]));
  }
  return out;
}

export async function lerCfg() {
  const [raw] = await pipeline([["GET", K.cfg]]);
  try { return limparCfg(JSON.parse(raw)); } catch { return limparCfg(null); }
}

// Horários possíveis de um dia, só pela configuração
export function gradeDoDia(cfg, dia) {
  const out = [];
  for (const [a, b] of cfg.dias[diaSemana(dia)] || []) {
    for (let m = min(a); m + cfg.dur <= min(b); m += cfg.dur) out.push(hhmm(m));
  }
  return out;
}

// Horários livres para vários dias de uma vez
export async function livres(cfg, de, nDias) {
  const agora = Date.now(), limite = agora + cfg.antecedencia * 3600e3, fim = somaDias(hojeBR(), cfg.janela);
  const dias = [];
  for (let i = 0; i < nDias; i++) { const d = somaDias(de, i); if (d > fim) break; dias.push(d); }
  const cand = [];
  for (const d of dias) for (const h of gradeDoDia(cfg, d)) if (quando(d, h) >= limite) cand.push([d, h]);
  const cmds = [["SMEMBERS", K.bloq]];
  if (cand.length) cmds.push(["MGET", ...cand.map(([d, h]) => K.slot(d, h))]);
  const r = await pipeline(cmds);
  const bloq = new Set(r[0] || []), ocupado = r[1] || [];
  const out = {};
  dias.forEach((d) => (out[d] = []));
  cand.forEach(([d, h], i) => {
    if (ocupado[i] || bloq.has(d) || bloq.has(`${d} ${h}`)) return;
    out[d].push(h);
  });
  return out;
}

export function novoId() {
  const t = Date.now().toString(36).slice(-6);
  const r = Math.random().toString(36).slice(2, 7);
  return (t + r).toUpperCase();
}

export const txt = (v, n) => String(v ?? "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, n);

export const toObj = (a) => {
  const o = {};
  if (Array.isArray(a)) for (let i = 0; i < a.length; i += 2) o[a[i]] = a[i + 1];
  else if (a) Object.assign(o, a);
  return o;
};

export function corpo(req) {
  let b = req.body;
  if (typeof b === "string") { try { b = JSON.parse(b || "{}"); } catch { b = {}; } }
  return b || {};
}

export const ipDe = (req) => String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "?").split(",")[0].trim().replace(/[^\w.:-]/g, "").slice(0, 60);
