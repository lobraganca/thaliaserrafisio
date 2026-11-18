import { dbReady, pipeline } from "./_db.js";
import { K, txt, corpo, ipDe } from "./_agenda.js";

// GET  /api/depoimento → depoimentos aprovados pela Thalia
// POST /api/depoimento → paciente envia um depoimento (fica "pendente" até a Thalia aprovar na Área Adm)
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!dbReady()) return req.method === "GET" ? res.status(200).json({ depoimentos: [] }) : res.status(503).json({ erro: "Indisponível no momento." });
  try {
    const [raw] = await pipeline([["GET", K.deps]]);
    let lista = []; try { lista = JSON.parse(raw) || []; } catch {}
    if (req.method === "GET") {
      const pub = lista.filter((d) => d.status === "aprovado").map(({ id, nome, texto, trat, nota, data }) => ({ id, nome, texto, trat, nota, data }));
      return res.status(200).json({ depoimentos: pub });
    }
    if (req.method !== "POST") return res.status(405).end();
    const b = corpo(req);
    if (b.site) return res.status(200).json({ ok: true });
    const nome = txt(b.nome, 50), texto = txt(b.texto, 600), trat = txt(b.trat, 40);
    const nota = Math.min(5, Math.max(1, Math.round(+b.nota || 5)));
    if (nome.length < 2) return res.status(400).json({ erro: "Informe seu nome." });
    if (texto.length < 15) return res.status(400).json({ erro: "Conte um pouco mais sobre o seu atendimento." });
    const ip = ipDe(req);
    const [n] = await pipeline([["INCR", `th:rldep:${ip}`], ["EXPIRE", `th:rldep:${ip}`, 3600]]);
    if (+n > 3) return res.status(429).json({ erro: "Muitos envios seguidos. Tente mais tarde." });
    lista.unshift({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), nome, texto, trat, nota, data: new Date().toISOString().slice(0, 10), status: "pendente" });
    await pipeline([["SET", K.deps, JSON.stringify(lista.slice(0, 200))]]);
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ erro: "Não foi possível enviar agora." });
  }
}
