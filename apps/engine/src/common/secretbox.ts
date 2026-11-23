import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM for secrets we must be able to use later (ATS API keys, webhook signing secrets).
 * Layout: 12-byte IV | 16-byte tag | ciphertext. The key comes from SECRETS_KEY.
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(secret: string) {
    // Accept any long string; derive a fixed 32-byte key from it.
    this.key = createHash('sha256').update(secret, 'utf8').digest();
  }

  seal(plain: string): Buffer {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), body]);
  }

  open(sealed: Buffer): string {
    const decipher = createDecipheriv('aes-256-gcm', this.key, sealed.subarray(0, 12));
    decipher.setAuthTag(sealed.subarray(12, 28));
    return Buffer.concat([decipher.update(sealed.subarray(28)), decipher.final()]).toString('utf8');
  }
}
