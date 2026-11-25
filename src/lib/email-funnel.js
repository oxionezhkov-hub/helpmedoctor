import { safeEqual } from "./auth.js";

const DAY = 86400000;
const providerColumns = {
  "email.delivered": "delivered_at",
  "email.bounced": "bounced_at",
  "email.complained": "complained_at",
  "email.clicked": "clicked_at",
};

export function emailProviderColumn(type) {
  return Object.hasOwn(providerColumns, type) ? providerColumns[type] : null;
}

export async function verifyEmailWebhook(secret, headers, payload, now = Date.now()) {
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signatures = headers.get("svix-signature");
  if (!id || !/^\d{1,12}$/.test(timestamp || "") || !signatures || Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  try {
    const rawKey = Uint8Array.from(atob(secret.replace(/^whsec_/, "")), c => c.charCodeAt(0));
    const key = await crypto.subtle.importKey("raw", rawKey, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const bytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${payload}`));
    const expected = btoa(String.fromCharCode(...new Uint8Array(bytes)));
    return signatures.split(" ").some(v => v.startsWith("v1,") && safeEqual(v.slice(3), expected));
  } catch {
    return false;
  }
}

export async function emailBucket(uid) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`winback-stage3-v1:${uid}`));
  return new DataView(bytes).getUint32(0) % 5 === 0 ? "control" : "treatment";
}

export function emailFunnel(h, { from, to } = {}, now = Date.now()) {
  const end = Math.min(Number(to) || now, now);
  const start = Math.max(Number(from) || end - 30 * DAY, end - 90 * DAY);
  const rows = h.all(`
    WITH cohort AS (
      SELECT m.*, p.delivered_at, p.bounced_at, p.complained_at, p.clicked_at,
        (SELECT MIN(n.assigned_at) FROM email_campaign n WHERE n.uid = m.uid AND n.assigned_at > m.assigned_at) AS next_at
      FROM email_campaign m LEFT JOIN email_provider p ON p.id = m.provider_id
      WHERE m.assigned_at >= ? AND m.assigned_at < ?
    ), outcomes AS (
      SELECT m.*,
        EXISTS(SELECT 1 FROM events e WHERE e.uid = m.uid AND e.type = 'finish' AND e.ts > m.assigned_at
          AND e.ts <= m.assigned_at + ${3 * DAY} AND (m.next_at IS NULL OR e.ts < m.next_at)) AS finished,
        EXISTS(SELECT 1 FROM payments p WHERE p.uid = m.uid AND p.status = 'paid' AND p.amount > 0
          AND p.updated_at > m.assigned_at AND p.updated_at <= m.assigned_at + ${7 * DAY}
          AND (m.next_at IS NULL OR p.updated_at < m.next_at)) AS paid
      FROM cohort m
    )
    SELECT segment, variant, stage, COUNT(*) AS assigned, COUNT(DISTINCT uid) AS recipients,
      COUNT(accepted_at) AS accepted, COUNT(failed_at) AS failed, COUNT(delivered_at) AS delivered, COUNT(bounced_at) AS bounced,
      COUNT(complained_at) AS complained, COUNT(clicked_at) AS provider_clicks, COUNT(visit_at) AS visits,
      SUM(CASE WHEN assigned_at <= ? THEN 1 ELSE 0 END) AS mature72,
      SUM(CASE WHEN assigned_at <= ? THEN finished ELSE 0 END) AS finished72,
      SUM(CASE WHEN assigned_at <= ? THEN 1 ELSE 0 END) AS mature7,
      SUM(CASE WHEN assigned_at <= ? THEN paid ELSE 0 END) AS paid7
    FROM outcomes GROUP BY segment, variant, stage ORDER BY stage, segment, variant
  `, start, end, end - 3 * DAY, end - 3 * DAY, end - 7 * DAY, end - 7 * DAY);
  return { rows, deliveryConfigured: !!h.env.RESEND_WEBHOOK_SECRET, from: start, to: end };
}
