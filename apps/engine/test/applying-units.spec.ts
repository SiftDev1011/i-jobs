import { execFileSync } from 'node:child_process';
import { createSign } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Applicant, checkClaims, composeLetter } from '../src/applying/compose';
import { buildMime } from '../src/applying/mime';
import { nextStatus, sortByRules, textFromRaw } from '../src/applying/replies';
import { SnsMessage, SnsVerifier, stringToSign } from '../src/applying/sns';

const ada: Applicant = {
  fullName: 'Ada Okafor', city: 'Lagos', country: 'NG', headline: 'Customer Support Specialist', summary: 'Three years supporting fintech customers.',
  years: 3, skills: ['Zendesk', 'Live chat', 'Excel'], links: ['https://ada.example'],
  experience: [{ title: 'Support Agent', company: 'Paylite', highlights: ['Answered 60 tickets a day'] }],
};
const job = { title: 'Customer Support Agent', company: 'Acme', description: 'Support customers with Zendesk and Intercom.', skills: ['zendesk', 'intercom'] };

describe('letters and the claim check', () => {
  it('passes a paragraph that sticks to the facts', () => {
    expect(checkClaims('In my 3 years at Paylite I answered 60 tickets a day in Zendesk, and I enjoy live chat support.', ada, job)).toEqual({ ok: true, problems: [] });
  });

  it('catches skills, years and numbers the profile does not have', () => {
    const r = checkClaims('I have 7 years of Intercom experience and cut response times by 40%.', ada, job);
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual(expect.arrayContaining(['mentions intercom', 'claims 7 years', 'number 40% not in profile']));
    expect(checkClaims('I am [Your Name], a great fit.', ada, job).problems).toContain('placeholder text');
  });

  it('writes the letter from the template', () => {
    const l = composeLetter(ada, job, 'A short checked paragraph.');
    expect(l.subject).toBe('Application for Customer Support Agent – Ada Okafor');
    expect(l.body).toContain('Dear Acme hiring team,');
    expect(l.body).toContain('A short checked paragraph.');
    expect(l.body).toContain('Key skills: Zendesk, Live chat, Excel.');
    expect(l.body).toContain('Lagos, Nigeria');
    expect(l.body).toContain('Sent with i-jobs on behalf of Ada Okafor');
    expect(composeLetter(ada, job, null).body).not.toContain('\n\n\n');
  });
});

describe('MIME', () => {
  it('builds a message with a CV attached', () => {
    const raw = buildMime({
      from: { name: 'Adaèze Okafor', address: 'ada.k3x9p2@apply.ijobs.example' }, to: 'jobs@acme.example', replyTo: 'ada.k3x9p2@apply.ijobs.example',
      subject: 'Application – Adaèze', text: 'Hello ₦', attachments: [{ filename: 'Ada_CV.pdf', contentType: 'application/pdf', content: Buffer.from('%PDF-1.4 x') }],
      headers: { 'X-Ijobs-Application': 'abc' },
    });
    expect(raw).toMatch(/^From: =\?UTF-8\?B\?[^?]+\?= <ada\.k3x9p2@apply\.ijobs\.example>\r\n/);
    expect(raw).toContain('Subject: =?UTF-8?B?');
    expect(raw).toContain('Content-Type: multipart/mixed; boundary="ij_');
    expect(raw).toContain('Content-Disposition: attachment; filename="Ada_CV.pdf"');
    expect(raw).toContain(Buffer.from('%PDF-1.4 x').toString('base64'));
    expect(raw).toContain('X-Ijobs-Application: abc');
    expect(raw.split('\r\n').every((l) => l.length <= 998)).toBe(true);
  });

  it('never lets a header value add lines', () => {
    const raw = buildMime({ from: { name: 'A', address: 'a@x.example' }, to: 'b@y.example', subject: 'Hi\r\nBcc: evil@z.example', text: 'x' });
    expect(raw).not.toMatch(/^Bcc:/m);
  });
});

describe('replies', () => {
  it.each([
    ['Interview invitation', 'We would like to schedule a call. Please share your availability.', 'interview'],
    ['Your application', 'Unfortunately we have decided to move forward with other candidates.', 'rejection'],
    ['Re: Application', 'Could you please send your portfolio and salary expectations?', 'info_request'],
    ['Automatic reply: Out of office', 'I am away until Monday.', 'auto_reply'],
    ['Thank you for applying', 'We have received your application and will be in touch.', 'auto_reply'],
    ['Thank you for applying', 'Unfortunately the role has been filled.', 'rejection'],
    ['Hello', 'Thanks, noted.', null],
  ])('%s → %s', (subject, text, cls) => {
    expect(sortByRules(subject, text)).toBe(cls);
  });

  it('statuses only move forward', () => {
    expect(nextStatus('sent', 'interview')).toBe('interview');
    expect(nextStatus('interview', 'other')).toBeNull();
    expect(nextStatus('sent', 'auto_reply')).toBeNull();
    expect(nextStatus('replied', 'rejection')).toBe('rejected');
    expect(nextStatus('rejected', 'interview')).toBeNull();
  });

  it('reads text out of raw MIME and drops the quoted history', () => {
    const raw = [
      'From: hr@acme.example', 'Subject: Re: Application', 'Content-Type: multipart/alternative; boundary="b1"', '',
      '--b1', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '',
      Buffer.from('Hi Ada,\nCan you do a call on Tuesday?\n\nOn Mon, 16 Nov 2026 at 10:00, Ada wrote:\n> Dear Acme hiring team').toString('base64'),
      '--b1', 'Content-Type: text/html', '', '<p>Hi</p>', '--b1--', '',
    ].join('\r\n');
    expect(textFromRaw(raw)).toBe('Hi Ada,\nCan you do a call on Tuesday?');
    expect(textFromRaw('Content-Type: text/plain\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nCaf=C3=A9 =\r\nmeeting')).toBe('Café meeting');
  });
});

describe('SNS signatures', () => {
  let key: string;
  let cert: string;
  beforeAll(() => {
    const dir = mkdtempSync(join(tmpdir(), 'sns-'));
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem'), '-days', '1', '-subj', '/CN=sns.amazonaws.com'], { stdio: 'ignore' });
    key = readFileSync(join(dir, 'k.pem'), 'utf8');
    cert = readFileSync(join(dir, 'c.pem'), 'utf8');
  });

  const signed = (over: Partial<SnsMessage> = {}): SnsMessage => {
    const m: SnsMessage = {
      Type: 'Notification', MessageId: 'm1', TopicArn: 'arn:aws:sns:eu-west-1:1:ses', Message: '{"eventType":"Bounce"}',
      Timestamp: new Date().toISOString(), SignatureVersion: '2', Signature: '', SigningCertURL: 'https://sns.eu-west-1.amazonaws.com/SimpleNotificationService-abc.pem', ...over,
    };
    m.Signature = createSign('RSA-SHA256').update(stringToSign(m)).sign(key, 'base64');
    return m;
  };

  it('accepts a correctly signed message and rejects tampering, fake cert hosts and old messages', async () => {
    const v = new SnsVerifier(async () => cert);
    expect(await v.verify(signed())).toBe(true);
    expect(await v.verify({ ...signed(), Message: '{"eventType":"Complaint"}' })).toBe(false);
    expect(await v.verify(signed({ SigningCertURL: 'https://evil.example/cert.pem' }))).toBe(false);
    expect(await v.verify(signed({ Timestamp: new Date(Date.now() - 2 * 3600_000).toISOString() }))).toBe(false);
  });
});
