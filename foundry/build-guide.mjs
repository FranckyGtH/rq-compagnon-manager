import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const out=resolve(dirname(fileURLToPath(import.meta.url)),'../outputs');
const md=readFileSync(resolve(out,'RQ_Compagnon_Manager_Guide_v0.17.3.md'),'utf8').replace(/^\uFEFF/,'');
const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const inline=value=>escape(value).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/https:\/\/[^\s<]+/g,url=>`<a href="${url}">${url}</a>`);
const lines=md.split(/\r?\n/),blocks=[],nav=[];
for(let i=0;i<lines.length;i++) {
  const line=lines[i];if(!line.trim())continue;
  const heading=line.match(/^(#{1,3}) (.+)$/);
  if(heading){const level=heading[1].length,id=`section-${i}`;blocks.push(`<h${level} id="${id}">${inline(heading[2])}</h${level}>`);if(level===2&&/^\d+ /.test(heading[2]))nav.push(`<li><a href="#${id}">${inline(heading[2])}</a></li>`);continue;}
  if(line.startsWith('|')) {
    const rows=[];while(i<lines.length&&lines[i].startsWith('|')){const cells=lines[i].split('|').slice(1,-1).map(v=>v.trim());if(!cells.every(v=>/^:?-+:?$/.test(v)))rows.push(cells);i++;}i--;
    blocks.push('<div class="table-wrap"><table><thead><tr>'+rows[0].map(v=>`<th>${inline(v)}</th>`).join('')+'</tr></thead><tbody>'+rows.slice(1).map(row=>'<tr>'+row.map(v=>`<td>${inline(v)}</td>`).join('')+'</tr>').join('')+'</tbody></table></div>');continue;
  }
  if(/^(?:- |\d+\. )/.test(line)) {
    const ordered=/^\d/.test(line),rows=[];while(i<lines.length&&(ordered?/^\d+\. /:/^- /).test(lines[i])){rows.push('<li>'+inline(lines[i].replace(/^(?:- |\d+\. )/,''))+'</li>');i++;}i--;
    const tag=ordered?'ol':'ul';blocks.push(`<${tag}>${rows.join('')}</${tag}>`);continue;
  }
  blocks.push('<p>'+inline(line)+'</p>');
}
const html=`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>RQ compagnon Manager — Installation et utilisation 0.17.3</title><style>
*{box-sizing:border-box}body{margin:0;background:#edf0f2;color:#18232a;font:17px/1.6 system-ui,sans-serif}main{max-width:980px;margin:32px auto;padding:48px 64px;background:white;box-shadow:0 3px 24px #172d3e15}h1{font-size:40px;line-height:1.15;margin:0 0 12px}h2{font-size:26px;line-height:1.3;margin-top:44px;color:#173f50}h3{font-size:20px;line-height:1.35;margin-top:28px}p{margin:14px 0}li{margin:8px 0}a{color:#125d7b;overflow-wrap:anywhere}nav{padding:18px 24px;background:#f0f6f8;border-radius:8px;margin:24px 0}nav ul{columns:2;padding-left:20px;margin:0}table{width:100%;border-collapse:collapse;font-size:15px;line-height:1.45}th,td{text-align:left;vertical-align:top;padding:12px;border:1px solid #d3dee3}th{background:#eaf2f5}tr{break-inside:avoid}.table-wrap{overflow-x:auto;margin:20px 0}.toolbar{max-width:980px;margin:20px auto 0;text-align:right;padding:0 24px}.toolbar button{font:inherit;background:#173f50;color:white;border:0;border-radius:6px;padding:10px 18px;cursor:pointer}@media(max-width:700px){main{margin:0;padding:28px 20px}nav ul{columns:1}h1{font-size:32px}body{font-size:16px}}@page{size:A4;margin:18mm}@media print{body{background:white;font-size:10.5pt;line-height:1.45}main{max-width:none;margin:0;padding:0;box-shadow:none}.toolbar{display:none}h1{font-size:25pt}h2{font-size:17pt;break-after:avoid}h3{font-size:13pt;break-after:avoid}nav{break-inside:avoid}table{font-size:9pt}.table-wrap{overflow:visible}thead{display:table-header-group}li{margin:4px 0}a{color:inherit}p{orphans:3;widows:3}}
</style></head><body><div class="toolbar"><button onclick="window.print()">Imprimer ou enregistrer en PDF</button></div><main>${blocks.slice(0,4).join('\n')}<nav aria-label="Sommaire"><strong>Sommaire</strong><ul>${nav.join('')}</ul></nav>${blocks.slice(4).join('\n')}</main></body></html>`;
writeFileSync(resolve(out,'RQ_Compagnon_Manager_Guide_v0.17.3.html'),html);console.log('Guide HTML built.');
