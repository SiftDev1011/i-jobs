import { Inject, Injectable, Logger } from '@nestjs/common';
import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { AppConfig, CONFIG } from '../config/config';

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html?: string;
  from?: string;
  replyTo?: string;
  configurationSet?: string;
}

/**
 * Account emails (sign-in codes, alerts, parent approvals). Application emails
 * from relay addresses use the relay sender in the applying module, on a
 * separate domain and configuration set.
 *
 * MAIL_DRIVER=console logs instead of sending and keeps an outbox for tests.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger('Mail');
  private readonly ses?: SESv2Client;
  readonly outbox: OutgoingMail[] = [];
  /** Raw (MIME) messages sent with the console driver, for tests. */
  readonly rawOutbox: { from: string; to: string; raw: string; configurationSet: string }[] = [];

  constructor(@Inject(CONFIG) private readonly config: AppConfig) {
    if (config.MAIL_DRIVER === 'ses') this.ses = new SESv2Client({ region: config.AWS_REGION });
  }

  async send(mail: OutgoingMail): Promise<string | undefined> {
    if (!this.ses) {
      this.outbox.push(mail);
      if (this.config.NODE_ENV !== 'test') this.logger.log(`[console mail] to=${mail.to} subject="${mail.subject}"\n${mail.text}`);
      return undefined;
    }
    const out = await this.ses.send(
      new SendEmailCommand({
        FromEmailAddress: mail.from ?? this.config.MAIL_FROM_ACCOUNT,
        Destination: { ToAddresses: [mail.to] },
        ReplyToAddresses: mail.replyTo ? [mail.replyTo] : undefined,
        ConfigurationSetName: mail.configurationSet ?? this.config.SES_CONFIGURATION_SET_ACCOUNT,
        Content: {
          Simple: {
            Subject: { Data: mail.subject, Charset: 'UTF-8' },
            Body: {
              Text: { Data: mail.text, Charset: 'UTF-8' },
              ...(mail.html ? { Html: { Data: mail.html, Charset: 'UTF-8' } } : {}),
            },
          },
        },
      }),
    );
    return out.MessageId;
  }

  /** A ready-made MIME message (applications with a CV attached). Returns the SES message id. */
  async sendRaw(m: { from: string; to: string; raw: string; configurationSet: string }): Promise<string> {
    if (!this.ses) {
      this.rawOutbox.push(m);
      return `console-${this.rawOutbox.length}-${Date.now()}`;
    }
    const out = await this.ses.send(
      new SendEmailCommand({
        FromEmailAddress: m.from,
        Destination: { ToAddresses: [m.to] },
        ConfigurationSetName: m.configurationSet,
        Content: { Raw: { Data: Buffer.from(m.raw, 'utf8') } },
      }),
    );
    return out.MessageId!;
  }
}
