import { dbReady, dbMissing } from "./_db.js";
import { lerCfg, livres, isDia, hojeBR } from "./_agenda.js";

// GET /api/horarios?de=AAAA-MM-DD&dias=14  → horários livres por dia
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!dbReady()) return res.status(503).json({ erro: `A agenda ainda não foi conectada ao banco. Falta: ${dbMissing()}.` });
  try {
    const hoje = hojeBR();
    let de = isDia(req.query?.de) ? req.query.de : hoje;
    if (de < hoje) de = hoje;
    const n = Math.min(42, Math.max(1, +req.query?.dias || 14));
    const cfg = await lerCfg();
    const dias = await livres(cfg, de, n);
    return res.status(200).json({ dias, dur: cfg.dur, janela: cfg.janela, hoje });
  } catch (e) {
    return res.status(500).json({ erro: String((e && e.message) || e) });
  }
}
