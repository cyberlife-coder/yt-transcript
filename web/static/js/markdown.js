// Rendu markdown minimal (entrée déjà échappée).
import { esc } from './dom.js';

export function md(src) {
  const lines = esc(src).split('\n'), o = [];
  let list = null, pre = false, para = [];
  const close = () => {
    if (list) { o.push(list === 'o' ? '</ol>' : '</ul>'); list = null; }
    if (para.length) { o.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; }
  };
  const inline = (t) => t
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|\W)\*([^*\n]+)\*/g, '$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  for (const l of lines) {
    const t = l.trim();
    let m;
    if (pre) {
      if (t.startsWith('```')) { o.push('</code></pre>'); pre = false; }
      else o.push(l + '\n');
      continue;
    }
    if (t.startsWith('```')) { close(); pre = true; o.push('<pre><code>'); continue; }
    if ((m = t.match(/^(#{1,6})\s+(.*)/))) {
      close();
      const n = Math.min(m[1].length + 2, 6);
      o.push('<h' + n + '>' + inline(m[2]) + '</h' + n + '>');
      continue;
    }
    if ((m = t.match(/^([-*+])\s+(.*)/))) {
      if (list !== 'u') { close(); o.push('<ul>'); list = 'u'; }
      o.push('<li>' + inline(m[2]) + '</li>');
      continue;
    }
    if ((m = t.match(/^\d+[.)]\s+(.*)/))) {
      if (list !== 'o') { close(); o.push('<ol>'); list = 'o'; }
      o.push('<li>' + inline(m[1]) + '</li>');
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(t)) { close(); o.push('<hr>'); continue; }
    if ((m = t.match(/^&gt;\s?(.*)/))) {
      close();
      o.push('<blockquote>' + inline(m[1]) + '</blockquote>');
      continue;
    }
    if (!t) { close(); continue; }
    para.push(t);
  }
  close();
  if (pre) o.push('</code></pre>');
  return o.join('');
}
