import s from './job-description.module.css';

const BULLET = /^\s*([-•*▪●◦–—✓✔➤►]|\d+[.)])\s+/;
/** Common section names in job posts, so they become headings even without a list after them. */
const SECTION = /^(about (us|the (company|role|team|job|position|opportunity))|the (role|opportunity|team)|role (overview|summary|description)|job (summary|description|overview)|overview|summary|(key |main )?(responsibilities|duties)|what you(['’]ll| will) (do|be doing|bring|need)|your (role|responsibilities|impact|day)|day to day|(minimum |basic |preferred )?(requirements|qualifications)|what we(['’]re| are) looking for|who you are|you (have|are|bring)|skills( and experience)?|experience|nice to have|bonus( points)?|benefits|perks( and benefits)?|what we offer|why (join us|you['’]ll love .*)|compensation( and benefits)?|salary|how to apply|application process|location|working hours)\s*[:.!]?$/i;

function isHeading(line: string, nextIsList: boolean) {
  if (line.length > 60 || /[.;,]$/.test(line)) return false;
  if (nextIsList || line.endsWith(':') || SECTION.test(line)) return true;
  // SHORT ALL-CAPS LINES ("REQUIREMENTS", "WHAT WE OFFER").
  const letters = line.replace(/[^A-Za-z]/g, '');
  return letters.length >= 4 && letters === letters.toUpperCase();
}

const tidyHeading = (l: string) => {
  const t = l.replace(/[:]+$/, '').trim();
  return t === t.toUpperCase() ? t.charAt(0) + t.slice(1).toLowerCase() : t;
};

/** Plain-text descriptions into readable sections: headings, paragraphs and lists. */
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
      const alone = lines.length === 1 && blocks[bi + 1] !== undefined;
      if ((li < lines.length - 1 || alone) && isHeading(l, nextIsList)) {
        flushPara(`p${bi}-${li}`);
        out.push(<h3 key={`h${bi}-${li}`} className={s.sub}>{tidyHeading(l)}</h3>);
        return;
      }
      para.push(l);
    });
    flushPara(`p${bi}-end`);
    flushList(`u${bi}-end`);
  });
  return <div className={s.desc}>{out}</div>;
}
