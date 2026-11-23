import { createVerify } from 'node:crypto';

/**
 * Amazon SNS message signatures, so only real SES notices can suppress addresses.
 * https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html
 */
export interface SnsMessage {
  Type: 'Notification' | 'SubscriptionConfirmation' | 'UnsubscribeConfirmation';
  MessageId: string;
  TopicArn: string;
  Subject?: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: '1' | '2';
  Signature: string;
  SigningCertURL: string;
  SubscribeURL?: string;
  Token?: string;
}

const CERT_URL = /^https:\/\/sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?\/[^?#]+\.pem$/;
const SUBSCRIBE_URL = /^https:\/\/sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?\//;

export function stringToSign(m: SnsMessage): string {
  const keys =
    m.Type === 'Notification'
      ? ['Message', 'MessageId', ...(m.Subject !== undefined ? ['Subject'] : []), 'Timestamp', 'TopicArn', 'Type']
      : ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'];
  return keys.map((k) => `${k}\n${(m as unknown as Record<string, string>)[k]}\n`).join('');
}

export class SnsVerifier {
  private readonly certs = new Map<string, string>();

  constructor(private readonly fetchCert: (url: string) => Promise<string> = async (url) => (await fetch(url)).text()) {}

  async verify(m: SnsMessage): Promise<boolean> {
    if (!m || !m.Signature || !CERT_URL.test(m.SigningCertURL ?? '')) return false;
    if (m.SubscribeURL && !SUBSCRIBE_URL.test(m.SubscribeURL)) return false;
    // Reject replays older than an hour.
    if (Math.abs(Date.now() - Date.parse(m.Timestamp)) > 3600_000) return false;
    let cert = this.certs.get(m.SigningCertURL);
    if (!cert) {
      cert = await this.fetchCert(m.SigningCertURL);
      if (!cert.includes('BEGIN CERTIFICATE')) return false;
      this.certs.set(m.SigningCertURL, cert);
    }
    try {
      return createVerify(m.SignatureVersion === '2' ? 'RSA-SHA256' : 'RSA-SHA1').update(stringToSign(m), 'utf8').verify(cert, m.Signature, 'base64');
    } catch {
      return false;
    }
  }
}

export function isSubscribeUrl(url: string | undefined): url is string {
  return !!url && SUBSCRIBE_URL.test(url);
}
