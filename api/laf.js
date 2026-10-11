// Laf Sok — sunucu tarafı. API anahtarı yalnızca burada, ortam değişkeninde durur.
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
const MAX_TEXT = 12000;
const MAX_IMAGES = 4;
const MAX_IMAGE_B64 = 1_400_000; // ~1 MB görsel başına
const ALLOWED_MEDIA = ["image/jpeg", "image/png", "image/webp", "image/gif"];

// Basit IP başına hız sınırı (instance başına; kötüye kullanımı yavaşlatır)
const hits = new Map();
const WINDOW_MS = 60_000, LIMIT = 8;
function limited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < WINDOW_MS);
  arr.push(now); hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > LIMIT;
}

const TONES = {
  hafif: "HAFİF: tatlı, esprili bir iğne. Kırıcı değil, gülümsetir. Küfür yok.",
  orta: "ORTA: net, zekice bir laf sokma. Karşı taraf cevap vermekte zorlanır ama ilişki bozulmaz.",
  acimasiz: "ACIMASIZ: keskin, alaycı, konuşmayı bitiren cevap. Zekâ ve ironiyle; sert ama yaratıcı."
};

function buildPrompt({ text, name, tone, swear, imageCount }) {
  return `Sen Türkçe konuşan, hazırcevap ve esprili bir "laf sokma" asistanısın. Kullanıcı bir mesajlaşma konuşması, ekran görüntüsü ya da yaşadığı bir olayı veriyor. Görevin: kullanıcının KARŞI TARAFA göndereceği, son mesaja verilecek en iyi cevapları yazmak.

${name ? `Konuşmada kullanıcının adı: "${name}". Bu kişinin mesajları kullanıcıya ait; diğerleri karşı taraf.` : `Ekran görüntüsünde sağdaki (genelde renkli) balonlar kullanıcıya, soldakiler karşı tarafa aittir.`}

Ton: ${TONES[tone]}
Küfür: ${swear ? "Serbest, ama her küfrü yıldızla sansürle (ör. s*ktir, a*k). Abartma, yerinde kullan." : "Kesinlikle küfür kullanma."}

Kurallar:
- Doğal, gündelik Türkçe; WhatsApp/Instagram DM gibi kısa (genelde 1-2 cümle). Gerekirse en fazla 1 emoji.
- Karşı tarafın son söylediğine doğrudan, bağlama özel cevap ver; genel geçer laf yazma.
- 3 farklı cevap üret, her biri farklı açıdan (ters köşe, ironi, kelime oyunu, soğukkanlılık…).
- Irk, din, etnik köken, cinsiyet, cinsel yönelim, engellilik üzerinden aşağılama; tehdit veya taciz yok.
- Karşı tarafın son mesajını kısaca özetle (en fazla 60 karakter) ve kimden geldiğini belirt.

YALNIZCA şu JSON'u döndür, başka hiçbir şey yazma:
{"them":"karşı tarafın adı veya 'karşı taraf'","last":"son mesajın kısa hali","replies":[{"text":"cevap","vibe":"2-3 kelimelik tarz etiketi"}]}

${text ? `Kullanıcının verdiği metin:\n"""\n${text}\n"""` : "Metin yok; ekran görüntülerine bak."}${imageCount ? `\n\n${imageCount} ekran görüntüsü ekli; konuşmayı oradan oku.` : ""}`;
}

function parseJSON(s) {
  try { return JSON.parse(s); } catch {}
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch {} }
  return null;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Yalnızca POST." });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error: "Servis henüz yapılandırılmadı (API anahtarı eksik)." });

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "?";
  if (limited(ip)) return res.status(429).json({ error: "Biraz hızlı gittin. Bir dakika sonra tekrar dene." });

  const body = typeof req.body === "string" ? parseJSON(req.body) || {} : (req.body || {});
  const tone = TONES[body.tone] ? body.tone : "orta";
  const swear = !!body.swear && tone !== "hafif";
  const name = String(body.name || "").slice(0, 40).replace(/["\n]/g, "");
  const text = String(body.text || "").slice(0, MAX_TEXT).trim();
  const images = Array.isArray(body.images) ? body.images.slice(0, MAX_IMAGES) : [];

  const imgBlocks = [];
  for (const im of images) {
    if (!im || !ALLOWED_MEDIA.includes(im.type) || typeof im.data !== "string" || im.data.length > MAX_IMAGE_B64)
      return res.status(400).json({ error: "Görsellerden biri okunamadı. PNG ya da JPG dene." });
    imgBlocks.push({ type: "image", source: { type: "base64", media_type: im.type, data: im.data } });
  }
  if (!text && !imgBlocks.length) return res.status(400).json({ error: "Önce konuşmayı yapıştır ya da ekran görüntüsü ekle." });

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 800,
        messages: [{ role: "user", content: [...imgBlocks, { type: "text", text: buildPrompt({ text, name, tone, swear, imageCount: imgBlocks.length }) }] }]
      })
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error("anthropic", r.status, data?.error?.message);
      const msg = r.status === 429 || r.status === 529 ? "Şu an çok yoğunuz. Biraz sonra tekrar dene." : "Yapay zeka şu an cevap veremedi. Tekrar dene.";
      return res.status(502).json({ error: msg });
    }
    const out = (data.content || []).filter(c => c.type === "text").map(c => c.text).join("");
    const j = parseJSON(out);
    const replies = (j?.replies || []).filter(x => x && x.text).slice(0, 3).map(x => ({ text: String(x.text), vibe: String(x.vibe || "") }));
    if (!replies.length) return res.status(502).json({ error: "Bu içerikle cevap yazılamadı. Metni biraz değiştirip dene." });
    return res.status(200).json({ them: String(j.them || "karşı taraf"), last: String(j.last || ""), replies });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Bağlantı sorunu. Tekrar dene." });
  }
}

export const config = { api: { bodyParser: { sizeLimit: "4mb" } }, maxDuration: 60 };
