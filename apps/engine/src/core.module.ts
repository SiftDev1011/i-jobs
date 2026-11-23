import { Global, Module } from '@nestjs/common';
import { CONFIG, loadConfig } from './config/config';
import { Db } from './db/db.service';
import { MailService } from './messaging/mail.service';
import { SmsService } from './messaging/sms.service';
import { QueueService } from './queues/queue.service';
import { RedisService } from './redis/redis.service';
import { SitesService } from './sites/sites.service';
import { StorageService } from './storage/storage.service';

/** Shared services every module can inject: config, database, Redis, queues, sites, mail, SMS and file storage. */
@Global()
@Module({
  providers: [
    { provide: CONFIG, useFactory: () => loadConfig() },
    Db,
    RedisService,
    SitesService,
    MailService,
    SmsService,
    StorageService,
    QueueService,
  ],
  exports: [CONFIG, Db, RedisService, SitesService, MailService, SmsService, StorageService, QueueService],
})
export class CoreModule {}
