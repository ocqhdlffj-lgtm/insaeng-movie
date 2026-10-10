/* 검색·추천 엔진 — DOM에 의존하지 않는 순수 함수. 브라우저에서는 build.js가 index.html에 인라인하고, 테스트·평가는 Node에서 require한다.
 영화 객체: {t:제목, o:원제, y:연도, d:감독, r:분, g:장르[], k:키워드[], m:분위기[], v:후기태그[], p:OTT[]}
 옵션(기본값이 현재 권장 설정, tools/evaluate.js 로 조합을 비교):
  idf     판별력 가중 지수(0이면 끔). 흔한 태그는 감쇠, 희귀 태그는 강조
  popular true면 후기 태그 '입문추천'(대중성)을 유사도에서 빼고 선택 시 소폭 가점으로만 사용
  alpha   입력이 여러 편일 때 (최대 유사도 비중). 나머지는 평균 유사도
  reserve 입력이 여러 편일 때 각 입력 영화마다 보장하는 자리 수
  mmr     다양성 재순위 강도(0이면 끔). 이미 뽑힌 영화와 비슷할수록 감점
  dirPen  다양성 재순위에서 같은 감독이 이미 뽑혀 있을 때의 추가 감점
  gamma   영화 입력과 취향 선택(키워드·분위기·후기)을 섞을 때 취향 선택의 비중
  legacy  true면 v1(벡터 합산 코사인)과 동일하게 동작 — 비교 기준선용 */
function createEngine(DB, options = {}){
  const LEGACY={idf:0,popular:false,alpha:0,reserve:0,mmr:0,gamma:0,legacy:true};
  const O=options.legacy?{...LEGACY,...options}:{idf:.3,popular:true,alpha:.7,reserve:2,mmr:.2,dirPen:0,gamma:.5,legacy:false,...options};
  const W={keyword:1, genre:.45, mood:.6, review:.5, pickTag:1.6, pickMood:2.2, pickReview:1.6, sameDirector:.08, popBoost:.06};
  const POP="입문추천";

  const norm=s=>s.toLowerCase().replace(/[\s:·\-!?.,'’"“”()]/g,"");
  /* 받침 유무로 와/과 선택(한글이 아니면 와) */
  const wa=w=>{const c=w.charCodeAt(w.length-1)-0xAC00;return c>=0&&c<11172&&c%28!==0?"과":"와";};
  const byTitle=t=>DB.find(m=>m.t===t);

  function search(q){
    const n=norm(q); if(!n) return [];
    const exact=DB.filter(m=>norm(m.t)===n||norm(m.o)===n); if(exact.length) return exact;
    const starts=DB.filter(m=>norm(m.t).startsWith(n)||norm(m.o).startsWith(n)); if(starts.length) return starts;
    return DB.filter(m=>norm(m.t).includes(n)||norm(m.o).includes(n));
  }

  /* ---- 토큰 판별력(IDF) ---- */
  const skipPop=O.popular&&!O.legacy;
  const tokens=m=>[...m.k.map(x=>"k:"+x),...m.g.map(x=>"g:"+x),...m.m.map(x=>"m:"+x),...m.v.filter(x=>!(skipPop&&x===POP)).map(x=>"v:"+x)];
  const df={}; DB.forEach(m=>tokens(m).forEach(t=>df[t]=(df[t]||0)+1));
  const idfRaw=t=>Math.log((DB.length+1)/((df[t]||0)+1))+1;
  const allTok=Object.keys(df);
  const meanIdf=allTok.reduce((s,t)=>s+idfRaw(t),0)/(allTok.length||1);
  /* 평균이 1이 되도록 맞춘 뒤 지수로 완화, 0.6~1.8배로 제한(희귀 태그 과대평가 방지) */
  const idfF=t=>O.idf>0?Math.min(1.8,Math.max(.6,Math.pow(idfRaw(t)/meanIdf,O.idf))):1;

  const base={k:W.keyword,g:W.genre,m:W.mood,v:W.review};
  function vec(m){
    const v={};
    m.k.forEach(k=>v["k:"+k]=W.keyword*idfF("k:"+k));
    m.g.forEach(g=>v["g:"+g]=W.genre*idfF("g:"+g));
    m.m.forEach(x=>v["m:"+x]=W.mood*idfF("m:"+x));
    m.v.forEach(x=>{ if(skipPop&&x===POP) return; v["v:"+x]=W.review*idfF("v:"+x); });
    return v;
  }
  const len=v=>{let s=0;for(const k in v)s+=v[k]*v[k];return Math.sqrt(s)||1;};
  const cos=(a,b,la,lb)=>{let d=0;for(const k in b) if(a[k]) d+=a[k]*b[k];return d/((la||len(a))*(lb||len(b)));};
  const cache=new Map();
  const vecOf=m=>{let e=cache.get(m);if(!e){const v=vec(m);e={v,n:len(v)};cache.set(m,e);}return e;};

  /* 회피 조건: 공포·잔인·long·애니 + "rv-후기태그"(후기에서 자주 언급되는 불친절·불편함 등) */
  function excluded(c,avoid){
    for(const a of avoid){
      if(a==="공포"&&(c.g.includes("공포")||c.k.includes("괴물"))) return true;
      if(a==="잔인"&&c.k.includes("잔인")) return true;
      if(a==="long"&&c.r>150) return true;
      if(a==="애니"&&c.g.includes("애니")) return true;
      if(a.startsWith("rv-")&&c.v.includes(a.slice(3))) return true;
    }
    return false;
  }

  /* state: {movies:[제목], pickedTags:Set, mood:"", avoid:Set, reviewPrefs:Set} */
  function recommend(state){
    const {movies=[],pickedTags=new Set(),mood="",avoid=new Set(),reviewPrefs=new Set()}=state;
    const inputs=movies.map(byTitle).filter(Boolean);

    // 취향 선택(키워드·분위기·후기)만으로 만든 벡터
    const pref={};
    pickedTags.forEach(t=>pref["k:"+t]=(pref["k:"+t]||0)+W.pickTag*idfF("k:"+t));
    reviewPrefs.forEach(t=>{ if(skipPop&&t===POP) return; pref["v:"+t]=(pref["v:"+t]||0)+W.pickReview*idfF("v:"+t); });
    if(mood){ pref["m:"+mood]=(pref["m:"+mood]||0)+W.pickMood; if(mood==="반전") pref["k:반전"]=(pref["k:반전"]||0)+W.pickMood; }
    const hasPref=Object.keys(pref).length>0;

    // 설명용 전체 프로필 P(입력 영화 합 + 취향 선택): 취향 해설 문구와 추천 이유에 쓴다
    const P={};
    inputs.forEach(m=>{const v=vecOf(m).v;for(const k in v)P[k]=(P[k]||0)+v[k];});
    for(const k in pref) P[k]=(P[k]||0)+pref[k];

    const inTitles=new Set(inputs.map(m=>m.t));
    const dirs=new Set(inputs.map(m=>m.d));
    const out=[];
    DB.forEach(c=>{
      if(inTitles.has(c.t)||excluded(c,avoid)) return;
      const ce=vecOf(c);
      let score,sims=[];
      if(O.legacy){
        score=cos(P,ce.v,len(P),ce.n);
      }else{
        sims=inputs.map(m=>{const e=vecOf(m);return cos(e.v,ce.v,e.n,ce.n);});
        let sIn=null;
        if(sims.length===1) sIn=sims[0];
        else if(sims.length>1){const mx=Math.max(...sims),mean=sims.reduce((a,b)=>a+b,0)/sims.length;sIn=O.alpha*mx+(1-O.alpha)*mean;}
        const sPref=hasPref?cos(pref,ce.v,len(pref),ce.n):null;
        score=sIn!=null&&sPref!=null?(1-O.gamma)*sIn+O.gamma*sPref:(sIn!=null?sIn:(sPref||0));
        if(skipPop&&reviewPrefs.has(POP)&&c.v.includes(POP)) score+=W.popBoost;
      }
      if(dirs.has(c.d)) score+=W.sameDirector;
      out.push({c,score,sims,ce});
    });
    out.sort((a,b)=>b.score-a.score||a.c.t.localeCompare(b.c.t,"ko"));

    // 상위 12편 선정: (1) 입력마다 자리 보장 (2) 다양성 재순위(MMR)
    const N=12, picked=[], has=new Set();
    const take=x=>{picked.push(x);has.add(x.c.t);};
    if(!O.legacy&&O.reserve>0&&inputs.length>1){
      const each=Math.min(O.reserve,Math.floor(N/inputs.length));
      inputs.forEach((m,i)=>{
        out.filter(x=>!has.has(x.c.t)&&x.sims[i]>=.2).sort((a,b)=>b.sims[i]-a.sims[i]).slice(0,each).forEach(take);
      });
    }
    if(!O.legacy&&O.mmr>0){
      const pool=out.slice(0,80);
      while(picked.length<N){
        let best=null,bv=-Infinity;
        for(const x of pool){
          if(has.has(x.c.t)) continue;
          let mx=0;for(const p of picked){const s=cos(x.ce.v,p.ce.v,x.ce.n,p.ce.n);if(s>mx)mx=s;}
          const val=x.score-O.mmr*mx-(O.dirPen>0&&picked.some(p=>p.c.d===x.c.d)?O.dirPen:0);
          if(val>bv){bv=val;best=x;}
        }
        if(!best) break;
        take(best);
      }
    }else{
      for(const x of out){ if(picked.length>=N) break; if(!has.has(x.c.t)) take(x); }
    }
    const top=picked.sort((a,b)=>b.score-a.score||a.c.t.localeCompare(b.c.t,"ko"));
    const max=top[0]?top[0].score:1, min=top.length?top[top.length-1].score:0;
    top.forEach(x=>x.pct=Math.round(66+30*((x.score-min)/((max-min)||1))));
    top.forEach(x=>{
      const shared=x.c.k.filter(k=>(P["k:"+k]||0)>0).sort((a,b)=>P["k:"+b]-P["k:"+a]).slice(0,3);
      let best=null,bs=0;
      inputs.forEach(m=>{const s=m.k.filter(k=>x.c.k.includes(k)).length+(m.d===x.c.d?2:0);if(s>bs){bs=s;best=m;}});
      const parts=[];
      if(best&&bs>0){ const sh=best.k.filter(k=>x.c.k.includes(k)).slice(0,3); parts.push("「"+best.t+"」"+wa(best.t)+" "+(sh.length?sh.join("·")+" 키워드가 겹칩니다.":"결이 닮았습니다.")); if(best.d===x.c.d) parts.push("같은 감독("+best.d+")의 작품입니다."); }
      else if(shared.length) parts.push("고른 취향 키워드("+shared.join("·")+")와 맞습니다.");
      if(mood&&x.c.m.includes(mood)) parts.push("원하는 분위기("+mood+")에 해당합니다.");
      const rv=x.c.v.filter(t=>(P["v:"+t]||0)>0).sort((a,b)=>P["v:"+b]-P["v:"+a]).slice(0,2);
      if(rv.length) parts.push("후기에서 자주 언급되는 점: "+rv.join("·")+".");
      if(skipPop&&reviewPrefs.has(POP)&&x.c.v.includes(POP)) parts.push("누구에게나 입문작으로 추천받는 작품입니다.");
      x.why=parts.join(" ")||"전체 취향 흐름과 가까운 작품입니다.";
    });
    return {top,P,inputs};
  }
  return {search,recommend,byTitle,norm,options:O};
}
if(typeof module!=="undefined") module.exports={createEngine};
