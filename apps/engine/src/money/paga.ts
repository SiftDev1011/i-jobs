import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { safeEqual } from '../common/crypto';
import { AppConfig, CONFIG } from '../config/config';

/**
 * Paga Collect: payment requests and their callbacks.
 * https://developer-docs.paga.com/docs/operations-1
 *
 * Two details the docs leave open and must be confirmed in Paga's sandbox before going live:
 *  - Basic auth is sent as publicKey:secretKey.
 *  - Empty optional fields join the request hash as empty strings.
 */
export interface PaymentRequest {
  reference: string;
  amountKobo: number;
  payer: { name: string; email?: string | null; phone?: string | null };
  description: string;
  callbackUrl: string;
  redirectUrl: string;
  expiresAt: Date;
}

export interface PaymentLink {
  checkoutUrl: string;
  providerRef: string;
  raw: unknown;
}

export interface PagaCallback {
  notificationId: string;
  statusCode: string;
  statusMessage?: string;
  externalReferenceNumber: string;
  state?: string;
  event?: string;
  outstandingBalance?: number | string | null;
  paymentAmount?: number | string;
  collectionFee?: number | string;
  hash: string;
  [k: string]: unknown;
}

const sha512 = (s: string) => createHash('sha512').update(s, 'utf8').digest('hex');
const naira = (kobo: number) => (kobo / 100).toFixed(2);

@Injectable()
export class PagaClient {
  /** Test hook: what the fake driver "sent". */
  readonly fakeRequests: PaymentRequest[] = [];

  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  async requestPayment(r: PaymentRequest): Promise<PaymentLink> {
    if (this.config.PAGA_DRIVER === 'fake') {
      this.fakeRequests.push(r);
      return { checkoutUrl: `https://checkout.invalid/pay/${r.reference}`, providerRef: r.reference, raw: { fake: true } };
    }
    const body = {
      referenceNumber: r.reference,
      amount: naira(r.amountKobo),
      currency: 'NGN',
      payer: { name: r.payer.name, ...(r.payer.email ? { email: r.payer.email } : {}), ...(r.payer.phone ? { phoneNumber: r.payer.phone } : {}) },
      payee: { name: this.config.PAGA_PAYEE_NAME },
      expiryDateTimeUTC: r.expiresAt.toISOString().replace(/\.\d{3}Z$/, ''),
      isSuppressMessages: false,
      payerCollectionFeeShare: 0,
      payeeCollectionFeeShare: 1,
      isAllowPartialPayments: false,
      isAllowOverPayments: false,
      callBackUrl: r.callbackUrl,
      redirectUrl: r.redirectUrl,
      paymentMethods: ['REQUEST_MONEY', 'BANK_TRANSFER', 'FUNDING_USSD'],
    };
    const hash = sha512(
      [body.referenceNumber, body.amount, body.currency, r.payer.phone ?? '', r.payer.email ?? '', '', '', '', '', this.config.PAGA_HASH_KEY].join(''),
    );
    const res = await fetch(`${this.config.PAGA_BASE_URL}/paymentRequest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Basic ${Buffer.from(`${this.config.PAGA_PUBLIC_KEY}:${this.config.PAGA_SECRET_KEY}`).toString('base64')}`,
        hash,
      },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as any;
    if (!res.ok || String(json.statusCode) !== '0') throw new Error(`Paga payment request failed: ${res.status} ${json.statusCode ?? ''} ${json.statusMessage ?? ''}`.trim());
    const link = (json.paymentMethods ?? []).find((m: any) => m.name === 'REQUEST_MONEY')?.properties?.WebPaymentLink;
    if (!link) throw new Error('Paga did not return a payment link');
    return { checkoutUrl: link, providerRef: String(json.referenceNumber ?? r.reference), raw: json };
  }

  /** SHA-512 of notificationId + statusCode + externalReferenceNumber + state + outstandingBalance (2 dp, omitted if null) + hash key. */
  verifyCallback(c: PagaCallback): boolean {
    if (!c?.hash || !c.notificationId || !c.externalReferenceNumber) return false;
    const balance = c.outstandingBalance === null || c.outstandingBalance === undefined || c.outstandingBalance === '' ? '' : Number(c.outstandingBalance).toFixed(2);
    const expected = sha512(`${c.notificationId}${c.statusCode}${c.externalReferenceNumber}${c.state ?? ''}${balance}${this.config.PAGA_HASH_KEY ?? ''}`);
    return safeEqual(expected.toLowerCase(), String(c.hash).toLowerCase());
  }

  /** For tests and the fake driver: a correctly signed callback. */
  signCallback(c: Omit<PagaCallback, 'hash'>): PagaCallback {
    const cb = c as PagaCallback;
    const balance = c.outstandingBalance === null || c.outstandingBalance === undefined ? '' : Number(c.outstandingBalance).toFixed(2);
    return { ...cb, hash: sha512(`${c.notificationId}${c.statusCode}${c.externalReferenceNumber}${c.state ?? ''}${balance}${this.config.PAGA_HASH_KEY ?? ''}`) };
  }

  static isPaid(c: PagaCallback): boolean {
    return String(c.statusCode) === '0' && (c.event === undefined || c.event === 'PAYMENT_COMPLETE') && (c.state === undefined || /complete|success|paid/i.test(c.state));
  }
}
