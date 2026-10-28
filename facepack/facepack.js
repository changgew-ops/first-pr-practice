/* KBL facepack SDK v1.0. No external packages, network APIs or API keys. */
(function(global){'use strict';
const VERSION='1.0.0';
const scriptBase=new URL('.',document.currentScript.src).href;
function hashId(id){let h=2166136261;for(const c of String(id)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}
function assignFace(id){if(id===undefined||id===null||String(id)==='')throw new Error('고정 player.id가 필요합니다.');return 'gen-'+String(hashId(id)%16+1).padStart(2,'0');}
async function create(options={}){
 const base=new URL(options.basePath||scriptBase,document.baseURI).href.replace(/\/?$/,'/');
 const data=options.data||global.UNIFORM_DATA;if(!data)throw new Error('data.js를 먼저 로드하세요.');
 const {players,teams}=data;
 const images=new Map(),skinSamples=new Map(),bodyCache=new Map(),headCache=new Map();
 const createCanvas=(w=470,h=609)=>Object.assign(document.createElement('canvas'),{width:w,height:h});
 const load=src=>new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(new Error('사진 로딩 실패: '+src.slice(0,100)));im.src=src;});
 if((location.protocol==='file:'||options.offline)&&!global.FACEPACK)await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=base+'faces/pack.js';s.onload=resolve;s.onerror=()=>reject(new Error('faces/pack.js를 찾지 못했습니다.'));document.head.append(s);});
 const ids=[...new Set([...players.map(p=>p.id),...teams.map(t=>t.donor)])];
 await Promise.all(ids.map(async id=>{try{images.set(id,await load(global.FACEPACK?.[id]||base+'faces/'+id+'.webp'));}catch(e){if(teams.some(t=>t.donor===id))throw e;}}));
 const atlas=await load(global.FACEPACK?.generatedAtlas||base+'generated/atlas.webp');
 const generated=[];
 for(let i=0;i<16;i++){
  const id='gen-'+String(i+1).padStart(2,'0'),c=createCanvas(),g=c.getContext('2d');const cell=atlas.width/4;
  g.drawImage(atlas,(i%4)*cell,Math.floor(i/4)*cell,cell,cell,117,0,236,236);
  const px=g.getImageData(0,0,470,609);for(let k=0;k<px.data.length;k+=4)if(px.data[k+3]<35)px.data[k+3]=0;g.putImageData(px,0,0);
  images.set(id,c);generated.push({id,name:'생성선수 '+String(i+1).padStart(2,'0'),cx:235,jaw:203,kind:'generated',faceKey:id});
 }
 function resolve(input){
  const player=typeof input==='object'?input:{id:input};const id=String(player.id??'');if(!id)throw new Error('고정 player.id가 필요합니다.');
  const real=players.find(p=>p.id===id);
  if(!player.isGenerated&&!player.faceKey&&real&&images.has(id))return {...real,kind:'real',playerId:id};
  const key=player.faceKey||assignFace(id);const face=generated.find(p=>p.id===key);if(!face)throw new Error('지원하지 않는 faceKey: '+key);
  return {...face,name:player.name||real?.name||'사진 없음',kind:player.isGenerated?'generated':'fallback',playerId:id,faceKey:key};
 }
function sampleSkin(id,cx=235,body=false){
 const key=id+(body?'body':'head');if(skinSamples.has(key))return skinSamples.get(key);
 const c=createCanvas(),g=c.getContext('2d',{willReadFrequently:true});g.drawImage(images.get(id),0,0);
 const boxes=body?[[cx-15,228,30,20]]:[[cx-42,140,18,20],[cx+24,140,18,20]];let rgb=[0,0,0],n=0;
 for(const box of boxes){const pixels=g.getImageData(...box).data;for(let i=0;i<pixels.length;i+=4){if(pixels[i+3]>200){rgb[0]+=pixels[i];rgb[1]+=pixels[i+1];rgb[2]+=pixels[i+2];n++;}}}
 rgb=n?rgb.map(v=>v/n):[190,145,120];skinSamples.set(key,rgb);return rgb;
}
function makeBody(p,t,tone){
 const key=[p.id,t.id,tone].join('-');if(bodyCache.has(key))return bodyCache.get(key);
 const c=createCanvas(),g=c.getContext('2d',{willReadFrequently:true});g.drawImage(images.get(t.donor),0,0);
 const im=g.getImageData(0,0,470,609),d=im.data;
 const a=sampleSkin(p.id,p.cx),b=sampleSkin(t.donor,t.cx,true),ratio=a.map((v,i)=>Math.max(.4,Math.min(1.18,v/b[i])));
 for(let y=0;y<609;y++)for(let x=0;x<470;x++){
  const i=(y*470+x)*4;if(!d[i+3])continue;
  // Erase the donor's head; keep the actual neck, collar, jersey and arms.
  if(y<t.jaw-2){d[i+3]=0;continue;}
  if(y<t.jaw+9)d[i+3]*=(y-(t.jaw-2))/11;
  if(!tone)continue;
  const r=d[i],gr=d[i+1],bl=d[i+2],cb=128-.168736*r-.331264*gr+.5*bl,cr=128+.5*r-.418688*gr-.081312*bl;
  const region=(y<308&&x>155&&x<315)||(x<145||x>335)||(['lg','kcc','sono','gas'].includes(t.id)&&y>365&&y<520);
  const neutralArea=(x<130||x>345)||(['lg','kcc','sono','gas'].includes(t.id)&&y>395&&y<490)||(y<260&&x>190&&x<285);
  const lowCr=neutralArea?123:128;
  const skin=region&&r>gr-8&&r>bl-4&&r>65&&r-gr<95&&cb>73&&cb<145&&cr>lowCr&&cr<183;
  if(skin){const strength=Math.max(0,Math.min(1,(cr-lowCr)/5,(183-cr)/9,(145-cb)/9));for(let k=0;k<3;k++)d[i+k]=Math.min(255,d[i+k]*(1+(ratio[k]-1)*strength));}
 }
 g.putImageData(im,0,0);if(bodyCache.size>=32)bodyCache.delete(bodyCache.keys().next().value);bodyCache.set(key,c);return c;
}
function makeHead(p){
 if(headCache.has(p.id))return headCache.get(p.id);
 const c=createCanvas(),g=c.getContext('2d',{willReadFrequently:true});g.drawImage(images.get(p.id),0,0);
 const im=g.getImageData(0,0,470,609),d=im.data;
 for(let y=0;y<609;y++)for(let x=0;x<470;x++){
  const i=(y*470+x)*4;
  if(y>p.jaw+36){d[i+3]=0;continue;}
  const half=y>p.jaw-26?Math.max(43,76-(y-(p.jaw-26))*1.25):125;
  if(Math.abs(x-p.cx)>half){d[i+3]=0;continue;}
  if(y>p.jaw+8)d[i+3]*=Math.max(0,1-(y-p.jaw-8)/28);
  const edge=half-Math.abs(x-p.cx);if(edge<5)d[i+3]*=Math.max(0,edge/5);
 }
 g.putImageData(im,0,0);headCache.set(p.id,c);return c;
}
function composite(canvas,p,t,{tone=true,scale=1,offset=0,mode="portrait"}={}){
 const g=canvas.getContext('2d');g.clearRect(0,0,canvas.width,canvas.height);if(mode==='face'){const size=Math.min(canvas.width,canvas.height);g.drawImage(makeHead(p),110,0,250,250,(canvas.width-size)/2,(canvas.height-size)/2,size,size);return;}g.save();g.scale(canvas.width/470,canvas.height/609);
 g.drawImage(makeBody(p,t,tone),0,0);g.translate(t.cx,t.jaw+offset);g.rotate((p.angle||0)*Math.PI/180);g.scale(scale,scale);g.drawImage(makeHead(p),-p.cx,-p.jaw);g.restore();
}

 function render(canvas,player,options={}){
  const p=resolve(player),teamId=options.teamId||player.teamId||'db',t=teams.find(t=>t.id===teamId);if(!t)throw new Error('알 수 없는 teamId: '+teamId);
  composite(canvas,p,t,options);return {playerId:p.playerId,kind:p.kind,faceKey:p.faceKey||null,teamId:t.id};
 }
 function drawOriginal(canvas,player){const p=resolve(player),g=canvas.getContext('2d');g.clearRect(0,0,canvas.width,canvas.height);g.drawImage(images.get(p.id),0,0,canvas.width,canvas.height);return p;}
 return {version:VERSION,render,resolve,assignFace,drawOriginal,players,teams,generated,dispose(){images.clear();skinSamples.clear();bodyCache.clear();headCache.clear();}};
}
global.KBLFacePack={version:VERSION,create,assignFace};
})(window);
