import s from './job-description.module.css';

const BULLET = /^\s*([-•*▪●]|\d+[.)])\s+/;

/** Plain-text descriptions: blank lines split blocks; "-", "•" or "1." lines become lists; a short line before a list is its heading. */
export function Description({ text }: { text: string }) {
  const blocks = text.replace(/\r/g, '').split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const out: React.ReactNode[] = [];
  blocks.forEach((b, bi) => {
    const lines = b.split('\n').map((l) => l.trim()).filter(Boolean);
    let para: string[] = [];
    let list: string[] = [];
    const flushPara = (k: string) => { if (para.length) out.push(<p key={k}>{para.map((l, j) => <span key={j}>{l}{j < para.length - 1 && <br />}</span>)}</p>); para = []; };
    const flushList = (k: string) => { if (list.length) out.push(<ul key={k}>{list.map((l, j) => <li key={j}>{l}</li>)}</ul>); list = []; };
    lines.forEach((l, li) => {
      if (BULLET.test(l)) { flushPara(`p${bi}-${li}`); list.push(l.replace(BULLET, '')); return; }
      flushList(`u${bi}-${li}`);
      const nextIsList = BULLET.test(lines[li + 1] ?? '');
      if (nextIsList && l.length <= 60) { flushPara(`p${bi}-${li}`); out.push(<h3 key={`h${bi}-${li}`} className={s.sub}>{l.replace(/:$/, '')}</h3>); return; }
      para.push(l);
    });
    flushPara(`p${bi}-end`);
    flushList(`u${bi}-end`);
  });
  return <div className={s.desc}>{out}</div>;
}

