import { Module } from '@nestjs/common';
import { AccountController } from './account.controller';
import { AccessService } from './access.service';
import { AccountService } from './account.service';

@Module({
  controllers: [AccountController],
  providers: [AccountService, AccessService],
  exports: [AccountService, AccessService],
})
export class AccountModule {}
