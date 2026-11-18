import { dbReady, pipeline } from "./_db.js";
import { K } from "./_agenda.js";

// GET /api/videos → lista pública de vídeos do site
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "public, max-age=30, s-maxage=30");
  if (!dbReady()) return res.status(200).json({ videos: [] });
  try {
    const [raw] = await pipeline([["GET", K.videos]]);
    let v = []; try { v = JSON.parse(raw) || []; } catch {}
    return res.status(200).json({ videos: Array.isArray(v) ? v : [] });
  } catch { return res.status(200).json({ videos: [] }); }
}
