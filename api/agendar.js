import { dbReady, pipeline } from "./_db.js";
import { K, SERVICOS, LOCAIS, lerCfg, gradeDoDia, quando, hojeBR, somaDias, isDia, isHora, novoId, txt, corpo, ipDe } from "./_agenda.js";

// POST /api/agendar  → cria um agendamento (status "pendente" até a Thalia confirmar)
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ erro: "Use POST" });
  if (!dbReady()) return res.status(503).json({ erro: "A agenda online está em manutenção. Chame a Thalia no WhatsApp." });
  try {
    const b = corpo(req);
    if (b.site) return res.status(200).json({ ok: true, id: "OK" }); // campo invisível: robôs preenchem, pessoas não

    const dia = String(b.dia || ""), hora = String(b.hora || "");
    const servico = String(b.servico || ""), local = String(b.local || "");
    const nome = txt(b.nome, 80), tel = String(b.tel || "").replace(/\D/g, "").slice(0, 13);
    const endereco = txt(b.endereco, 160), regiao = txt(b.regiao, 40), obs = txt(b.obs, 400);

    if (!isDia(dia) || !isHora(hora)) return res.status(400).json({ erro: "Escolha o dia e o horário." });
    if (!SERVICOS[servico]) return res.status(400).json({ erro: "Escolha o tipo de atendimento." });
    if (!LOCAIS[local]) return res.status(400).json({ erro: "Escolha consultório ou domicílio." });
    if (nome.length < 2) return res.status(400).json({ erro: "Informe seu nome." });
    if (tel.length < 10) return res.status(400).json({ erro: "Informe um WhatsApp válido com DDD." });
    if (local === "domicilio" && endereco.length < 5) return res.status(400).json({ erro: "Informe o endereço para o atendimento em casa." });

    // limite contra spam: 6 agendamentos por hora vindos da mesma internet
    const ip = ipDe(req);
    const [n] = await pipeline([["INCR", K.rl(ip)], ["EXPIRE", K.rl(ip), 3600]]);
    if (+n > 6) return res.status(429).json({ erro: "Muitos agendamentos seguidos. Tente de novo mais tarde ou chame no WhatsApp." });

    // o horário precisa existir na agenda, estar no futuro e dentro da janela
    const cfg = await lerCfg();
    const ini = quando(dia, hora);
    if (!gradeDoDia(cfg, dia).includes(hora)) return res.status(409).json({ erro: "Esse horário não está disponível. Escolha outro." });
    if (ini < Date.now() + cfg.antecedencia * 3600e3 || dia > somaDias(hojeBR(), cfg.janela)) return res.status(409).json({ erro: "Esse horário não está mais disponível. Escolha outro." });
    const [bloqDia, bloqHora] = await pipeline([["SISMEMBER", K.bloq, dia], ["SISMEMBER", K.bloq, `${dia} ${hora}`]]);
    if (+bloqDia || +bloqHora) return res.status(409).json({ erro: "Esse horário não está disponível. Escolha outro." });

    // reserva o horário de forma atômica: se duas pessoas tentarem juntas, só uma consegue
    const id = novoId();
    const ttl = Math.max(3600, Math.ceil((ini - Date.now()) / 1000) + 86400 * 2);
    const [trava] = await pipeline([["SET", K.slot(dia, hora), id, "NX", "EX", ttl]]);
    if (trava !== "OK") return res.status(409).json({ erro: "Esse horário acabou de ser reservado por outra pessoa. Escolha outro." });

    const agora = Date.now();
    const ag = {
      id, dia, hora, dur: String(cfg.dur), servico, servicoNome: SERVICOS[servico], local, localNome: LOCAIS[local],
      nome, tel, endereco: local === "domicilio" ? endereco : "", regiao, obs, status: "pendente", origem: "site",
      criado: String(agora), atualizado: String(agora),
    };
    await pipeline([
      ["HSET", K.ag(id), ...Object.entries(ag).flat()],
      ["ZADD", K.lista, ini, id],
    ]);
    return res.status(200).json({ ok: true, id, dia, hora, servico: ag.servicoNome, local: ag.localNome });
  } catch (e) {
    return res.status(500).json({ erro: "Não consegui concluir o agendamento agora. Tente de novo ou chame no WhatsApp." });
  }
}
