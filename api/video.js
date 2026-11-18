import { handleUpload } from "@vercel/blob/client";
import { del } from "@vercel/blob";
import { dbReady, pipeline } from "./_db.js";
import { K, corpo } from "./_agenda.js";

// Envio de vídeos pela Área Adm, direto do celular para o Vercel Blob
// (o arquivo não passa pela função, então pode ser grande).
const MAX = 400 * 1024 * 1024; // 400 MB

function blobToken() {
  if (process.env.BLOB_READ_WRITE_TOKEN) return process.env.BLOB_READ_WRITE_TOKEN;
  const k = Object.keys(process.env).find((n) => /READ_WRITE_TOKEN$/.test(n) && /^vercel_blob_rw_/.test(String(process.env[n])));
  return k ? process.env[k] : "";
}
async function sessaoOk(tok) {
  tok = String(tok || "").replace(/[^a-f0-9]/g, "").slice(0, 64);
  if (tok.length !== 64 || !dbReady()) return false;
  const [ok] = await pipeline([["GET", K.sess(tok)]]);
  return Boolean(ok);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).end();
  const token = blobToken();
  if (!token) return res.status(503).json({ error: "Falta ligar o espaço de vídeos (Blob) na Vercel." });
  const body = corpo(req);
  if (body && body.acao === "apagar") {
    if (!(await sessaoOk(body.tok))) return res.status(401).json({ error: "Entre de novo." });
    const u = String(body.url || "");
    if (!/^https:\/\/[\w.-]+\.public\.blob\.vercel-storage\.com\/videos\//.test(u)) return res.status(400).json({ error: "url" });
    try { await del(u, { token }); } catch {}
    return res.status(200).json({ ok: true });
  }
  try {
    const out = await handleUpload({
      body, request: req, token,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        let p = {}; try { p = JSON.parse(clientPayload || "{}"); } catch {}
        if (!(await sessaoOk(p.tok))) throw new Error("Sua sessão expirou. Entre de novo.");
        if (!/^videos\//.test(pathname)) throw new Error("Caminho inválido.");
        return { allowedContentTypes: ["video/mp4", "video/quicktime", "video/webm", "video/x-m4v", "video/3gpp", "video/*"], maximumSizeInBytes: MAX, addRandomSuffix: true };
      },
    });
    return res.status(200).json(out);
  } catch (e) {
    return res.status(400).json({ error: String((e && e.message) || e) });
  }
}
