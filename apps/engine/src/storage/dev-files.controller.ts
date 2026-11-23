import { Controller, Get, HttpCode, Param, Put, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../auth/actor';
import { Problem } from '../common/problem';
import { StorageService } from './storage.service';

const MAX_BYTES = 6 * 1024 * 1024;

/**
 * Development only (STORAGE_DRIVER=local): the signed upload and download links that R2 gives in
 * production. Every request needs a valid, unexpired signature from StorageService.
 */
@Public()
@Controller('dev/files')
export class DevFilesController {
  constructor(private readonly storage: StorageService) {}

  @Put('*key')
  @HttpCode(200)
  async upload(@Param('key') keyParts: string | string[], @Query() q: Record<string, string>, @Req() req: Request) {
    const key = [keyParts].flat().join('/');
    const size = Number(q.size);
    if (!this.storage.isLocal || !this.storage.localCheck('PUT', key, Number(q.exp), q.sig, `${q.type}\n${q.size}`)) {
      throw Problem.forbidden('bad_signature', 'This upload link is not valid or has expired');
    }
    if (req.headers['content-type'] !== q.type) throw Problem.badRequest('wrong_type', `Upload this file as ${q.type}`);
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of req) {
      total += (chunk as Buffer).length;
      if (total > MAX_BYTES) throw Problem.badRequest('too_large', 'The file is too large');
      chunks.push(chunk as Buffer);
    }
    const body = chunks.length ? Buffer.concat(chunks) : Buffer.isBuffer((req as unknown as { rawBody?: Buffer }).rawBody) ? (req as unknown as { rawBody: Buffer }).rawBody : Buffer.alloc(0);
    if (body.length !== size) throw Problem.badRequest('wrong_size', 'The file size does not match the upload link');
    await this.storage.put(key, body, q.type);
    return { ok: true };
  }

  @Get('*key')
  async download(@Param('key') keyParts: string | string[], @Query() q: Record<string, string>, @Res() res: Response) {
    const key = [keyParts].flat().join('/');
    if (!this.storage.isLocal || !this.storage.localCheck('GET', key, Number(q.exp), q.sig, q.name ?? '')) {
      throw Problem.forbidden('bad_signature', 'This download link is not valid or has expired');
    }
    const info = await this.storage.stat(key);
    if (!info) throw Problem.notFound('file_not_found', 'There is no file here');
    res.setHeader('content-type', info.contentType ?? 'application/octet-stream');
    res.setHeader('content-disposition', `attachment; filename="${(q.name ?? 'file').replace(/[^\w.-]/g, '_')}"`);
    res.send(await this.storage.get(key));
  }
}
