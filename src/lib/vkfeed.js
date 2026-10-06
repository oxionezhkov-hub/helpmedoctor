// Лента RSS для группы ВК «Для будущих врачей»: ВК сам забирает новые записи (импорт RSS в настройках сообщества).
// Посты приходят из GitHub Actions (workflow «Группа ВК», ветки vk/**): POST /feed/vk/push с подписью
// HMAC-SHA256(SESSION_SECRET, "vkfeed:" + тело). Хранятся в KV: список записей и картинки.
// Адреса: https://helpmedoctor.ru/vk/rss.xml — лента, /vk/img/<id>.jpg — картинка записи.

const ITEMS = "vkfeed:items";
const IMG = (id) => `vkfeed:img:${id}`;
const MAX_ITEMS = 50;
const MAX_IMG = 4 * 1024 * 1024;
const enc = new TextEncoder();

async function sign(secret, body) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`vkfeed:${body}`)));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function sameHex(a, b) {
  if (typeof a !== "string" || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const xml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const cdata = (s) => `<![CDATA[${String(s ?? "").replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;

/** Принять запись из GitHub Actions */
export async function vkFeedPush(request, env) {
  if (!env.SESSION_SECRET) return new Response("not configured", { status: 503 });
  const body = await request.text();
  if (!sameHex(request.headers.get("X-Feed-Sig") || "", await sign(env.SESSION_SECRET, body))) return new Response("forbidden", { status: 403 });
  let p;
  try { p = JSON.parse(body); } catch { return new Response("bad json", { status: 400 }); }
  // Подпись свежая: старое тело повторно не примем
  if (!(Math.abs(Date.now() - Number(p.ts || 0)) < 10 * 60000)) return new Response("stale", { status: 400 });
  const id = String(p.id || "");
  if (!/^[a-z0-9-]{3,80}$/.test(id) || !p.text || String(p.text).length > 15000) return new Response("bad post", { status: 400 });
  const items = (await env.HELPMEDOCTOR.get(ITEMS, "json")) || [];
  let img = null;
  if (p.image) {
    const bin = Uint8Array.from(atob(p.image), (c) => c.charCodeAt(0));
    if (bin.byteLength > MAX_IMG) return new Response("image too big", { status: 400 });
    await env.HELPMEDOCTOR.put(IMG(id), bin, { metadata: { type: p.image_type || "image/jpeg" } });
    img = { len: bin.byteLength, type: p.image_type || "image/jpeg" };
  }
  const item = { id, title: String(p.title || "").slice(0, 200), text: String(p.text), link: p.link ? String(p.link) : null, img, ts: Date.now() };
  const rest = items.filter((x) => x.id !== id);
  const next = [item, ...rest].slice(0, MAX_ITEMS);
  await env.HELPMEDOCTOR.put(ITEMS, JSON.stringify(next));
  for (const old of rest.slice(MAX_ITEMS - 1)) if (old.img) await env.HELPMEDOCTOR.delete(IMG(old.id)).catch(() => {});
  return Response.json({ ok: true, id, items: next.length });
}

/** RSS 2.0 для импорта в ВК */
export async function vkFeedRss(env, origin) {
  const items = (await env.HELPMEDOCTOR.get(ITEMS, "json")) || [];
  const site = origin.replace(/\/$/, "");
  const body = items.map((it) => `
    <item>
      <title>${xml(it.title)}</title>
      ${it.link ? `<link>${xml(it.link)}</link>` : ""}
      <guid isPermaLink="false">vk-${xml(it.id)}</guid>
      <pubDate>${new Date(it.ts).toUTCString()}</pubDate>
      <description>${cdata(it.text)}</description>
      ${it.img ? `<enclosure url="${xml(`${site}/vk/img/${it.id}.jpg`)}" length="${it.img.len}" type="${xml(it.img.type)}"/>` : ""}
    </item>`).join("");
  const out = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Для будущих врачей</title>
    <link>${xml(site)}/</link>
    <description>Полезные материалы, лайфхаки и клинические случаи для студентов-медиков</description>
    <language>ru</language>${body}
  </channel>
</rss>`;
  return new Response(out, { headers: { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "public, max-age=300", "X-Robots-Tag": "noindex" } });
}

/** Картинка записи */
export async function vkFeedImage(env, id) {
  const r = await env.HELPMEDOCTOR.getWithMetadata(IMG(id), "arrayBuffer");
  if (!r?.value) return new Response("not found", { status: 404 });
  return new Response(r.value, { headers: { "Content-Type": r.metadata?.type || "image/jpeg", "Cache-Control": "public, max-age=86400" } });
}

export { sign as vkFeedSign };
