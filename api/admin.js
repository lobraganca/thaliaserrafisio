import crypto from "node:crypto";
import { dbReady, dbMissing, pipeline, falhasLogin, limparFalhas } from "./_db.js";
import { K, SERVICOS, LOCAIS, STATUS, lerCfg, limparCfg, gradeDoDia, quando, hojeBR, somaDias, isDia, isHora, novoId, txt, toObj, corpo, ipDe } from "./_agenda.js";

// Área Adm da Thalia. Login e senha ficam nas variáveis ADMIN_USER e ADMIN_PASS da Vercel (nunca no código).
// Todas as ações são POST /api/admin com { acao, ... }.

function same(a, b) {
  const x = crypto.createHash("sha256").update(String(a)).digest();
  const y = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}
class Err extends Error { constructor(s, m) { super(m); this.s = s; } }

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");
  if (req.method !== "POST") return res.status(405).json({ erro: "Use POST" });
  try { return res.status(200).json(await main(req)); }
  catch (e) { return res.status(e.s || 500).json({ erro: String((e && e.message) || e), sair: e.s === 401 || undefined }); }
}

async function main(req) {
  const b = corpo(req);
  const U = process.env.ADMIN_USER, P = process.env.ADMIN_PASS;
  if (!U || !P) throw new Err(503, "Login ainda não configurado na Vercel (ADMIN_USER e ADMIN_PASS).");
  if (!dbReady()) throw new Err(503, `O banco ainda não foi conectado na Vercel. Falta: ${dbMissing()}.`);

  // ---- entrar ----
  if (b.acao === "entrar") {
    const ip = ipDe(req);
    if ((await falhasLogin(ip)) >= 8) throw new Err(429, "Muitas tentativas. Espere 15 minutos.");
    if (!same(String(b.user || "").trim(), U) || !same(String(b.pass || ""), P)) {
      await falhasLogin(ip, true);
      throw new Err(401, "Login ou senha incorretos.");
    }
    await limparFalhas(ip);
    const tok = crypto.randomBytes(32).toString("hex");
    const ttl = b.lembrar ? 60 * 60 * 24 * 90 : 60 * 60 * 12;
    await pipeline([["SET", K.sess(tok), "1", "EX", ttl]]);
    return { ok: true, tok, nome: txt(process.env.ADMIN_NAME, 40) || "Thalia" };
  }

  // ---- demais ações exigem sessão ----
  const tok = String(b.tok || "").replace(/[^a-f0-9]/g, "").slice(0, 64);
  if (tok.length !== 64) throw new Err(401, "Entre com login e senha.");
  const [ok] = await pipeline([["GET", K.sess(tok)]]);
  if (!ok) throw new Err(401, "Sua sessão expirou. Entre de novo.");

  switch (b.acao) {
    case "sair":
      await pipeline([["DEL", K.sess(tok)]]);
      return { ok: true };

    case "listar": {
      const hoje = hojeBR();
      const de = isDia(b.de) ? b.de : somaDias(hoje, -30);
      const ate = isDia(b.ate) ? b.ate : somaDias(hoje, 60);
      const [ids, bloq, cfgRaw] = await pipeline([
        ["ZRANGEBYSCORE", K.lista, quando(de, "00:00"), quando(ate, "23:59")],
        ["SMEMBERS", K.bloq],
        ["GET", K.cfg],
      ]);
      let ags = [];
      if (ids && ids.length) {
        const r = await pipeline(ids.map((id) => ["HGETALL", K.ag(id)]));
        ags = r.map(toObj).filter((a) => a.id);
      }
      let cfg; try { cfg = limparCfg(JSON.parse(cfgRaw)); } catch { cfg = limparCfg(null); }
      return { ags, bloq: (bloq || []).sort(), cfg, hoje, servicos: SERVICOS, locais: LOCAIS };
    }

    case "status": {
      const id = String(b.id || "").replace(/[^\w]/g, "").slice(0, 20);
      if (!STATUS.includes(b.status)) throw new Err(400, "Status inválido.");
      const a = toObj((await pipeline([["HGETALL", K.ag(id)]]))[0]);
      if (!a.id) throw new Err(404, "Agendamento não encontrado.");
      const cmds = [["HSET", K.ag(id), "status", b.status, "atualizado", String(Date.now())]];
      // cancelado libera o horário; reativado trava de novo (se ainda estiver livre)
      if (b.status === "cancelado") {
        const [dono] = await pipeline([["GET", K.slot(a.dia, a.hora)]]);
        if (dono === id) cmds.push(["DEL", K.slot(a.dia, a.hora)]);
      } else if (a.status === "cancelado") {
        const [t] = await pipeline([["SET", K.slot(a.dia, a.hora), id, "NX", "EX", 86400 * 120]]);
        if (t !== "OK") throw new Err(409, "Esse horário já foi ocupado por outro agendamento. Remarque para outro horário.");
      }
      await pipeline(cmds);
      return { ok: true };
    }

    case "nota": {
      const id = String(b.id || "").replace(/[^\w]/g, "").slice(0, 20);
      await pipeline([["HSET", K.ag(id), "nota", txt(b.nota, 600), "atualizado", String(Date.now())]]);
      return { ok: true };
    }

    case "remarcar": {
      const id = String(b.id || "").replace(/[^\w]/g, "").slice(0, 20);
      if (!isDia(b.dia) || !isHora(b.hora)) throw new Err(400, "Escolha o novo dia e horário.");
      const a = toObj((await pipeline([["HGETALL", K.ag(id)]]))[0]);
      if (!a.id) throw new Err(404, "Agendamento não encontrado.");
      const [t] = await pipeline([["SET", K.slot(b.dia, b.hora), id, "NX", "EX", 86400 * 120]]);
      if (t !== "OK") throw new Err(409, "Já existe um agendamento nesse horário.");
      const [dono] = await pipeline([["GET", K.slot(a.dia, a.hora)]]);
      const cmds = [
        ["HSET", K.ag(id), "dia", b.dia, "hora", b.hora, "remarcadoDe", `${a.dia} ${a.hora}`, "atualizado", String(Date.now()), "status", a.status === "cancelado" ? "confirmado" : a.status],
        ["ZADD", K.lista, quando(b.dia, b.hora), id],
      ];
      if (dono === id) cmds.push(["DEL", K.slot(a.dia, a.hora)]);
      await pipeline(cmds);
      return { ok: true };
    }

    case "novo": { // agendamento feito pela própria Thalia (ex.: paciente ligou)
      if (!isDia(b.dia) || !isHora(b.hora)) throw new Err(400, "Escolha o dia e o horário.");
      const nome = txt(b.nome, 80);
      if (nome.length < 2) throw new Err(400, "Informe o nome do paciente.");
      const id = novoId();
      const [t] = await pipeline([["SET", K.slot(b.dia, b.hora), id, "NX", "EX", 86400 * 120]]);
      if (t !== "OK") throw new Err(409, "Já existe um agendamento nesse horário.");
      const cfg = await lerCfg();
      const servico = SERVICOS[b.servico] ? b.servico : "avaliacao", local = LOCAIS[b.local] ? b.local : "consultorio";
      const agora = String(Date.now());
      const ag = {
        id, dia: b.dia, hora: b.hora, dur: String(cfg.dur), servico, servicoNome: SERVICOS[servico], local, localNome: LOCAIS[local],
        nome, tel: String(b.tel || "").replace(/\D/g, "").slice(0, 13), endereco: txt(b.endereco, 160), regiao: txt(b.regiao, 40),
        obs: txt(b.obs, 400), status: "confirmado", origem: "adm", criado: agora, atualizado: agora,
      };
      await pipeline([["HSET", K.ag(id), ...Object.entries(ag).flat()], ["ZADD", K.lista, quando(b.dia, b.hora), id]]);
      return { ok: true, id };
    }

    case "apagar": {
      const id = String(b.id || "").replace(/[^\w]/g, "").slice(0, 20);
      const a = toObj((await pipeline([["HGETALL", K.ag(id)]]))[0]);
      const cmds = [["DEL", K.ag(id)], ["ZREM", K.lista, id]];
      if (a.id) { const [dono] = await pipeline([["GET", K.slot(a.dia, a.hora)]]); if (dono === id) cmds.push(["DEL", K.slot(a.dia, a.hora)]); }
      await pipeline(cmds);
      return { ok: true };
    }

    case "bloquear":
    case "desbloquear": {
      if (!isDia(b.dia) || (b.hora && !isHora(b.hora))) throw new Err(400, "Data inválida.");
      const item = b.hora ? `${b.dia} ${b.hora}` : b.dia;
      await pipeline([[b.acao === "bloquear" ? "SADD" : "SREM", K.bloq, item]]);
      return { ok: true };
    }

    case "config": {
      const cfg = limparCfg(b.cfg);
      await pipeline([["SET", K.cfg, JSON.stringify(cfg)]]);
      return { ok: true, cfg };
    }

    case "grade": { // horários de um dia, para remarcar/novo
      if (!isDia(b.dia)) throw new Err(400, "Data inválida.");
      const cfg = await lerCfg();
      const g = gradeDoDia(cfg, b.dia);
      const oc = g.length ? await pipeline([["MGET", ...g.map((h) => K.slot(b.dia, h))]]) : [[]];
      return { horas: g.map((h, i) => ({ hora: h, ocupado: Boolean(oc[0][i]) })) };
    }

    case "depoimentos": { // lista todos; ou muda status / apaga um
      const [raw] = await pipeline([["GET", K.deps]]);
      let lista = []; try { lista = JSON.parse(raw) || []; } catch {}
      if (b.id) {
        const id = String(b.id).replace(/[^\w]/g, "");
        if (b.status === "apagar") lista = lista.filter((d) => d.id !== id);
        else if (["aprovado", "oculto", "pendente"].includes(b.status)) lista.forEach((d) => { if (d.id === id) d.status = b.status; });
        await pipeline([["SET", K.deps, JSON.stringify(lista)]]);
      }
      return { depoimentos: lista };
    }

    case "videos": { // lê ou salva a lista de vídeos do site
      if (Array.isArray(b.videos)) {
        const CATS = ["exercicios", "dicas", "laser", "atendimentos", "eventos"];
        const ok = (u) => /^https:\/\//.test(String(u || "")) ? String(u).slice(0, 600) : "";
        const lista = b.videos.slice(0, 40).map((v, i) => ({
          id: String(v.id || "v" + Date.now().toString(36) + i).replace(/[^\w]/g, "").slice(0, 24),
          titulo: txt(v.titulo, 80), cat: CATS.includes(v.cat) ? v.cat : "dicas",
          video: ok(v.video), link: ok(v.link), capa: ok(v.capa),
        })).filter((v) => v.titulo || v.video || v.link);
        await pipeline([["SET", K.videos, JSON.stringify(lista)]]);
        return { ok: true, videos: lista };
      }
      const [raw] = await pipeline([["GET", K.videos]]);
      let v = []; try { v = JSON.parse(raw) || []; } catch {}
      return { videos: Array.isArray(v) ? v : [] };
    }

    default:
      throw new Err(400, "Ação desconhecida.");
  }
}
