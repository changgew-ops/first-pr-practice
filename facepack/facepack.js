/* KBL full facepack 2.0: async, lazy photos, fixed-ID generated fallback. */
(function(global){'use strict';const VERSION='2.0.0';const scriptBase=new URL('.',document.currentScript.src).href;
function hashId(id){let h=2166136261;for(const c of String(id)){h^=c.charCodeAt(0);h=Math.imul(h,16777619);}return h>>>0;}
function assignFace(id){if(id===undefined||id===null||String(id)==='')throw new Error('영구 선수 ID가 필요합니다.');return 'gen-'+String(hashId(id)%16+1).padStart(2,'0');}
async function create(options={}){
 const base=new URL(options.basePath||scriptBase,document.baseURI).href.replace(/\/?$/,'/'),data=options.data||global.KBL_FULL_DATA;
 if(!data)throw new Error('data.js를 먼저 로드하세요.');const {players,teams}=data,registry=new Map(players.map(p=>[p.id,p]));
 const images=new Map(),originals=new Map(),uniforms=new Map(),skinSamples=new Map(),bodyCache=new Map(),headCache=new Map(),pending=new Map(),failed=new Set(),chunks=new Map(),renderTokens=new WeakMap();
 const createCanvas=(w=470,h=609)=>Object.assign(document.createElement('canvas'),{width:w,height:h});
 const load=src=>new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(new Error('이미지 로딩 실패'));im.src=src;});
 const script=src=>new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=()=>{s.remove();resolve();};s.onerror=()=>{s.remove();reject(new Error('사진팩 파일을 찾지 못했습니다: '+src));};document.head.append(s);});
 const offline=location.protocol==='file:'||options.offline;
 if(offline&&!global.KBL_FULL_BOOT)await script(base+'offline/boot.js');
 await Promise.all(teams.map(async t=>{const im=await load(offline?global.KBL_FULL_BOOT[t.id]:base+'uniforms/'+t.id+'.webp');const c=createCanvas();c.getContext('2d').drawImage(im,0,0,470,609);uniforms.set(t.id,c);}));
 const atlas=await load(offline?global.KBL_FULL_BOOT.atlas:base+'generated/atlas.webp');const generated=[];
 for(let i=0;i<16;i++){const id='gen-'+String(i+1).padStart(2,'0'),c=createCanvas(),g=c.getContext('2d'),cell=atlas.width/4;g.drawImage(atlas,(i%4)*cell,Math.floor(i/4)*cell,cell,cell,117,0,236,236);const px=g.getImageData(0,0,470,609);for(let k=0;k<px.data.length;k+=4)if(px.data[k+3]<35)px.data[k+3]=0;g.putImageData(px,0,0);images.set(id,c);generated.push({id,cx:235,jaw:203,faceKey:id,kind:'generated'});}
 function resolve(input){const a=typeof input==='object'?input:{id:input},id=String(a.id??'');if(!id)throw new Error('영구 선수 ID가 필요합니다.');const real=registry.get(id);
  if(!a.isGenerated&&!a.faceKey&&real?.photo&&!failed.has(id))return {...real,cx:235,jaw:213,kind:'real',playerId:id};
  const key=a.faceKey||real?.fallbackFaceKey||assignFace(id),g=generated.find(p=>p.id===key);if(!g)throw new Error('지원하지 않는 faceKey: '+key);return {...g,name:a.name||real?.name||'가상 선수',playerId:id,kind:a.isGenerated?'generated':'fallback'};
 }
 async function ensurePhoto(id){if(originals.has(id))return;if(pending.has(id))return pending.get(id);const p=registry.get(id);if(!p?.photo||failed.has(id))return;
  const job=(async()=>{try{let src=base+'faces/'+id+'.webp';if(offline){if(!chunks.has(p.chunk))chunks.set(p.chunk,script(base+'offline/'+p.chunk+'.js'));await chunks.get(p.chunk);src=global.KBL_FULL_IMAGES[id];}let im=await load(src);if(p.rotation===90){const oriented=createCanvas(im.height,im.width),og=oriented.getContext('2d');og.translate(im.height,0);og.rotate(Math.PI/2);og.drawImage(im,0,0);im=oriented;}const c=createCanvas(),g=c.getContext('2d'),b=p.faceBox.map((v,i)=>v*(i%2===0?im.width:im.height)),scale=148/b[2];g.drawImage(im,235-(b[0]+b[2]/2)*scale,65-b[1]*scale,im.width*scale,im.height*scale);images.set(id,c);originals.set(id,im);
   if(originals.size>64){const oldest=originals.keys().next().value;originals.delete(oldest);images.delete(oldest);headCache.delete(oldest);skinSamples.delete(oldest+'head');}
  }catch(e){failed.add(id);}finally{pending.delete(id);}})();pending.set(id,job);return job;
 }
function sampleSkin(id,cx=235,body=false){
 const key=id+(body?'body':'head');if(skinSamples.has(key))return skinSamples.get(key);
 const c=createCanvas(),g=c.getContext('2d',{willReadFrequently:true});g.drawImage(id.startsWith('body:')?uniforms.get(id.slice(5)):images.get(id),0,0);
 const boxes=body?[[cx-15,228,30,20]]:[[cx-42,140,18,20],[cx+24,140,18,20]];let rgb=[0,0,0],n=0;
 for(const box of boxes){const pixels=g.getImageData(...box).data;for(let i=0;i<pixels.length;i+=4){if(pixels[i+3]>200){rgb[0]+=pixels[i];rgb[1]+=pixels[i+1];rgb[2]+=pixels[i+2];n++;}}}
 rgb=n?rgb.map(v=>v/n):[190,145,120];skinSamples.set(key,rgb);return rgb;
}
function makeBody(p,t,tone){
 const key=[p.id,t.id,tone].join('-');if(bodyCache.has(key))return bodyCache.get(key);
 const c=createCanvas(),g=c.getContext('2d',{willReadFrequently:true});g.drawImage(uniforms.get(t.id),0,0);
 const im=g.getImageData(0,0,470,609),d=im.data;
 const a=sampleSkin(p.id,p.cx),b=sampleSkin('body:'+t.id,t.cx,true),ratio=a.map((v,i)=>Math.max(.4,Math.min(1.18,v/b[i])));
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
  if(p.kind==='real'&&!p.transparent&&y<p.jaw){const ellipse=Math.pow((x-p.cx)/90,2)+Math.pow((y-121)/122,2);d[i+3]*=Math.max(0,Math.min(1,(1-ellipse)*10));}
  const edge=half-Math.abs(x-p.cx);if(edge<5)d[i+3]*=Math.max(0,edge/5);
 }
 g.putImageData(im,0,0);headCache.set(p.id,c);return c;
}
function composite(canvas,p,t,{tone=true,scale=1,offset=0,mode="portrait"}={}){
 const g=canvas.getContext('2d');g.clearRect(0,0,canvas.width,canvas.height);if(mode==='face'){const size=Math.min(canvas.width,canvas.height);g.drawImage(makeHead(p),110,0,250,250,(canvas.width-size)/2,(canvas.height-size)/2,size,size);return;}g.save();g.scale(canvas.width/470,canvas.height/609);
 g.drawImage(makeBody(p,t,tone),0,0);g.translate(t.cx,t.jaw+offset);g.rotate((p.angle||0)*Math.PI/180);g.scale(scale,scale);g.drawImage(makeHead(p),-p.cx,-p.jaw);g.restore();
}

 async function render(canvas,input,opts={}){const token={};renderTokens.set(canvas,token);let p=resolve(input);if(p.kind==='real'){await ensurePhoto(p.id);p=resolve(input);}if(renderTokens.get(canvas)!==token)return {cancelled:true};
  const teamId=opts.teamId||input.teamId||'db',t=teams.find(t=>t.id===teamId);if(!t)throw new Error('잘못된 teamId: '+teamId);
  if(opts.mode==='face'&&p.kind==='real'){const im=originals.get(p.id),g=canvas.getContext('2d'),b=p.faceBox.map((v,i)=>v*(i%2===0?im.width:im.height)),side=b[2]*1.55,size=Math.min(canvas.width,canvas.height);g.clearRect(0,0,canvas.width,canvas.height);g.drawImage(im,b[0]-.275*b[2],b[1]-.4*b[3],side,side,(canvas.width-size)/2,(canvas.height-size)/2,size,size);}else composite(canvas,p,t,opts);
  return {playerId:p.playerId,kind:p.kind,faceKey:p.faceKey||null,teamId,photoStatus:registry.get(p.playerId)?.status||'not_in_registry'};
 }
 async function drawOriginal(canvas,input){let p=resolve(input);if(p.kind!=='real')return render(canvas,input,{mode:'face'});await ensurePhoto(p.id);p=resolve(input);if(p.kind!=='real')return render(canvas,input,{mode:'face'});const im=originals.get(p.id),g=canvas.getContext('2d'),s=Math.min(canvas.width/im.width,canvas.height/im.height);g.clearRect(0,0,canvas.width,canvas.height);g.drawImage(im,(canvas.width-im.width*s)/2,(canvas.height-im.height*s)/2,im.width*s,im.height*s);return {kind:'real'};}
 return {version:VERSION,players,teams,resolve,assignFace,render,drawOriginal,dispose(){images.clear();originals.clear();uniforms.clear();headCache.clear();bodyCache.clear();skinSamples.clear();}};
}
global.KBLFacePack={version:VERSION,create,assignFace};})(window);
