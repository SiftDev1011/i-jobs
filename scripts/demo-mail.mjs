// For scripts/demo.sh: reads the engine's log lines and prints each email it would have sent
// (with any 6-digit code and the first link), plus errors. Everything else stays in the log files.
import { createInterface } from 'node:readline';

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const time = () => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

for await (const line of createInterface({ input: process.stdin })) {
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    continue; // tail's "==> file <==" headers and anything not JSON
  }
  const msg = String(entry.msg ?? '');
  const mail = msg.match(/^\[console mail\] to=(\S+) subject="([^"]*)"\n([\s\S]*)$/);
  if (mail) {
    const [, to, subject, body] = mail;
    const code = body.match(/\b(\d{6})\b/)?.[1];
    const link = body.match(/https?:\/\/\S+/)?.[0];
    console.log(`${time()}  ✉  ${bold(to)}  ${subject}${code ? `   code ${green(bold(code))}` : ''}${!code && link ? `\n          ${link}` : ''}`);
  } else if (Number(entry.level) >= 50) {
    console.log(`${time()}  ${red('⚠')}  ${red(msg.split('\n')[0].slice(0, 200))}`);
  }
}
