/**
 * Cloudflare Email Worker for the relay domain (remotehustle.name.ng).
 * Email Routing sends every message for *@remotehustle.name.ng here. We keep the raw message in R2,
 * then tell the engine, which matches it to the member and the application and passes it on.
 * Nothing is forwarded from here: the engine decides who gets what.
 */
import PostalMime from 'postal-mime';

const MAX_BYTES = 10 * 1024 * 1024;

export default {
  async email(message, env, ctx) {
    if (message.rawSize > MAX_BYTES) {
      message.setReject('Message too large');
      return;
    }
    const raw = await new Response(message.raw).arrayBuffer();
    const key = `inbound/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.eml`;
    await env.FILES.put(key, raw, { httpMetadata: { contentType: 'message/rfc822' } });

    const parsed = await PostalMime.parse(raw);
    const body = JSON.stringify({
      to: message.to,
      from: message.from,
      subject: parsed.subject ?? '',
      message_id: parsed.messageId ?? undefined,
      in_reply_to: parsed.inReplyTo ?? undefined,
      raw_key: key,
      text: (parsed.text ?? '').slice(0, 50000),
    });

    const res = await fetch(`${env.ENGINE_URL}/v1/hooks/inbound-email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ijobs-signature': `sha256=${await hmac(env.INBOUND_EMAIL_SECRET, body)}` },
      body,
    });
    // A 5xx or network error throws, so the sending server retries later. A 4xx is a real "no".
    if (res.status >= 500) throw new Error(`Engine said ${res.status}`);
    if (!res.ok) message.setReject('Address not accepted');
  },
};

async function hmac(secret, text) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
