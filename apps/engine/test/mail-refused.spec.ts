import type { AppConfig } from '../src/config/config';
import { Problem } from '../src/common/problem';
import { MailService } from '../src/messaging/mail.service';

/** What happens when SES refuses a message, without calling SES. */
describe('Email that SES refuses', () => {
  const mail = new MailService({ MAIL_DRIVER: 'ses', AWS_REGION: 'eu-north-1', MAIL_FROM_ACCOUNT: 'i-jobs <no-reply@mail.example.com>', SES_CONFIGURATION_SET_ACCOUNT: 'ijobs-account', NODE_ENV: 'test' } as AppConfig);
  const sesFails = (name: string, message: string) => {
    (mail as unknown as { ses: { send: () => Promise<never> } }).ses = { send: async () => { throw Object.assign(new Error(message), { name }); } };
  };

  it('a sandbox refusal ("not verified") becomes a clear 503, not a 500', async () => {
    sesFails('MessageRejected', 'Email address is not verified. The following identities failed the check in region EU-NORTH-1: ada@example.com');
    const err = await mail.send({ to: 'ada@example.com', subject: 'Your code', text: '123456' }).catch((e) => e);
    expect(err).toBeInstanceOf(Problem);
    expect(err).toMatchObject({ status: 503, code: 'email_not_sent' });
  });

  it('anything else (SES down, network) still fails as an error, to be retried', async () => {
    sesFails('ServiceUnavailable', 'Service Unavailable');
    const err = await mail.send({ to: 'ada@example.com', subject: 'Your code', text: '123456' }).catch((e) => e);
    expect(err).not.toBeInstanceOf(Problem);
    expect(err.name).toBe('ServiceUnavailable');
  });
});
