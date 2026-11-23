import { Body, Controller, Delete, Headers, HttpCode, Ip, Post } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../common/zod';
import { Actor, Auth, CurrentActor, Public } from './actor';
import { AuthService } from './auth.service';

const SendCode = z.object({
  target: z.string().min(3).max(254),
  channel: z.enum(['email', 'sms']).optional(),
});
const SignIn = z.object({
  target: z.string().min(3).max(254),
  code: z.string().regex(/^[0-9]{6}$/, 'Enter the 6-digit code'),
});
const Refresh = z.object({ refresh_token: z.string().min(20) });

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('codes')
  @HttpCode(204)
  async sendCode(@Body(new ZodPipe(SendCode)) body: z.infer<typeof SendCode>, @Ip() ip: string) {
    await this.auth.sendCode(body.target, ip);
  }

  @Public()
  @Post('sessions')
  @HttpCode(200)
  signIn(
    @Body(new ZodPipe(SignIn)) body: z.infer<typeof SignIn>,
    @Ip() ip: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.auth.signIn(body.target, body.code, { ip, userAgent });
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body(new ZodPipe(Refresh)) body: z.infer<typeof Refresh>) {
    return this.auth.refresh(body.refresh_token);
  }

  @Auth('user')
  @Delete('sessions/current')
  @HttpCode(204)
  async signOut(@CurrentActor() actor: Actor) {
    if (actor.kind === 'user') await this.auth.signOut(actor.sessionId);
  }
}
