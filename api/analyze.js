
const SOFA = "https://www.sofascore.com/api/v1";
const TOURNAMENT_ID = 325;

async function fetchJSON(url) {
  const r = await fetch(url, {headers:{
    "user-agent":"Mozilla/5.0",
    "accept":"application/json,text/plain,*/*",
    "referer":"https://www.sofascore.com/"
  }});
  if (!r.ok) throw new Error(`Falha ${r.status}`);
  return r.json();
}
function poisson(l,k){let f=1;for(let i=2;i<=k;i++)f*=i;return Math.exp(-l)*Math.pow(l,k)/f}
function score(e,s){const o=e?.[s+"Score"]||{};for(const k of ["current","normaltime","display"])if(typeof o[k]==="number")return o[k];return null}
function wavg(v,d=.88){let n=0,z=0;v.forEach((x,i)=>{if(x==null)return;const w=Math.pow(d,i);n+=x*w;z+=w});return z?n/z:null}
async function season(){const d=await fetchJSON(`${SOFA}/unique-tournament/${TOURNAMENT_ID}/seasons`);return (d.seasons||[]).find(s=>String(s.name).includes("2026"))||(d.seasons||[])[0]}
async function events(sid,mode,pages=6){const all=[];for(let p=0;p<pages;p++){try{const d=await fetchJSON(`${SOFA}/unique-tournament/${TOURNAMENT_ID}/season/${sid}/events/${mode}/${p}`);const ev=d.events||[];if(!ev.length)break;all.push(...ev);if(!d.hasNextPage)break}catch(e){break}}return all}
function buildStats(es){
 const games=es.filter(e=>score(e,"home")!=null&&score(e,"away")!=null).sort((a,b)=>(b.startTimestamp||0)-(a.startTimestamp||0));
 const goals=[],teams={}; for(const e of games){const hg=score(e,"home"),ag=score(e,"away");goals.push(hg,ag);const h=e.homeTeam?.id,a=e.awayTeam?.id;if(!h||!a)continue;
 teams[h]??={name:e.homeTeam?.name,m:[]};teams[a]??={name:e.awayTeam?.name,m:[]};teams[h].m.push({gf:hg,ga:ag,home:1});teams[a].m.push({gf:ag,ga:hg,home:0})}
 const avg=goals.length?goals.reduce((a,b)=>a+b,0)/goals.length:1.25,stats={};
 for(const [id,t] of Object.entries(teams)){const m=t.m.slice(0,12),hm=m.filter(x=>x.home),am=m.filter(x=>!x.home),gf=wavg(m.map(x=>x.gf))??avg,ga=wavg(m.map(x=>x.ga))??avg;
 stats[id]={n:m.length,gf,ga,hgf:wavg(hm.map(x=>x.gf))??gf,hga:wavg(hm.map(x=>x.ga))??ga,agf:wavg(am.map(x=>x.gf))??gf,aga:wavg(am.map(x=>x.ga))??ga}}
 return {stats,avg}
}
function model(e,s,avg){const h=s[String(e.homeTeam?.id)],a=s[String(e.awayTeam?.id)];if(!h||!a)return null;
 const ha=(.65*h.hgf+.35*h.gf)/Math.max(avg,.3),hd=(.65*h.hga+.35*h.ga)/Math.max(avg,.3),aa=(.65*a.agf+.35*a.gf)/Math.max(avg,.3),ad=(.65*a.aga+.35*a.ga)/Math.max(avg,.3);
 const lh=Math.max(.2,Math.min(3.3,avg*ha*ad*1.10)),la=Math.max(.15,Math.min(3,avg*aa*hd*.92));
 let p1=0,px=0,p2=0,o25=0,btts=0,best=[0,0,0];
 for(let i=0;i<8;i++)for(let j=0;j<8;j++){const p=poisson(lh,i)*poisson(la,j);if(i>j)p1+=p;else if(i===j)px+=p;else p2+=p;if(i+j>=3)o25+=p;if(i>0&&j>0)btts+=p;if(p>best[2])best=[i,j,p]}
 const z=p1+px+p2;return {p1:p1/z,px:px/z,p2:p2/z,lh,la,o25,btts,score:`${best[0]}-${best[1]}`,samples:Math.min(h.n,a.n)}
}
function findOdds(obj,book="Fonte pública"){const out=[];if(Array.isArray(obj)){for(const v of obj)out.push(...findOdds(v,book))}
 else if(obj&&typeof obj==="object"){let lb=obj.bookmakerName||obj.providerName||obj.bookmaker||book;if(lb&&typeof lb==="object")lb=lb.name||book;
 if(Array.isArray(obj.choices)){const v={};for(const c of obj.choices){let n=String(c.name||c.choiceName||c.label||"").trim().toUpperCase(),x=Number(c.decimalValue??c.value??c.odds);n=n==="HOME"?"1":n==="DRAW"?"X":n==="AWAY"?"2":n;if(["1","X","2"].includes(n)&&x>1)v[n]=x}if(v["1"]&&v["X"]&&v["2"])out.push({book:String(lb),...v})}
 for(const v of Object.values(obj))out.push(...findOdds(v,lb))} return out}
async function getOdds(id){const urls=[`${SOFA}/event/${id}/odds/1/all`,`${SOFA}/event/${id}/odds/1`,`${SOFA}/event/${id}/odds/featured`];let f=[];for(const u of urls){try{f=findOdds(await fetchJSON(u));if(f.length)break}catch(e){}}
 const seen=new Set(),u=[];for(const x of f){const k=`${x.book}|${x["1"]}|${x["X"]}|${x["2"]}`;if(!seen.has(k)){seen.add(k);u.push(x)}}return u}
function devig(o1,ox,o2){const a=[1/o1,1/ox,1/o2],s=a.reduce((x,y)=>x+y,0);return a.map(x=>x/s)}

export default async function handler(req,res){
 try{
  const sea=await season(); if(!sea?.id)throw new Error("Temporada não encontrada");
  const past=await events(sea.id,"last",7), next=await events(sea.id,"next",3), now=Math.floor(Date.now()/1000);
  const upcoming=next.filter(e=>(e.startTimestamp||0)>=now-3600).slice(0,20), {stats,avg}=buildStats(past), rows=[],games=[];
  for(const e of upcoming){const m=model(e,stats,avg);if(!m)continue;const odds=await getOdds(e.id);let market=null;
   if(odds.length){const pp=odds.map(o=>devig(o["1"],o["X"],o["2"]));market=[0,1,2].map(i=>{const v=pp.map(x=>x[i]).sort((a,b)=>a-b);return v[Math.floor(v.length/2)]});const s=market.reduce((a,b)=>a+b,0);market=market.map(x=>x/s)}
   const sels=[["1",e.homeTeam?.name,m.p1,0],["X","Empate",m.px,1],["2",e.awayTeam?.name,m.p2,2]];
   for(const [key,label,pm,idx] of sels){let bo=null,bb=null;for(const o of odds){if(bo==null||o[key]>bo){bo=o[key];bb=o.book}}
    const mk=market?.[idx]??null,pf=mk!=null?.65*pm+.35*mk:pm,fair=1/pf,ev=bo!=null?pf*bo-1:null,conf=Math.max(45,Math.min(92,55+m.samples*2+(odds.length?10:0)));
    rows.push({game:`${e.homeTeam?.name} x ${e.awayTeam?.name}`,selection:label,modelProb:pm,marketProb:mk,finalProb:pf,fairOdd:fair,bestOdd:bo,bookmaker:bb,ev,confidence:conf,sources:odds.length,likelyScore:m.score})
   }
   games.push({game:`${e.homeTeam?.name} x ${e.awayTeam?.name}`,xg:`${m.lh.toFixed(2)} x ${m.la.toFixed(2)}`,p1:m.p1,px:m.px,p2:m.p2,over25:m.o25,btts:m.btts,score:m.score})
  }
  rows.sort((a,b)=>(b.ev??-999)-(a.ev??-999)||b.confidence-a.confidence);
  res.status(200).json({ok:true,leagueAvg:avg,opportunities:rows,games})
 }catch(e){res.status(500).json({ok:false,error:e.message})}
}
