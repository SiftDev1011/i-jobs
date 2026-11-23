import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { Problem } from './problem';

/** Addresses a webhook or website check must never reach: our own network, cloud metadata, loopback. */
const blocked = new BlockList();
for (const [net, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96], ['2001:db8::', 32]] as const) blocked.addSubnet(net, bits, 'ipv6');

export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return blocked.check(ip, 'ipv4');
  if (v === 6) {
    const mapped = ip.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return blocked.check(mapped[1], 'ipv4');
    return blocked.check(ip, 'ipv6');
  }
  return true;
}

const BAD_HOSTS = /(^localhost$|\.localhost$|\.local$|\.internal$|\.lan$|\.home$|\.corp$|^metadata\.google\.internal$)/i;

/** Shape check when a URL is saved: https, a real public host name or address, no passwords in it. */
export function assertPublicHttpsUrl(raw: string, field = 'url'): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw Problem.unprocessable('invalid_url', `${field} is not a valid URL`);
  }
  if (u.protocol !== 'https:') throw Problem.unprocessable('https_required', `${field} must start with https://`);
  if (u.username || u.password) throw Problem.unprocessable('invalid_url', `${field} must not contain a user name or password`);
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (BAD_HOSTS.test(host) || !host.includes('.') && !isIP(host)) throw Problem.unprocessable('private_address', `${field} must be a public address`);
  if (isIP(host) && isPrivateAddress(host)) throw Problem.unprocessable('private_address', `${field} must be a public address`);
  return u;
}

export type Resolver = (host: string) => Promise<string[]>;
const defaultResolver: Resolver = async (host) => (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);

/** Check at send time too: a public name can be pointed at a private address after it was saved. */
export async function resolvesPublic(host: string, resolve: Resolver = defaultResolver): Promise<boolean> {
  const bare = host.replace(/^\[|\]$/g, '');
  if (isIP(bare)) return !isPrivateAddress(bare);
  if (BAD_HOSTS.test(bare)) return false;
  try {
    const addresses = await resolve(bare);
    return addresses.length > 0 && addresses.every((a) => !isPrivateAddress(a));
  } catch {
    return false;
  }
}
