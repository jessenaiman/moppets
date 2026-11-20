// Static arrangements of one performance. Change the URL hash to compare A, B and C.
const variant = ['A','B','C'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'A';
document.body.dataset.layout = variant;
const cast = [['Neon','Take Two','#69dde5'],['Cue','Line?','#ffd487'],['Clank','The Late Answer','#8ba8d7'],['Watt','Every Socket','#ef8275'],['Gruff','Close-Up','#eca367'],['Tabby','Ribbon and Felt','#60cfae'],['Chip','One More Thing','#d2bb68'],['Zap','Every Button','#9bcc77']];
const solos = [...cast,[cast[5][0],'One Tape',cast[5][2]]];
document.querySelector('.choices').innerHTML=solos.map(([name,title,color])=>
  `<div class="tile ${name==='Cue'?'current':''}" style="--accent:${color}"><img src="../../../public/rehearsal/img/${name.toLowerCase()}-rest.webp" alt=""><div><b>${name}</b><small>${title}</small></div></div>`).join('');
const encoders=['Volume','Larynx','Nasal','Tension','Brightness','Gravel','Breath','Rasp'];
document.querySelector('.encoders').innerHTML=encoders.map((n,i)=>`<div><i style="--angle:${[50,-32,15,-18,42,-55,20,-40][i]}deg"></i><small>${n}</small></div>`).join('');
document.querySelector('.pads').innerHTML=[...cast.map(c=>c[0]),'Nod','Tilt','Laugh','Shrug','Gasp','Bow','Cheer','Double nod'].map((n,i)=>`<b class="${i===1?'selected':''}" style="--accent:${cast[i%8][2]}">${n}</b>`).join('');
const keys=document.querySelector('.keys');
for(let n=0,white=0;n<25;n++){
  const isBlack=[1,3,6,8,10].includes(n%12),key=document.createElement('i');
  key.className=isBlack?'black':'white';key.style.left=isBlack?`calc(${white*100/15}% - 2.1%)`:`${white*100/15}%`;
  if(!isBlack)white++;
  if(n%12===0)key.textContent='C'+(3+Math.floor(n/12));
  keys.append(key);
}
const bars=Math.ceil(score.beats/4), w=1152,h=83;
const x=b=>b/score.beats*w;
let roll='<svg role="img" aria-label="Full part, from first to last bar" viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none">';
for(let i=0;i<bars;i++)roll+=`<path stroke="#38504f" stroke-width=".8" d="M${x(i*4)} 0v83"/><text x="${x(i*4)+5}" y="11">${i+1}</text>`;
const midis=score.notes.map(n=>n[2]),lo=Math.min(...midis),hi=Math.max(...midis);
for(const [beat,dur,midi] of score.notes)roll+=`<rect x="${x(beat)}" y="${20+(hi-midi)*55/(hi-lo)}" width="${Math.max(2,x(dur)-1)}" height="4" rx="1.2" fill="#69c8af"/>`;
roll+=`<path stroke="#ffcf7e" stroke-width="2" d="M${x(9.1)} 0v83"/></svg>`;
document.querySelector('.roll').innerHTML=roll;
