/* 검색·추천 엔진 — DOM에 의존하지 않는 순수 함수. 브라우저에서는 build.js가 index.html에 인라인하고, 테스트는 Node에서 require한다.
 영화 객체: {t:제목, o:원제, y:연도, d:감독, r:분, g:장르[], k:키워드[], m:분위기[], v:후기태그[], p:OTT[]} */
function createEngine(DB){
  const W={keyword:1, genre:.45, mood:.6, review:.5, pickTag:1.6, pickMood:2.2, pickReview:1.6, sameDirector:.08};

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

  function vec(m){
    const v={};
    m.k.forEach(k=>v["k:"+k]=W.keyword);
    m.g.forEach(g=>v["g:"+g]=W.genre);
    m.m.forEach(x=>v["m:"+x]=W.mood);
    m.v.forEach(x=>v["v:"+x]=W.review);
    return v;
  }
  function len(v){let s=0;for(const k in v)s+=v[k]*v[k];return Math.sqrt(s)||1;}

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
    const P={};
    const add=(v,w)=>{for(const k in v)P[k]=(P[k]||0)+v[k]*w;};
    const inputs=movies.map(byTitle).filter(Boolean);
    inputs.forEach(m=>add(vec(m),1));
    pickedTags.forEach(t=>P["k:"+t]=(P["k:"+t]||0)+W.pickTag);
    reviewPrefs.forEach(t=>P["v:"+t]=(P["v:"+t]||0)+W.pickReview);
    if(mood){ P["m:"+mood]=(P["m:"+mood]||0)+W.pickMood; if(mood==="반전") P["k:반전"]=(P["k:반전"]||0)+W.pickMood; }
    const pn=len(P);
    const inTitles=new Set(inputs.map(m=>m.t));
    const dirs=new Set(inputs.map(m=>m.d));
    const out=[];
    DB.forEach(c=>{
      if(inTitles.has(c.t)||excluded(c,avoid)) return;
      const cv=vec(c); let dot=0; for(const k in cv) if(P[k]) dot+=P[k]*cv[k];
      let score=dot/(pn*len(cv));
      if(dirs.has(c.d)) score+=W.sameDirector;
      out.push({c,score});
    });
    out.sort((a,b)=>b.score-a.score||a.c.t.localeCompare(b.c.t,"ko"));
    const top=out.slice(0,12);
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
      x.why=parts.join(" ")||"전체 취향 흐름과 가까운 작품입니다.";
    });
    return {top,P,inputs};
  }
  return {search,recommend,byTitle,norm};
}
if(typeof module!=="undefined") module.exports={createEngine};
