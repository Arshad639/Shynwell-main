// Supabase Edge Function: sends contact-form email through Resend. The API key stays server-side.
// Deploy:  supabase functions deploy contact-email --no-verify-jwt
//          supabase secrets set RESEND_API_KEY=re_xxx OWNER_EMAIL=you@example.com FROM_EMAIL="Shynwell <hello@yourdomain.com>" ALLOWED_ORIGINS=https://yourdomain.com,http://localhost:5500
// Then in Admin > Contact > Email service choose "Custom webhook" and paste the function URL.
const cors = (o: string) => ({ 'Access-Control-Allow-Origin': o, 'Vary': 'Origin', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' });
// Best-effort per-IP limit: 3 requests per 10 minutes (resets if the function instance restarts).
const hits = new Map<string, number[]>();
const limited = (ip: string) => { const n = Date.now(), a = (hits.get(ip) ?? []).filter((t) => n - t < 6e5); a.push(n); hits.set(ip, a); return a.length > 3 };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
Deno.serve(async (req) => {
  // ALLOWED_ORIGINS = comma list, e.g. https://yourdomain.com,http://localhost:5500
  const allowed = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const reqOrigin = req.headers.get('origin') ?? '';
  const h = cors(allowed.includes(reqOrigin) ? reqOrigin : (allowed[0] ?? 'null'));
  if (req.method === 'OPTIONS') return new Response(null, { headers: h });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: h });
  if (!allowed.includes(reqOrigin)) return new Response('Forbidden', { status: 403, headers: h });
  if (!(req.headers.get('content-type') ?? '').includes('application/json')) return new Response('Unsupported', { status: 415, headers: h });
  if (limited(req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown')) return new Response('Too many requests', { status: 429, headers: h });
  const raw = await req.text(); if (raw.length > 10000) return new Response('Too large', { status: 413, headers: h });
  let d: any; try { d = JSON.parse(raw) } catch { return new Response('Bad request', { status: 400, headers: h }) }
  if (d.website_url) return new Response('ok', { status: 200, headers: h }); // honeypot: pretend success
  const name = String(d.name ?? '').slice(0, 120), email = String(d.email ?? '').slice(0, 200), phone = String(d.phone ?? '').slice(0, 30), message = String(d.message ?? '').slice(0, 4000);
  if (name.length < 2 || !/^\S+@\S+\.\S+$/.test(email) || message.length < 5) return new Response('Invalid input', { status: 422, headers: h });
  const key = Deno.env.get('RESEND_API_KEY'), owner = Deno.env.get('OWNER_EMAIL'), from = Deno.env.get('FROM_EMAIL');
  if (!key || !owner || !from) return new Response('Server not configured', { status: 500, headers: h });
  const send = (to: string, subject: string, html: string, reply?: string) => fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to, subject, html, reply_to: reply }) });
  const r1 = await send(owner, `New Shynwell enquiry from ${name}`, `<p><b>${esc(name)}</b> (${esc(email)}, ${esc(phone || 'no phone')})</p><p>${esc(message).replace(/\n/g, '<br>')}</p>`, email);
  if (!r1.ok) return new Response('Send failed', { status: 502, headers: h });
  await send(email, 'We received your message - Shynwell', `<p>Hi ${esc(name)}, thank you for contacting Shynwell. We will reply soon.</p>`);
  return new Response('ok', { status: 200, headers: h });
});
