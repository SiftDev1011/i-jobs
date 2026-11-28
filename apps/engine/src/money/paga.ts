import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { safeEqual } from '../common/crypto';
import { Problem } from '../common/problem';
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
/** Paga wants the amount as a JSON number of naira (9000, or 9000.5), and hashes it written the same way. */
const naira = (kobo: number) => Math.round(kobo) / 100;

@Injectable()
export class PagaClient {
  /** Test hook: what the fake driver "sent". */
  readonly fakeRequests: PaymentRequest[] = [];
  private readonly logger = new Logger('Paga');

  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  /** False with PAGA_DRIVER=off: payments aren't set up yet. */
  get enabled(): boolean {
    return this.config.PAGA_DRIVER !== 'off';
  }

  /** Call before creating anything a payment needs, so nothing is left half made. */
  assertEnabled(): void {
    if (!this.enabled) throw Problem.unavailable('payments_off', 'Payments open soon. Check back in a few days.');
  }

  async requestPayment(r: PaymentRequest): Promise<PaymentLink> {
    this.assertEnabled();
    if (this.config.PAGA_DRIVER === 'fake') {
      this.fakeRequests.push(r);
      // The web app's demo checkout (a relative link, so it works at any address the app is served from).
      return { checkoutUrl: `/demo-pay/${r.reference}`, providerRef: r.reference, raw: { fake: true } };
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
      [body.referenceNumber, String(body.amount), body.currency, r.payer.phone ?? '', r.payer.email ?? '', '', '', '', '', this.config.PAGA_HASH_KEY].join(''),
    );
    const failed = (why: string) => {
      this.logger.error(`Paga payment request ${r.reference} failed: ${why}`);
      return Problem.unavailable('payment_provider_error', 'Paga didn’t accept the payment just now. Try again in a few minutes.');
    };
    let res: Response;
    try {
      res = await fetch(`${this.config.PAGA_BASE_URL}/paymentRequest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Basic ${Buffer.from(`${this.config.PAGA_PUBLIC_KEY}:${this.config.PAGA_SECRET_KEY}`).toString('base64')}`,
        hash,
      },
      body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      throw failed(`no answer (${(e as Error).message})`);
    }
    const text = await res.text().catch(() => '');
    let json: any = {};
    try { json = JSON.parse(text); } catch { /* not JSON: logged below */ }
    if (!res.ok || String(json.statusCode) !== '0') throw failed(`HTTP ${res.status}: ${text.slice(0, 500)}`);
    const link = (json.paymentMethods ?? []).find((m: any) => m.name === 'REQUEST_MONEY')?.properties?.WebPaymentLink;
    if (!link) throw failed(`no payment link in the answer: ${text.slice(0, 500)}`);
    return { checkoutUrl: link, providerRef: String(json.referenceNumber ?? r.reference), raw: json };
  }

  /** SHA-512 of notificationId + statusCode + externalReferenceNumber + state + outstandingBalance (2 dp, omitted if null) + hash key. */
  verifyCallback(c: PagaCallback): boolean {
    if (!this.enabled || !c?.hash || !c.notificationId || !c.externalReferenceNumber) return false;
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
