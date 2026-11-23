import { Global, Module } from '@nestjs/common';
import { AccountModule } from '../account/account.module';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { TokensService } from './tokens.service';

@Global()
@Module({
  imports: [AccountModule],
  controllers: [AuthController],
  providers: [AuthService, TokensService, AuthGuard],
  exports: [TokensService, AuthGuard, AuthService],
})
export class AuthModule {}
