const { useState, useMemo, useEffect, useRef } = React;

const SUPABASE_URL = 'https://biafijftxhealzmmwsmk.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJpYWZpamZ0eGhlYWx6bW13c21rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyNTQ3NjYsImV4cCI6MjA5NTgzMDc2Nn0.el4_ujwNYvbYdFtvzAEooKd1SvZlJd5YGVdlGlSo6Q8';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const CUISINES = ["American","Brazilian","Caribbean","Chinese","Ethiopian","Filipino","French","Greek","Hawaiian","Indian","Indonesian","Italian","Japanese","Korean","Lebanese","Malaysian","Mediterranean","Mexican","Middle Eastern","Moroccan","Peruvian","Spanish","Taiwanese","Thai","Turkish","Vietnamese","Other"];

// Design tokens
const C = {
  bg:       '#f4ece0',
  surface:  '#fdfaf6',
  hi:       '#ffffff',
  bd:       'rgba(20,10,0,0.07)',
  bdMid:    'rgba(20,10,0,0.13)',
  text:     '#1a0d02',
  mid:      '#7a6050',
  dim:      '#a8907a',
  amber:    '#c07030',
  amberBg:  'rgba(192,112,48,0.09)',
  amberBd:  'rgba(192,112,48,0.18)',
  sage:     '#4a7a5a',
  sageBg:   'rgba(74,122,90,0.09)',
  sageBd:   'rgba(74,122,90,0.18)',
  espr:     '#2c1a0e',
  red:      '#8a3838',
  redBg:    'rgba(138,56,56,0.07)',
  redBd:    'rgba(138,56,56,0.18)',
  ui:       "'Inter',system-ui,sans-serif",
  display:  "'DM Serif Display',serif",
};

function dbToApp(r) {
  return {
    id: r.id, name: r.name, cuisine: r.cuisine||'Other',
    location: r.location||'', recommender: r.recommended_by||'',
    note: r.notes||'', status: r.visited?'visited':'want',
    rating: r.rating||null, date: (r.created_at||'').split('T')[0],
    phone: r.phone||'', website: r.website||'', menuUrl: r.menu_url||'',
    priceRange: r.price_range||'', hours: r.hours||[],
    photos: r.photos||[], reviews: r.reviews||[],
    lat: r.lat||null, lng: r.lng||null, googleMapsUrl: r.google_maps_url||'',
  };
}

function appToDb(f) {
  return {
    name: f.name, cuisine: f.cuisine, location: f.location||null,
    recommended_by: f.recommender, notes: f.note||null,
    visited: f.status==='visited',
    rating: f.status==='visited'?(f.rating||null):null,
    phone: f.phone||null, website: f.website||null,
    menu_url: f.menuUrl||null, price_range: f.priceRange||null,
    hours: f.hours?.length?f.hours:null,
    photos: f.photos?.length?f.photos:null,
    reviews: f.reviews?.length?f.reviews:null,
    lat: f.lat||null, lng: f.lng||null,
    google_maps_url: f.googleMapsUrl||null,
  };
}

function parseGoogleMapsUrl(url) {
  const out = { name:'', lat:null, lng:null };
  try {
    const nm = url.match(/\/place\/([^/@?&#]+)/);
    if (nm) out.name = decodeURIComponent(nm[1].replace(/\+/g,' ').replace(/_/g,' '));
    const cm = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (cm) { out.lat=parseFloat(cm[1]); out.lng=parseFloat(cm[2]); }
    if (!out.lat) {
      const dm = url.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
      if (dm) { out.lat=parseFloat(dm[1]); out.lng=parseFloat(dm[2]); }
    }
    if (!out.lat) {
      const qm = url.match(/[?&]q=([^&]+)/);
      if (qm) { const p=qm[1].split(','); if(p.length===2&&!isNaN(p[0])){ out.lat=parseFloat(p[0]); out.lng=parseFloat(p[1]); } }
    }
  } catch(e){}
  return out;
}

function parseGoogleMapsHtml(html) {
  const name =
    html.match(/<title>([^<|]+?) ?[-–|] ?Google Maps<\/title>/i)?.[1]?.trim() ||
    html.match(/property="og:title"[^>]+content="([^"]+)"/i)?.[1]?.trim() ||
    html.match(/content="([^"]+)"[^>]+property="og:title"/i)?.[1]?.trim() ||
    html.match(/"name"\s*:\s*"([^"]{2,80})"/)?.[1]?.trim() ||
    html.match(/["']placeName["']\s*:\s*["']([^"']{2,80})["']/)?.[1]?.trim() || '';
  const latM = html.match(/"latitude"\s*:\s*(-?\d+\.\d+)/) || html.match(/itemprop="latitude"[^>]+content="(-?\d+\.\d+)"/i);
  const lngM = html.match(/"longitude"\s*:\s*(-?\d+\.\d+)/) || html.match(/itemprop="longitude"[^>]+content="(-?\d+\.\d+)"/i);
  return { name, lat: latM?parseFloat(latM[1]):null, lng: lngM?parseFloat(lngM[1]):null };
}

function extractMapsUrlFromFdl(html) {
  const patterns = [
    /href="(https:\/\/(?:www\.)?google\.com\/maps\/place\/[^"]+)"/,
    /content="(https:\/\/(?:www\.)?google\.com\/maps\/place\/[^"]+)"/,
    /content="(https:\/\/maps\.(?:app\.)?goo\.gl\/[^"]+)"/,
    /"(https:\/\/(?:www\.)?google\.com\/maps\/place\/[^"]{20,})"/,
    /href="(https:\/\/maps\.google\.com\/maps\/place\/[^"]+)"/,
    /destinationUrl["'\s]*:["'\s]*(https:\/\/[^"'\s,]+google\.com\/maps\/place\/[^"'\s,]+)/,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) return m[1];
  }
  return null;
}

async function nominatimReverse(lat, lng) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
      { headers:{'Accept-Language':'en'} });
    const d = await r.json();
    const a = d.address||{};
    return [a.road, a.neighbourhood||a.suburb, a.city||a.town||a.village, a.country]
      .filter(Boolean).slice(0,3).join(', ');
  } catch(e){ return ''; }
}

// ── SVG icons ────────────────────────────────────────────────
const Ic = ({n, size=18}) => {
  const p = {
    phone:  <path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 014 6a2 2 0 012-2z"/>,
    nav:    <><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5,12 12,5 19,12"/></>,
    globe:  <><circle cx="12" cy="12" r="9"/><path d="M3.6 9h16.8M3.6 15h16.8M12 3a14 14 0 000 18M12 3a14 14 0 010 18"/></>,
    list:   <><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="4" cy="18" r="1" fill="currentColor" stroke="none"/></>,
    share:  <><circle cx="18" cy="5" r="2"/><circle cx="6" cy="12" r="2"/><circle cx="18" cy="19" r="2"/><line x1="8.59" y1="10.51" x2="15.42" y2="6.49"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.51"/></>,
    pin:    <><path d="M12 2a7 7 0 017 7c0 5-7 13-7 13S5 14 5 9a7 7 0 017-7z"/><circle cx="12" cy="9" r="2.5"/></>,
    clock:  <><circle cx="12" cy="12" r="9"/><polyline points="12,7 12,12 15,14"/></>,
    chat:   <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>,
    person: <><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></>,
    star:   <polygon points="12,2 15.1,8.3 22,9.3 17,14.1 18.2,21 12,17.8 5.8,21 7,14.1 2,9.3 8.9,8.3"/>,
    edit:   <><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></>,
    trash:  <><polyline points="3,6 5,6 21,6"/><path d="M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2"/></>,
    close:  <><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>,
    aim:    <><circle cx="12" cy="12" r="8"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/></>,
    refresh:<><polyline points="23,4 23,10 17,10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></>,
    search: <><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{p[n]}</svg>;
};

// ── StarRating ───────────────────────────────────────────────
const StarRating = ({ value, onChange, readonly, size=16 }) => (
  <div style={{display:'flex',gap:'1px'}}>
    {[1,2,3,4,5].map(n=>(
      <span key={n} onClick={()=>!readonly&&onChange&&onChange(n)} style={{
        fontSize:`${size}px`, cursor:readonly?'default':'pointer',
        color:n<=(value||0)?C.amber:'rgba(168,144,122,0.3)',
        transition:'color 0.15s', userSelect:'none',
      }}>★</span>
    ))}
  </div>
);

// ── Map view ─────────────────────────────────────────────────
const MapView = ({ spots, onMarkerClick }) => {
  const el           = useRef(null);
  const map          = useRef(null);
  const marks        = useRef({});
  const locateMarker = useRef(null);
  const [selected, setSelected] = useState(null);

  useEffect(()=>{
    if (map.current) return;
    map.current = L.map(el.current,{ center:[49.2827,-123.1207], zoom:13, zoomControl:false });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',{
      attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/">CARTO</a>',
      maxZoom:19, subdomains:'abcd',
    }).addTo(map.current);
    L.control.zoom({ position:'topleft' }).addTo(map.current);
    return ()=>{ map.current?.remove(); map.current=null; };
  },[]);

  useEffect(()=>{
    if (!map.current) return;
    Object.values(marks.current).forEach(m=>m.remove());
    marks.current={};
    const bounds=[];
    spots.forEach(r=>{
      if (!r.lat||!r.lng) return;
      const visited = r.status==='visited';
      const bg = visited ? C.sage : C.amber;
      const icon = L.divIcon({
        html:`<div style="width:30px;height:30px;background:${bg};border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2.5px solid #fff;box-shadow:0 3px 12px rgba(0,0,0,0.25);display:flex;align-items:center;justify-content:center"><span style="transform:rotate(45deg);color:#fff;font-size:12px;font-weight:700;line-height:1">${visited?'✓':'+'}</span></div>`,
        iconSize:[30,42], iconAnchor:[15,42], className:'',
      });
      const mk = L.marker([r.lat,r.lng],{icon}).addTo(map.current);
      mk.on('click',()=>{
        setSelected(r);
        map.current.panTo([r.lat,r.lng],{animate:true,duration:0.4});
      });
      marks.current[r.id]=mk;
      bounds.push([r.lat,r.lng]);
    });
    if (bounds.length) map.current.fitBounds(bounds,{padding:[60,60],maxZoom:14});
  },[spots]);

  const unmapped = spots.filter(r=>!r.lat||!r.lng);

  function locate() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(pos=>{
      const {latitude:lat,longitude:lng}=pos.coords;
      map.current.setView([lat,lng],15,{animate:true});
      if (locateMarker.current) locateMarker.current.remove();
      locateMarker.current=L.circleMarker([lat,lng],{radius:8,fillColor:'#4a90d9',color:'#fff',weight:2.5,opacity:1,fillOpacity:1}).addTo(map.current).bindPopup('You are here');
    },()=>{});
  }

  function directions(r) {
    const q=r.lat&&r.lng?`${r.lat},${r.lng}`:encodeURIComponent([r.name,r.location].filter(Boolean).join(' '));
    window.open(`https://maps.google.com/maps?daddr=${q}`,'_blank');
  }

  return (
    <div style={{flex:1,position:'relative'}}>
      <div ref={el} style={{width:'100%',height:'calc(100vh - 110px)'}}/>

      {/* Locate Me — top left, below zoom controls */}
      <button onClick={locate} style={{position:'absolute',top:90,left:10,zIndex:1000,background:'rgba(253,250,246,0.97)',backdropFilter:'blur(12px)',WebkitBackdropFilter:'blur(12px)',border:`1px solid ${C.bd}`,borderRadius:10,padding:'8px 13px',fontFamily:C.ui,fontSize:12,fontWeight:500,color:C.text,cursor:'pointer',boxShadow:'0 2px 10px rgba(0,0,0,0.1)',display:'flex',alignItems:'center',gap:6}}>
        <Ic n="aim" size={13}/>Locate Me
      </button>

      {/* Legend — top right */}
      <div style={{position:'absolute',top:12,right:12,zIndex:1000,display:'flex',flexDirection:'column',gap:5}}>
        {[{color:C.amber,label:'To visit'},{color:C.sage,label:'Visited'}].map(({color,label})=>(
          <div key={label} style={{display:'flex',alignItems:'center',gap:7,background:'rgba(253,250,246,0.97)',backdropFilter:'blur(10px)',WebkitBackdropFilter:'blur(10px)',borderRadius:20,padding:'5px 11px',border:`1px solid ${C.bd}`,boxShadow:'0 1px 6px rgba(0,0,0,0.08)'}}>
            <div style={{width:8,height:8,background:color,borderRadius:'50%'}}/>
            <span style={{fontFamily:C.ui,fontSize:11,fontWeight:500,color:C.mid}}>{label}</span>
          </div>
        ))}
        {unmapped.length>0&&(
          <div style={{background:'rgba(253,250,246,0.97)',borderRadius:20,padding:'5px 11px',border:`1px solid ${C.bd}`}}>
            <span style={{fontFamily:C.ui,fontSize:10,color:C.dim}}>{unmapped.length} without pin</span>
          </div>
        )}
      </div>

      {/* Bottom mini-card */}
      {selected&&(
        <div style={{position:'absolute',bottom:20,left:12,right:12,zIndex:1000,background:'rgba(253,250,246,0.98)',backdropFilter:'blur(24px)',WebkitBackdropFilter:'blur(24px)',borderRadius:20,padding:'18px 18px 16px',boxShadow:'0 8px 36px rgba(0,0,0,0.16)',border:`1px solid ${C.bd}`,animation:'slideUp 0.22s cubic-bezier(0.34,1.2,0.64,1)'}}>
          {/* Close */}
          <button onClick={()=>setSelected(null)} style={{position:'absolute',top:14,right:14,background:'transparent',border:`1px solid ${C.bd}`,borderRadius:'50%',width:26,height:26,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',color:C.dim}}>
            <Ic n="close" size={11}/>
          </button>

          {/* Info */}
          <h3 style={{fontFamily:C.display,fontSize:20,color:C.text,margin:'0 0 6px',paddingRight:32,lineHeight:1.2}}>{selected.name}</h3>
          <div style={{display:'flex',gap:6,alignItems:'center',marginBottom:selected.location?4:0,flexWrap:'wrap'}}>
            <span style={{fontFamily:C.ui,fontSize:11,fontWeight:500,color:selected.status==='visited'?C.sage:C.amber,background:selected.status==='visited'?C.sageBg:C.amberBg,borderRadius:20,padding:'2px 9px'}}>{selected.status==='visited'?'Visited':'To Visit'}</span>
            <span style={{fontFamily:C.ui,fontSize:11,color:C.dim}}>·</span>
            <span style={{fontFamily:C.ui,fontSize:11,color:C.mid}}>{selected.cuisine}</span>
            {selected.priceRange&&<><span style={{fontFamily:C.ui,fontSize:11,color:C.dim}}>·</span><span style={{fontFamily:C.ui,fontSize:11,color:C.mid}}>{selected.priceRange}</span></>}
          </div>
          {selected.location&&<p style={{fontFamily:C.ui,fontSize:12,color:C.dim,margin:'0 0 14px',lineHeight:1.4}}>{selected.location}</p>}

          {/* Actions */}
          <div style={{display:'flex',gap:8,marginTop:12}}>
            <button onClick={()=>directions(selected)} style={{flex:1,padding:'10px 0',borderRadius:11,background:C.amberBg,border:`1px solid ${C.amberBd}`,color:C.amber,fontFamily:C.ui,fontSize:13,fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:6}}>
              <Ic n="nav" size={14}/>Directions
            </button>
            <button onClick={()=>{onMarkerClick(selected);setSelected(null);}} style={{flex:2,padding:'10px 0',borderRadius:11,background:C.espr,border:'none',color:'#fdf8f3',fontFamily:C.ui,fontSize:13,fontWeight:600,cursor:'pointer'}}>
              View Details →
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ── Import modal ─────────────────────────────────────────────
const ImportModal = ({ onClose, onImport }) => {
  const [url,  setUrl]  = useState('');
  const [step, setStep] = useState('paste');
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k,v) => setForm(f=>({...f,[k]:v}));

  async function handleParse() {
    const rawUrl = url.trim();
    if (!rawUrl) return;
    const isMapsGoo = rawUrl.includes('maps.app.goo.gl') || rawUrl.includes('goo.gl/maps');
    const isShort = rawUrl.includes('share.google') || isMapsGoo;
    setBusy(true);
    let resolved = rawUrl;
    let htmlData = { name:'', lat:null, lng:null };
    if (isShort) {
      const race = p => Promise.race([p, new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),8000))]);
      if (!htmlData.name) {
        const debugUrl = rawUrl.split('?')[0] + '?d=1';
        try {
          const resp = await race(fetch(debugUrl));
          const html = await resp.text();
          const mapsUrl = extractMapsUrlFromFdl(html);
          if (mapsUrl) resolved = mapsUrl;
          htmlData = parseGoogleMapsHtml(html);
        } catch(e0) {}
        if (!htmlData.name) {
          try {
            const d = await race(fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(debugUrl)}`).then(r=>r.json()));
            if (d.contents) {
              const mapsUrl = extractMapsUrlFromFdl(d.contents);
              if (mapsUrl) resolved = mapsUrl;
              htmlData = parseGoogleMapsHtml(d.contents);
            }
          } catch(e1) {
            try {
              const html = await race(fetch(`https://corsproxy.io/?${encodeURIComponent(debugUrl)}`).then(r=>r.text()));
              const mapsUrl = extractMapsUrlFromFdl(html);
              if (mapsUrl) resolved = mapsUrl;
              if (!htmlData.name) htmlData = parseGoogleMapsHtml(html);
            } catch(e2) {}
          }
        }
      }
      if (!htmlData.name && resolved === rawUrl) {
        try {
          const resp = await race(fetch(rawUrl));
          if (resp.url && resp.url !== rawUrl) resolved = resp.url;
          try { htmlData = parseGoogleMapsHtml(await resp.text()); } catch(e) {}
        } catch(e) {}
      }
      if (!htmlData.name && resolved === rawUrl) {
        try {
          const d = await race(fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(rawUrl)}`).then(r=>r.json()));
          if (d.status?.url && d.status.url !== rawUrl) resolved = d.status.url;
          if (d.contents) htmlData = parseGoogleMapsHtml(d.contents);
        } catch(e1) {
          try {
            const html = await race(fetch(`https://corsproxy.io/?${encodeURIComponent(rawUrl)}`).then(r=>r.text()));
            htmlData = parseGoogleMapsHtml(html);
            const m = html.match(/"(https?:\/\/(?:www\.)?google\.com\/maps\/[^"]{20,})"/);
            if (m) resolved = m[1].replace(/\\u003d/g,'=').replace(/\\u0026/g,'&');
          } catch(e2) {}
        }
      }
    }
    const urlData = parseGoogleMapsUrl(resolved);
    const parsed = {
      name: urlData.name || htmlData.name,
      lat:  urlData.lat  ?? htmlData.lat,
      lng:  urlData.lng  ?? htmlData.lng,
    };
    let location = '';
    if (parsed.lat && parsed.lng) location = await nominatimReverse(parsed.lat, parsed.lng);
    const base = {
      name:parsed.name||'', cuisine:'Other', location,
      recommender:'', note:'', status:'want', rating:null, priceRange:'',
      phone:'', website:'', menuUrl:'', hours:[], photos:[], reviews:[],
      lat:parsed.lat, lng:parsed.lng, googleMapsUrl:rawUrl,
    };
    if (isShort && parsed.name) { onImport(base); }
    else { setForm(base); setStep('preview'); }
    setBusy(false);
  }

  const inp = {width:'100%',padding:'10px 14px',background:C.hi,border:`1px solid ${C.bdMid}`,borderRadius:10,fontFamily:C.ui,fontSize:14,color:C.text,outline:'none',boxSizing:'border-box'};
  const lbl = {display:'block',fontFamily:C.ui,fontSize:11,fontWeight:600,letterSpacing:'0.05em',color:C.dim,marginBottom:5,textTransform:'uppercase'};
  const canSave = form?.name?.trim();

  return (
    <div style={{position:'fixed',inset:0,zIndex:300,background:'rgba(10,5,0,0.45)',backdropFilter:'blur(6px)',WebkitBackdropFilter:'blur(6px)',display:'flex',alignItems:'center',justifyContent:'center',padding:20,animation:'fadeIn 0.2s ease'}} onClick={onClose}>
      <div style={{width:'100%',maxWidth:420,maxHeight:'88vh',overflowY:'auto',borderRadius:20,background:C.hi,boxShadow:'0 24px 60px rgba(0,0,0,0.18)',padding:28,animation:'slideUp 0.25s cubic-bezier(0.34,1.4,0.64,1)'}} onClick={e=>e.stopPropagation()}>

        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:22}}>
          <h2 style={{fontFamily:C.display,fontSize:21,color:C.text,margin:0}}>
            {step==='paste'?'Import from Maps':'Confirm Details'}
          </h2>
          <button onClick={onClose} style={{background:'transparent',border:`1px solid ${C.bd}`,color:C.dim,borderRadius:'50%',width:30,height:30,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}><Ic n="close" size={13}/></button>
        </div>

        {step==='paste' && (<>
          <p style={{fontFamily:C.ui,fontSize:13,color:C.mid,marginBottom:14,lineHeight:1.6}}>
            Paste any Google Maps link below and tap Import.
          </p>
          <div style={{background:C.amberBg,border:`1px solid ${C.amberBd}`,borderRadius:10,padding:'10px 14px',marginBottom:16}}>
            <p style={{fontFamily:C.ui,fontSize:12,color:C.mid,lineHeight:1.7,margin:0}}>
              <strong style={{fontWeight:600,color:C.text}}>Auto-fills name + location:</strong> In Google Maps open the restaurant → Share → Open in Safari → copy the URL.<br/>
              <strong style={{fontWeight:600,color:C.text}}>Saves link only:</strong> Short <em>share.google/…</em> links — Google blocks reading them, so you'll add the name manually.
            </p>
          </div>
          <div style={{marginBottom:18}}>
            <label style={lbl}>Google Maps Link</label>
            <input style={inp} value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://maps.app.goo.gl/… or maps.google.com/…" autoFocus/>
          </div>
          <div style={{display:'flex',gap:10}}>
            <button onClick={onClose} style={{flex:1,padding:11,borderRadius:10,background:'transparent',border:`1px solid ${C.bdMid}`,color:C.mid,fontFamily:C.ui,fontSize:14,cursor:'pointer'}}>Cancel</button>
            <button onClick={handleParse} disabled={busy} style={{flex:2,padding:11,borderRadius:10,background:url&&!busy?C.espr:'rgba(20,10,0,0.08)',border:'none',color:url&&!busy?'#fdf8f3':C.dim,fontFamily:C.ui,fontSize:14,fontWeight:500,cursor:url&&!busy?'pointer':'default'}}>{busy?'Importing…':'Import →'}</button>
          </div>
        </>)}

        {step==='preview' && form && (<>
          {busy&&<p style={{fontFamily:C.ui,fontSize:12,color:C.amber,marginBottom:12}}>Getting address…</p>}
          {!form.name&&<div style={{background:C.amberBg,border:`1px solid ${C.amberBd}`,borderRadius:10,padding:'9px 13px',marginBottom:12}}>
            <p style={{fontFamily:C.ui,fontSize:12,color:C.mid,margin:0,lineHeight:1.5}}>Couldn't auto-fill the name — type it below.</p>
          </div>}
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            <div><label style={lbl}>Restaurant Name *</label><input style={inp} value={form.name} onChange={e=>set('name',e.target.value)} autoFocus={!form.name}/></div>
            <div><label style={lbl}>Cuisine</label>
              <select style={{...inp,cursor:'pointer'}} value={form.cuisine} onChange={e=>set('cuisine',e.target.value)}>
                {CUISINES.map(c=><option key={c}>{c}</option>)}
              </select>
            </div>
            <div><label style={lbl}>Location</label><input style={inp} value={form.location} onChange={e=>set('location',e.target.value)}/></div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
              <div><label style={lbl}>Website</label><input style={inp} value={form.website} onChange={e=>set('website',e.target.value)} placeholder="restaurant.com"/></div>
              <div><label style={lbl}>Phone</label><input style={inp} value={form.phone} onChange={e=>set('phone',e.target.value)} placeholder="+1 (212) 000-0000"/></div>
            </div>
            <div><label style={lbl}>Notes</label><textarea style={{...inp,resize:'vertical',minHeight:60}} value={form.note} onChange={e=>set('note',e.target.value)} placeholder="What to order, tips…"/></div>
            {form.lat&&form.lng&&(
              <div style={{background:C.sageBg,border:`1px solid ${C.sageBd}`,borderRadius:10,padding:'9px 13px'}}>
                <p style={{fontFamily:C.ui,fontSize:12,color:C.sage,margin:0,fontWeight:500}}>Coordinates found — will appear on map</p>
              </div>
            )}
          </div>
          <div style={{display:'flex',gap:10,marginTop:20}}>
            <button onClick={()=>setStep('paste')} style={{flex:1,padding:11,borderRadius:10,background:'transparent',border:`1px solid ${C.bdMid}`,color:C.mid,fontFamily:C.ui,fontSize:14,cursor:'pointer'}}>← Back</button>
            <button onClick={()=>canSave&&onImport(form)} style={{flex:2,padding:11,borderRadius:10,background:canSave?C.espr:'rgba(20,10,0,0.08)',border:'none',color:canSave?'#fdf8f3':C.dim,fontFamily:C.ui,fontSize:14,fontWeight:500,cursor:canSave?'pointer':'default',transition:'all 0.2s'}}>Pin It</button>
          </div>
        </>)}
      </div>
    </div>
  );
};

// ── Detail panel ─────────────────────────────────────────────
const DetailPanel = ({ r, onClose, onEdit, onMarkVisited, onRate, onDelete }) => {
  const [hoursOpen, setHoursOpen] = useState(false);

  const openUrl = url => window.open(url.startsWith('http')?url:'https://'+url,'_blank');
  function directions() {
    const q = r.lat&&r.lng?`${r.lat},${r.lng}`:encodeURIComponent([r.name,r.location].filter(Boolean).join(' '));
    window.open(`https://maps.google.com/maps?daddr=${q}`,'_blank');
  }
  function call() { if(r.phone) window.location='tel:'+r.phone.replace(/[^\d+]/g,''); }
  function menu() {
    if(r.menuUrl) return openUrl(r.menuUrl);
    window.open(`https://www.google.com/search?q=${encodeURIComponent(r.name+' '+(r.location||'')+' menu')}`,'_blank');
  }
  function share() {
    const url = r.googleMapsUrl||`https://www.google.com/maps/search/${encodeURIComponent(r.name)}`;
    if(navigator.share) navigator.share({title:r.name,url});
    else navigator.clipboard?.writeText(url);
  }
  function openInMaps() {
    openUrl(r.googleMapsUrl||`https://www.google.com/maps/search/${encodeURIComponent([r.name,r.location].filter(Boolean).join(' '))}`);
  }

  const isVisited = r.status === 'visited';
  const accent = isVisited ? C.sage : C.amber;
  const accentBg = isVisited ? C.sageBg : C.amberBg;
  const photos = (r.photos||[]).filter(p=>typeof p==='string'&&p.startsWith('http'));
  const actionBtns = [
    r.phone&&{label:'Call',   icon:<Ic n="phone"  size={20}/>, fn:call},
    {label:'Directions',      icon:<Ic n="nav"    size={20}/>, fn:directions},
    r.website&&{label:'Website',icon:<Ic n="globe" size={20}/>, fn:()=>openUrl(r.website)},
    {label:'Menu',            icon:<Ic n="list"   size={20}/>, fn:menu},
    {label:'Google',          icon:<Ic n="search" size={20}/>, fn:()=>window.open(`https://www.google.com/search?q=${encodeURIComponent([r.name,r.location].filter(Boolean).join(' '))}`, '_blank')},
    {label:'Share',           icon:<Ic n="share"  size={20}/>, fn:share},
  ].filter(Boolean);

  const divider = <div style={{height:1,background:C.bd,margin:'0 18px'}}/>;

  const row = (icon, content, onTap) => (
    <button onClick={onTap||undefined} style={{width:'100%',display:'flex',alignItems:'center',gap:16,padding:'14px 18px',background:'none',border:'none',cursor:onTap?'pointer':'default',textAlign:'left'}}>
      <span style={{flexShrink:0,width:22,display:'flex',justifyContent:'center',color:C.dim}}>{icon}</span>
      <div style={{flex:1,minWidth:0}}>{content}</div>
      {onTap&&<span style={{color:C.dim,fontSize:16,flexShrink:0}}>›</span>}
    </button>
  );

  return (
    <div style={{position:'fixed',inset:0,zIndex:200,background:'rgba(10,5,0,0.35)',backdropFilter:'blur(4px)',WebkitBackdropFilter:'blur(4px)',animation:'fadeIn 0.2s ease'}} onClick={onClose}>
      <div style={{position:'fixed',bottom:0,left:0,right:0,maxHeight:'92vh',borderRadius:'22px 22px 0 0',background:C.hi,boxShadow:'0 -4px 40px rgba(0,0,0,0.14)',display:'flex',flexDirection:'column',animation:'slideUp 0.3s cubic-bezier(0.34,1.1,0.64,1)'}} onClick={e=>e.stopPropagation()}>

        {/* Scrollable body */}
        <div style={{flex:1,overflowY:'auto',minHeight:0}}>

          {/* Drag handle + close */}
          <div style={{position:'sticky',top:0,zIndex:10,background:C.hi,padding:'12px 18px 0',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
            <div style={{flex:1}}/>
            <div style={{width:32,height:3.5,borderRadius:2,background:C.bdMid}}/>
            <div style={{flex:1,display:'flex',justifyContent:'flex-end'}}>
              <button onClick={onClose} style={{background:'transparent',border:`1px solid ${C.bd}`,color:C.dim,borderRadius:'50%',width:30,height:30,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}><Ic n="close" size={13}/></button>
            </div>
          </div>

          {/* Photos */}
          {photos.length>0?(
            <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:2,margin:'12px 0 0'}}>
              {photos.slice(0,6).map((p,i)=><img key={i} src={p} style={{width:'100%',aspectRatio:'1',objectFit:'cover'}} alt=""/>)}
            </div>
          ):(
            <div style={{margin:'12px 18px 0',height:110,background:C.surface,borderRadius:14,display:'flex',alignItems:'center',justifyContent:'center',border:`1px solid ${C.bd}`}}>
              <span style={{opacity:0.2,color:C.mid}}><Ic n="pin" size={38}/></span>
            </div>
          )}

          {/* Name + chips */}
          <div style={{padding:'18px 18px 14px'}}>
            <h2 style={{fontFamily:C.display,fontSize:27,color:C.text,margin:'0 0 10px',lineHeight:1.1}}>{r.name}</h2>
            <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
              <span style={{fontFamily:C.ui,fontSize:12,fontWeight:500,color:accent,background:accentBg,borderRadius:20,padding:'3px 10px'}}>{isVisited?'Visited':'To Visit'}</span>
              <span style={{color:C.bd}}>·</span>
              <span style={{fontFamily:C.ui,fontSize:12,fontWeight:500,color:C.mid}}>{r.cuisine}</span>
              {r.priceRange&&<><span style={{color:C.bd}}>·</span><span style={{fontFamily:C.ui,fontSize:12,color:C.mid}}>{r.priceRange}</span></>}
              {r.rating&&<><span style={{color:C.bd}}>·</span><StarRating value={r.rating} readonly size={12}/></>}
            </div>
          </div>

          {divider}

          {/* Action buttons */}
          <div style={{display:'flex',gap:8,padding:'14px 18px',overflowX:'auto',WebkitOverflowScrolling:'touch'}}>
            {actionBtns.map(b=>(
              <button key={b.label} onClick={b.fn} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:7,background:C.surface,border:`1px solid ${C.bd}`,borderRadius:14,padding:'12px 16px',cursor:'pointer',flexShrink:0,minWidth:64,color:C.mid,transition:'background 0.15s'}}>
                {b.icon}
                <span style={{fontFamily:C.ui,fontSize:11,fontWeight:500,whiteSpace:'nowrap'}}>{b.label}</span>
              </button>
            ))}
          </div>

          {divider}

          {/* Info rows */}
          <div style={{paddingBottom:12}}>
            {r.location&&row(<Ic n="pin" size={16}/>,
              <><p style={{fontFamily:C.ui,fontSize:14,color:C.text,fontWeight:500}}>{r.location}</p><p style={{fontFamily:C.ui,fontSize:12,color:C.dim,marginTop:1}}>Open in Google Maps</p></>,
              openInMaps
            )}
            {r.location&&divider}

            {r.hours?.length>0&&(<>
              <button onClick={()=>setHoursOpen(v=>!v)} style={{width:'100%',display:'flex',alignItems:'center',gap:16,padding:'14px 18px',background:'none',border:'none',cursor:'pointer',textAlign:'left'}}>
                <span style={{flexShrink:0,width:22,display:'flex',justifyContent:'center',color:C.dim}}><Ic n="clock" size={16}/></span>
                <span style={{fontFamily:C.ui,fontSize:14,color:C.text,fontWeight:500,flex:1}}>Hours</span>
                <span style={{color:C.dim,fontSize:13,transition:'transform 0.2s',display:'inline-block',transform:hoursOpen?'rotate(90deg)':'none'}}>›</span>
              </button>
              {hoursOpen&&(
                <div style={{padding:'0 18px 14px 56px'}}>
                  {r.hours.map((h,i)=>(
                    <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'4px 0',borderBottom:i<r.hours.length-1?`1px solid ${C.bd}`:'none'}}>
                      <span style={{fontFamily:C.ui,fontSize:13,color:C.dim}}>{h.day}</span>
                      <span style={{fontFamily:C.ui,fontSize:13,color:h.time==='Closed'?C.red:C.sage,fontWeight:500}}>{h.time}</span>
                    </div>
                  ))}
                </div>
              )}
              {divider}
            </>)}

            {r.phone&&<>{row(<Ic n="phone" size={16}/>,
              <span style={{fontFamily:C.ui,fontSize:14,color:C.amber,fontWeight:500}}>{r.phone}</span>,
              call
            )}{divider}</>}

            {r.website&&<>{row(<Ic n="globe" size={16}/>,
              <span style={{fontFamily:C.ui,fontSize:14,color:C.amber,fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',display:'block'}}>{r.website.replace(/^https?:\/\//,'')}</span>,
              ()=>openUrl(r.website)
            )}{divider}</>}

            {r.note&&<>{row(<Ic n="chat" size={16}/>,
              <><p style={{fontFamily:C.ui,fontSize:11,fontWeight:600,letterSpacing:'0.04em',textTransform:'uppercase',color:C.dim,marginBottom:4}}>{r.recommender?'Note from '+r.recommender:'Note'}</p><p style={{fontFamily:C.display,fontSize:15,color:C.text,fontStyle:'italic',lineHeight:1.6}}>"{r.note}"</p></>
            )}{divider}</>}

            {r.recommender&&<>{row(<Ic n="person" size={16}/>,
              <><p style={{fontFamily:C.ui,fontSize:11,fontWeight:600,letterSpacing:'0.04em',textTransform:'uppercase',color:C.dim,marginBottom:2}}>Recommended by</p><p style={{fontFamily:C.ui,fontSize:14,color:C.text,fontWeight:500}}>{r.recommender}</p></>
            )}{divider}</>}

            {/* Rating */}
            <div style={{display:'flex',alignItems:'center',gap:16,padding:'14px 18px'}}>
              <span style={{flexShrink:0,width:22,display:'flex',justifyContent:'center',color:C.dim}}><Ic n="star" size={16}/></span>
              <div>
                <p style={{fontFamily:C.ui,fontSize:11,fontWeight:600,letterSpacing:'0.04em',textTransform:'uppercase',color:C.dim,marginBottom:7}}>Your rating</p>
                <StarRating value={r.rating} onChange={v=>onRate(r.id,v)} size={26}/>
              </div>
            </div>
          </div>
        </div>

        {/* Sticky bottom action bar */}
        <div style={{flexShrink:0,padding:'12px 18px 36px',borderTop:`1px solid ${C.bd}`,display:'flex',gap:10,background:C.hi}}>
          {!isVisited&&(
            <button onClick={()=>onMarkVisited(r.id)} style={{flex:2,padding:13,borderRadius:12,background:C.sageBg,border:`1.5px solid ${C.sageBd}`,color:C.sage,fontFamily:C.ui,fontSize:14,fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:6}}>Mark as Visited</button>
          )}
          <button onClick={()=>onEdit(r)} style={{flex:1,padding:13,borderRadius:12,background:C.surface,border:`1px solid ${C.bdMid}`,color:C.mid,fontFamily:C.ui,fontSize:14,fontWeight:500,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:7}}><Ic n="edit" size={14}/>Edit</button>
          <button onClick={()=>{ if(window.confirm('Remove "'+r.name+'"? This cannot be undone.')) onDelete(r.id); }} style={{padding:13,borderRadius:12,background:C.redBg,border:`1px solid ${C.redBd}`,color:C.red,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}><Ic n="trash" size={16}/></button>
        </div>
      </div>
    </div>
  );
};

// ── Add / Edit modal ─────────────────────────────────────────
const EditModal = ({ onClose, onSave, editData }) => {
  const [form, setForm] = useState(editData||{
    name:'',cuisine:'Italian',location:'',recommender:'',note:'',
    status:'want',rating:null,priceRange:'',phone:'',website:'',
    menuUrl:'',hours:[],photos:[],reviews:[],lat:null,lng:null,googleMapsUrl:'',
  });
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));
  const inp={width:'100%',padding:'10px 14px',background:C.hi,border:`1px solid ${C.bdMid}`,borderRadius:10,fontFamily:C.ui,fontSize:14,color:C.text,outline:'none',boxSizing:'border-box'};
  const lbl={display:'block',fontFamily:C.ui,fontSize:11,fontWeight:600,letterSpacing:'0.05em',color:C.dim,marginBottom:5,textTransform:'uppercase'};
  const ok=form.name.trim();
  return (
    <div style={{position:'fixed',inset:0,zIndex:300,background:'rgba(10,5,0,0.45)',backdropFilter:'blur(6px)',WebkitBackdropFilter:'blur(6px)',display:'flex',alignItems:'center',justifyContent:'center',padding:20,animation:'fadeIn 0.2s ease'}} onClick={onClose}>
      <div style={{width:'100%',maxWidth:420,maxHeight:'88vh',overflowY:'auto',borderRadius:20,background:C.hi,boxShadow:'0 24px 60px rgba(0,0,0,0.18)',padding:28,animation:'slideUp 0.25s cubic-bezier(0.34,1.4,0.64,1)'}} onClick={e=>e.stopPropagation()}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:22}}>
          <h2 style={{fontFamily:C.display,fontSize:21,color:C.text,margin:0}}>{editData?'Edit Restaurant':'Add Manually'}</h2>
          <button onClick={onClose} style={{background:'transparent',border:`1px solid ${C.bd}`,color:C.dim,borderRadius:'50%',width:30,height:30,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}><Ic n="close" size={13}/></button>
        </div>
        <div style={{display:'flex',flexDirection:'column',gap:14}}>
          <div><label style={lbl}>Restaurant Name *</label><input style={inp} value={form.name} onChange={e=>set('name',e.target.value)} placeholder="e.g. Chez Pierre"/></div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <div><label style={lbl}>Cuisine</label><select style={{...inp,cursor:'pointer'}} value={form.cuisine} onChange={e=>set('cuisine',e.target.value)}>{CUISINES.map(c=><option key={c}>{c}</option>)}</select></div>
            <div><label style={lbl}>Recommended By</label><input style={inp} value={form.recommender} onChange={e=>set('recommender',e.target.value)} placeholder="e.g. Sarah"/></div>
          </div>
          <div><label style={lbl}>Location</label><input style={inp} value={form.location} onChange={e=>set('location',e.target.value)} placeholder="e.g. West Village, NYC"/></div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <div><label style={lbl}>Website</label><input style={inp} value={form.website} onChange={e=>set('website',e.target.value)} placeholder="restaurant.com"/></div>
            <div><label style={lbl}>Menu URL</label><input style={inp} value={form.menuUrl} onChange={e=>set('menuUrl',e.target.value)} placeholder="restaurant.com/menu"/></div>
          </div>
          <div><label style={lbl}>Phone</label><input style={inp} value={form.phone} onChange={e=>set('phone',e.target.value)} placeholder="+1 (212) 000-0000"/></div>
          <div><label style={lbl}>Notes</label><textarea style={{...inp,resize:'vertical',minHeight:64}} value={form.note} onChange={e=>set('note',e.target.value)} placeholder="What to order, tips, vibes…"/></div>
          <div>
            <label style={lbl}>Status</label>
            <div style={{display:'flex',gap:8}}>
              {['want','visited'].map(s=>(
                <button key={s} onClick={()=>set('status',s)} style={{flex:1,padding:10,borderRadius:10,border:`1.5px solid ${form.status===s?C.amber:C.bd}`,background:form.status===s?C.amberBg:'transparent',color:form.status===s?C.amber:C.dim,fontFamily:C.ui,fontSize:13,fontWeight:500,cursor:'pointer',transition:'all 0.15s'}}>
                  {s==='want'?'To Visit':'Visited'}
                </button>
              ))}
            </div>
          </div>
          {form.status==='visited'&&<div><label style={lbl}>Your Rating</label><StarRating value={form.rating} onChange={v=>set('rating',v)} size={22}/></div>}
        </div>
        <div style={{display:'flex',gap:10,marginTop:22}}>
          <button onClick={onClose} style={{flex:1,padding:11,borderRadius:10,background:'transparent',border:`1px solid ${C.bdMid}`,color:C.mid,fontFamily:C.ui,fontSize:14,cursor:'pointer'}}>Cancel</button>
          <button onClick={()=>ok&&onSave(form)} style={{flex:2,padding:11,borderRadius:10,background:ok?C.espr:'rgba(20,10,0,0.08)',border:'none',color:ok?'#fdf8f3':C.dim,fontFamily:C.ui,fontSize:14,fontWeight:500,cursor:ok?'pointer':'default',transition:'all 0.2s'}}>Save Restaurant</button>
        </div>
      </div>
    </div>
  );
};

// ── Card ─────────────────────────────────────────────────────
function getPriorityList() {
  try { return JSON.parse(localStorage.getItem('pinplate_priority')||'[]'); } catch(e) { return []; }
}
function savePriorityList(list) {
  localStorage.setItem('pinplate_priority', JSON.stringify(list));
}

const Card = ({ r, onClick, isPriority, priorityNum, priorityTotal, onTogglePriority, onMoveUp, onMoveDown }) => {
  const isVisited = r.status === 'visited';
  const accent    = isVisited ? C.sage  : C.amber;
  const accentBg  = isVisited ? C.sageBg : C.amberBg;

  function nav(e) {
    e.stopPropagation();
    const q=r.lat&&r.lng?`${r.lat},${r.lng}`:encodeURIComponent([r.name,r.location].filter(Boolean).join(' '));
    window.open(`https://maps.google.com/maps?daddr=${q}`,'_blank');
  }
  function site(e) {
    e.stopPropagation();
    window.open(r.website.startsWith('http')?r.website:'https://'+r.website,'_blank');
  }

  return (
    <div onClick={onClick}
      style={{background:C.hi,borderRadius:14,padding:'17px 18px',cursor:'pointer',borderLeft:`3px solid ${isPriority?C.amber:accent}`,boxShadow: isPriority?'0 2px 12px rgba(192,112,48,0.13)':'0 1px 3px rgba(0,0,0,0.05),0 3px 10px rgba(0,0,0,0.04)',transition:'transform 0.16s,box-shadow 0.16s'}}
      onMouseEnter={e=>{e.currentTarget.style.transform='translateY(-1px)';e.currentTarget.style.boxShadow=isPriority?'0 6px 20px rgba(192,112,48,0.18)':'0 4px 16px rgba(0,0,0,0.09)';}}
      onMouseLeave={e=>{e.currentTarget.style.transform='';e.currentTarget.style.boxShadow=isPriority?'0 2px 12px rgba(192,112,48,0.13)':'0 1px 3px rgba(0,0,0,0.05),0 3px 10px rgba(0,0,0,0.04)';}}>

      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:8}}>
        <div style={{flex:1,paddingRight:8,display:'flex',alignItems:'flex-start',gap:7}}>
          {isPriority&&priorityNum&&(
            <div style={{flexShrink:0,display:'flex',alignItems:'center',gap:3,marginTop:1}}>
              <span style={{minWidth:18,height:18,borderRadius:9,background:C.amber,color:'#fff',fontFamily:C.ui,fontSize:10,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center',padding:'0 5px'}}>{priorityNum}</span>
              <div style={{display:'flex',flexDirection:'column',gap:1}}>
                <button onClick={e=>{e.stopPropagation();onMoveUp&&onMoveUp();}} disabled={priorityNum===1} style={{background:'none',border:'none',padding:0,cursor:priorityNum===1?'default':'pointer',lineHeight:1,opacity:priorityNum===1?0.25:0.7}}>
                  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={C.amber} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18,15 12,9 6,15"/></svg>
                </button>
                <button onClick={e=>{e.stopPropagation();onMoveDown&&onMoveDown();}} disabled={priorityNum===priorityTotal} style={{background:'none',border:'none',padding:0,cursor:priorityNum===priorityTotal?'default':'pointer',lineHeight:1,opacity:priorityNum===priorityTotal?0.25:0.7}}>
                  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={C.amber} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6,9 12,15 18,9"/></svg>
                </button>
              </div>
            </div>
          )}
          <h3 style={{fontFamily:C.display,fontSize:17,color:C.text,margin:0,lineHeight:1.25}}>{r.name}</h3>
        </div>
        {isVisited&&r.rating
          ?<StarRating value={r.rating} readonly size={11}/>
          :!isVisited&&(
            <button onClick={e=>{e.stopPropagation();onTogglePriority&&onTogglePriority();}} style={{background:'none',border:'none',padding:'1px 0 0',cursor:'pointer',flexShrink:0,lineHeight:1}}>
              <svg width={17} height={17} viewBox="0 0 24 24" fill={isPriority?C.amber:'none'} stroke={isPriority?C.amber:'rgba(168,144,122,0.35)'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12,2 15.1,8.3 22,9.3 17,14.1 18.2,21 12,17.8 5.8,21 7,14.1 2,9.3 8.9,8.3"/>
              </svg>
            </button>
          )
        }
      </div>

      <div style={{display:'flex',gap:7,alignItems:'center',flexWrap:'wrap',marginBottom:r.note?8:10}}>
        <span style={{fontFamily:C.ui,fontSize:11,fontWeight:500,color:accent,background:accentBg,borderRadius:20,padding:'2px 9px'}}>{r.cuisine}</span>
        {r.location&&<span style={{fontFamily:C.ui,fontSize:11,color:C.dim}}>{r.location}</span>}
      </div>

      {r.note&&<p style={{fontFamily:C.ui,fontSize:12,color:'#8a7060',margin:'0 0 10px',lineHeight:1.5,overflow:'hidden',display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical',fontStyle:'italic'}}>"{r.note}"</p>}

      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        {r.recommender
          ?<span style={{fontFamily:C.ui,fontSize:11,color:C.dim}}>via <span style={{color:C.amber,fontWeight:500}}>{r.recommender}</span></span>
          :<span/>}
        <div style={{display:'flex',gap:4}}>
          <button onClick={nav} title="Directions" style={{padding:'5px 7px',borderRadius:7,background:C.amberBg,border:`1px solid ${C.amberBd}`,color:C.amber,cursor:'pointer',display:'flex',alignItems:'center'}}><Ic n="nav" size={13}/></button>
          {r.website&&<button onClick={site} title="Website" style={{padding:'5px 7px',borderRadius:7,background:C.surface,border:`1px solid ${C.bd}`,color:C.mid,cursor:'pointer',display:'flex',alignItems:'center'}}><Ic n="globe" size={13}/></button>}
        </div>
      </div>
    </div>
  );
};

// ── Feed ─────────────────────────────────────────────────────
const Feed = ({ restaurants, onCardClick }) => {
  const [cuisine, setCuisine]   = useState('All');
  const [section, setSection]   = useState('want');
  const [priority, setPriority] = useState(()=>getPriorityList());

  function togglePriority(id) {
    setPriority(prev => {
      const next = prev.includes(id) ? prev.filter(x=>x!==id) : [...prev, id];
      savePriorityList(next);
      return next;
    });
  }
  function movePriority(id, dir) {
    setPriority(prev => {
      const idx = prev.indexOf(id);
      if (idx === -1) return prev;
      const newIdx = idx + dir;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
      savePriorityList(next);
      return next;
    });
  }

  const cuisines     = useMemo(()=>[...new Set(restaurants.map(r=>r.cuisine).filter(Boolean))].sort(),[restaurants]);
  const show         = cuisine==='All' ? restaurants : restaurants.filter(r=>r.cuisine===cuisine);
  const wantList     = show.filter(r=>r.status==='want');
  const visitedList  = show.filter(r=>r.status==='visited');

  const prioritySet  = new Set(priority);
  const wantPriority = priority.filter(id=>wantList.some(r=>r.id===id)).map(id=>wantList.find(r=>r.id===id)).filter(Boolean);
  const wantOther    = wantList.filter(r=>!prioritySet.has(r.id));

  const emptyWant    = cuisine==='All' ? 'Nothing saved yet — tap + Add to start' : `No ${cuisine} spots to visit`;
  const emptyVisited = cuisine==='All' ? 'None yet — mark a spot as visited' : `No ${cuisine} spots visited`;

  const toggleBtn = (key, label, count, accent, accentBg, accentBd) => (
    <button onClick={()=>setSection(key)} style={{flex:1,padding:'14px 10px',borderRadius:14,border:`2px solid ${section===key ? accent : C.bd}`,background:section===key ? accentBg : 'transparent',cursor:'pointer',transition:'all 0.18s',textAlign:'center'}}>
      <div style={{fontFamily:C.display,fontSize:18,color:section===key ? accent : C.dim,marginBottom:2}}>{label}</div>
      <div style={{fontFamily:C.ui,fontSize:22,fontWeight:700,color:section===key ? accent : C.dim}}>{count}</div>
    </button>
  );

  return (
    <div style={{display:'flex',flexDirection:'column'}}>
      {/* Cuisine chips */}
      <div style={{display:'flex',gap:8,overflowX:'auto',padding:'10px 16px 8px',scrollbarWidth:'none',WebkitOverflowScrolling:'touch',flexShrink:0}}>
        {['All',...cuisines].map(c=>(
          <button key={c} onClick={()=>setCuisine(c)} style={{flexShrink:0,padding:'6px 14px',borderRadius:20,border:`1px solid ${cuisine===c?C.espr:C.bd}`,background:cuisine===c?C.espr:'transparent',color:cuisine===c?'#fdf8f3':C.mid,fontFamily:C.ui,fontSize:12,fontWeight:500,cursor:'pointer',transition:'all 0.15s'}}>{c}</button>
        ))}
      </div>

      {/* Section toggle buttons */}
      <div style={{display:'flex',gap:10,padding:'6px 16px 14px'}}>
        {toggleBtn('want',    'To Visit', wantList.length,    C.amber, C.amberBg, C.amberBd)}
        {toggleBtn('visited', 'Visited',  visitedList.length, C.sage,  C.sageBg,  C.sageBd)}
      </div>

      {/* Card list */}
      <div style={{paddingBottom:80}}>
        {section==='want' ? (
          wantList.length===0
            ? <p style={{fontFamily:C.ui,fontSize:13,color:C.dim,padding:'24px 16px'}}>{emptyWant}</p>
            : <>
                {wantPriority.length>0&&(
                  <>
                    <div style={{display:'flex',alignItems:'center',gap:8,padding:'0 16px 10px'}}>
                      <span style={{fontFamily:C.ui,fontSize:11,fontWeight:700,letterSpacing:'0.07em',textTransform:'uppercase',color:C.amber}}>Visit First</span>
                      <div style={{flex:1,height:1,background:C.amberBd}}/>
                    </div>
                    <div style={{padding:'0 16px',display:'flex',flexDirection:'column',gap:10}}>
                      {wantPriority.map((r,i)=><Card key={r.id} r={r} onClick={()=>onCardClick(r)} isPriority={true} priorityNum={i+1} priorityTotal={wantPriority.length} onTogglePriority={()=>togglePriority(r.id)} onMoveUp={()=>movePriority(r.id,-1)} onMoveDown={()=>movePriority(r.id,1)}/>)}
                    </div>
                    {wantOther.length>0&&<div style={{margin:'16px 16px 14px',height:1,background:C.bd}}/>}
                  </>
                )}
                {wantOther.length>0&&(
                  <div style={{padding:'0 16px',display:'flex',flexDirection:'column',gap:10}}>
                    {wantOther.map(r=><Card key={r.id} r={r} onClick={()=>onCardClick(r)} isPriority={false} onTogglePriority={()=>togglePriority(r.id)}/>)}
                  </div>
                )}
              </>
        ) : (
          visitedList.length===0
            ? <p style={{fontFamily:C.ui,fontSize:13,color:C.dim,padding:'24px 16px'}}>{emptyVisited}</p>
            : <div style={{padding:'0 16px',display:'flex',flexDirection:'column',gap:10}}>
                {visitedList.map(r=><Card key={r.id} r={r} onClick={()=>onCardClick(r)}/>)}
              </div>
        )}
      </div>
    </div>
  );
};

// ── Sign-in screen ───────────────────────────────────────────
const ADMIN_EMAIL = 'mehdiiaabbassii@gmail.com';

const SignIn = () => {
  const [password, setPassword] = useState('');
  const [err,      setErr]      = useState('');
  const [busy,     setBusy]     = useState(false);

  const inp = {width:'100%',padding:'11px 14px',background:C.hi,border:`1px solid ${C.bdMid}`,borderRadius:10,fontFamily:C.ui,fontSize:14,color:C.text,outline:'none',boxSizing:'border-box'};
  const lbl = {display:'block',fontFamily:C.ui,fontSize:11,fontWeight:600,letterSpacing:'0.05em',color:C.dim,marginBottom:5,textTransform:'uppercase'};

  async function signIn() {
    if (!password) return;
    setBusy(true); setErr('');
    const { error } = await sb.auth.signInWithPassword({ email: ADMIN_EMAIL, password });
    if (error) { setErr('Incorrect passphrase'); setBusy(false); }
  }

  return (
    <div style={{minHeight:'100vh',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',background:C.bg,padding:24}}>
      <h1 style={{fontFamily:C.display,fontSize:38,color:C.text,margin:'0 0 6px',letterSpacing:'-0.02em'}}>PinPlate</h1>
      <p style={{fontFamily:C.ui,fontSize:13,color:C.dim,margin:'0 0 36px'}}>Your personal city guide</p>
      <div style={{width:'100%',maxWidth:340,background:C.hi,borderRadius:20,padding:28,boxShadow:'0 4px 28px rgba(0,0,0,0.09)'}}>
        <h2 style={{fontFamily:C.display,fontSize:22,color:C.text,margin:'0 0 22px'}}>Sign in</h2>
        <div style={{display:'flex',flexDirection:'column',gap:14}}>
          <div>
            <label style={lbl}>Passphrase</label>
            <input type="password" style={inp} value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" autoFocus onKeyDown={e=>e.key==='Enter'&&signIn()}/>
          </div>
          {err&&<p style={{fontFamily:C.ui,fontSize:12,color:C.red,margin:0,lineHeight:1.5}}>{err}</p>}
          <button onClick={signIn} disabled={busy} style={{padding:12,borderRadius:11,background:C.espr,border:'none',color:'#fdf8f3',fontFamily:C.ui,fontSize:14,fontWeight:600,cursor:busy?'default':'pointer',marginTop:4,opacity:busy?0.6:1}}>{busy?'Signing in…':'Sign in'}</button>
        </div>
      </div>
    </div>
  );
};

const PENDING_SPOTS = [
  {
    id: '550e8400-e29b-41d4-a716-446655440001',
    name: 'Eat Bar & Patio Haraheri',
    cuisine: 'Japanese',
    location: 'Vancouver, BC',
    recommended_by: '',
    notes: 'Modern izakaya · inventive Japanese small plates · sake, beer & unique cocktails · Happy hour food · Great cocktails · Vegan options',
    visited: false,
    price_range: '$20-60',
    lat: 49.2658, lng: -123.1452,
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440002',
    name: 'Via Tevere Pizzeria Victoria Drive',
    cuisine: 'Italian',
    location: '1190 Victoria Dr, Vancouver, BC V5L 4G5',
    recommended_by: '',
    notes: 'Thin-crust wood-fired Neapolitan pies & wine · Outdoor seating · Great cocktails · Doesn\'t accept reservations',
    visited: false,
    price_range: '$20-30',
    google_maps_url: 'https://maps.app.goo.gl/rpqoWYjLP4dnhais5',
    lat: 49.2501, lng: -123.0686,
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440003',
    name: 'Social Corner Coal Harbour',
    cuisine: 'Italian',
    location: '1050 W Cordova St, Vancouver, BC V6E 2E9',
    recommended_by: '',
    notes: 'Italian-Spanish all-day dining · Canada\'s largest gold-plated Neapolitan pizza oven · Michelin Recommended · Happy hour · Fireplace · Private dining room · 290 seats across two patios',
    visited: false,
    price_range: '$40-100',
    phone: '(604) 336-8656',
    website: 'https://persesocialcorner.com',
    hours: ['Monday: 11 AM–11 PM','Tuesday: 11 AM–11 PM','Wednesday: 11 AM–11 PM','Thursday: 11 AM–11 PM','Friday: 11 AM–12 AM','Saturday: 11 AM–12 AM','Sunday: 11 AM–11 PM'],
    lat: 49.2896, lng: -123.1268,
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440004',
    name: 'JEON',
    cuisine: 'Korean',
    location: '1160 Davie St #110, Vancouver, BC V6E 1N1',
    recommended_by: '',
    notes: 'Modern Korean · elevated sharing plates · truffle japchae · pressed galbi · kimchi arancini · dark leather booths & Korean-inspired screens · from Chef Tom Jeon of Tom Sushi & Tozen',
    visited: false,
    price_range: '$40-100',
    phone: '(236) 480-8080',
    website: 'https://jeonvancouver.com',
    hours: ['Monday: 5–10 PM','Tuesday: Closed','Wednesday: 5–10 PM','Thursday: 5–10 PM','Friday: 5–11 PM','Saturday: 5–11 PM','Sunday: 5–10 PM'],
    lat: 49.2769, lng: -123.1363,
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440005',
    name: 'Linh Café',
    cuisine: 'Vietnamese',
    location: '1428 Granville St Unit 130, Vancouver, BC V6Z 1N2',
    recommended_by: '',
    notes: 'French-Vietnamese all-day café · pho, bánh mì & Vietnamese coffee · bright airy space · Beach District near Granville Bridge',
    visited: false,
    price_range: '$20-80',
    phone: '604-564-9668',
    website: 'https://www.linhcafe.com',
    hours: ['Monday: 9 AM–9 PM','Tuesday: 9 AM–9 PM','Wednesday: 9 AM–9 PM','Thursday: 9 AM–9 PM','Friday: 9 AM–10 PM','Saturday: 9 AM–10 PM','Sunday: 9 AM–9 PM'],
    lat: 49.2694, lng: -123.1399,
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440006',
    name: 'Grandt Kitchen Surrey',
    cuisine: 'Filipino',
    location: '10257 King George Blvd, Surrey, BC',
    recommended_by: '',
    notes: 'Authentic Filipino cuisine · family-owned · dine-in, takeout & catering · Western and Filipino dishes',
    visited: false,
    price_range: '$15-30',
    phone: '778-395-0900',
    website: 'https://grandtkitchen.ca',
    hours: ['Monday: 11 AM–8 PM','Tuesday: 11 AM–8 PM','Wednesday: 11 AM–8 PM','Thursday: 11 AM–8 PM','Friday: 11 AM–8 PM','Saturday: 10:30 AM–8 PM','Sunday: 10:30 AM–8 PM'],
    lat: 49.1878, lng: -122.8484,
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440007',
    name: 'Osteria Savio Volpe',
    cuisine: 'Italian',
    location: '615 Kingsway, Vancouver, BC',
    recommended_by: '',
    notes: 'Rustic Italian trattoria · handmade pasta · wood-fired dishes · strong Italian wine list · one of Vancouver\'s best neighbourhood restaurants',
    visited: false,
    price_range: '$40-80',
    phone: '604-428-0072',
    website: 'https://saviovolpe.com',
    hours: ['Monday: 5–10:30 PM','Tuesday: 5–10:30 PM','Wednesday: 5–10:30 PM','Thursday: 5–10:30 PM','Friday: 5–10:30 PM','Saturday: 5–10:30 PM','Sunday: 5–10:30 PM'],
    lat: 49.2516, lng: -123.0896,
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440008',
    name: 'Kulinarya Filipino Eatery',
    cuisine: 'Filipino',
    location: '1134 Commercial Dr, Vancouver, BC',
    recommended_by: '',
    notes: 'Authentic Filipino · Kamayan feast · party trays & catering · casual neighbourhood spot on Commercial Drive',
    visited: false,
    price_range: '$15-30',
    phone: '604-255-4155',
    website: 'https://kulinarya.ca',
    hours: ['Monday: Closed','Tuesday: 11 AM–8 PM','Wednesday: 11 AM–8 PM','Thursday: 11 AM–8 PM','Friday: 11 AM–9 PM','Saturday: 11 AM–9 PM','Sunday: 11 AM–8 PM'],
    lat: 49.2590, lng: -123.0697,
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440009',
    name: 'La Mezcaleria',
    cuisine: 'Mexican',
    location: '1622 Commercial Dr, Vancouver, BC',
    recommended_by: '',
    notes: 'Mexican · mezcal & tequila cocktails · tacos, ceviche & small plates · vibrant atmosphere · Commercial Drive',
    visited: false,
    price_range: '$20-50',
    phone: '604-559-8226',
    website: 'https://lamezcaleria.ca',
    lat: 49.2625, lng: -123.0696,
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440010',
    name: 'Tozen Sushi Bar',
    cuisine: 'Japanese',
    location: '967 W Broadway, Vancouver, BC',
    recommended_by: '',
    notes: 'Omakase-style Japanese · premium sushi bar · intimate counter seating · from Chef Tom Jeon of JEON fame',
    visited: false,
    price_range: '$80-150',
    phone: '604-416-4949',
    website: 'https://tozensushibar.ca',
    lat: 49.2634, lng: -123.1360,
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440011',
    name: 'Yokai Tapas Bar',
    cuisine: 'Japanese',
    location: '8133 Cook Rd, Richmond, BC',
    recommended_by: '',
    notes: 'Japanese izakaya tapas · creative small plates · lively atmosphere · Richmond',
    visited: false,
    price_range: '$30-60',
    website: 'https://yokaitapas.com',
    lat: 49.1645, lng: -123.1380,
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440012',
    name: 'Lavantine Restaurant & Skybar',
    cuisine: 'Middle Eastern',
    location: '833 W Pender St, Vancouver, BC',
    recommended_by: '',
    notes: 'Middle Eastern · rooftop skybar · upscale mezze & cocktails · stunning views · downtown Vancouver',
    visited: false,
    price_range: '$50-120',
    phone: '604-416-2855',
    website: 'https://lavantine.ca',
    lat: 49.2855, lng: -123.1233,
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440013',
    name: 'Reflections: The Garden Terrace',
    cuisine: 'Other',
    location: '801 W Georgia St, Vancouver, BC',
    recommended_by: '',
    notes: 'Garden rooftop terrace inside Rosewood Hotel Georgia · global tapas & craft cocktails · brunch & dinner · Vancouver landmark setting',
    visited: false,
    price_range: '$60-120',
    phone: '604-673-7043',
    website: 'https://www.rosewoodhotels.com/en/hotel-georgia-vancouver/dining/reflections-terrace',
    hours: ['Monday: 4–11 PM','Tuesday: 4–11 PM','Wednesday: 4–11 PM','Thursday: 4–11 PM','Friday: 4–11 PM','Saturday: 10:30 AM–2:30 PM, 4–11 PM','Sunday: 10:30 AM–2:30 PM, 4–11 PM'],
    lat: 49.2832, lng: -123.1191,
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440014',
    name: 'Selene Aegean Bistro',
    cuisine: 'Mediterranean',
    location: '360 Penticton St, Vancouver, BC',
    recommended_by: '',
    notes: 'Greek-Mediterranean · charcoal-grilled meats & seafood · Aegean flavours · cozy East Vancouver spot',
    visited: false,
    price_range: '$40-80',
    phone: '604-336-4539',
    website: 'https://seleneagn.com',
    lat: 49.2571, lng: -123.0680,
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440015',
    name: 'Ask For Luigi',
    cuisine: 'Italian',
    location: '305 Alexander St, Vancouver, BC',
    recommended_by: '',
    notes: 'Beloved Italian pasta spot · handmade pasta & antipasti · Railtown/Gastown · tiny space, book ahead',
    visited: false,
    price_range: '$30-60',
    phone: '604-428-2544',
    website: 'https://askforluigi.com',
    lat: 49.2842, lng: -123.0927,
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440016',
    name: 'Kamei Royale Japanese Restaurant',
    cuisine: 'Japanese',
    location: '1066 W Hastings St, Vancouver, BC',
    recommended_by: '',
    notes: 'Traditional Japanese · sushi, sashimi & teriyaki · downtown Vancouver · long-standing favourite · complimentary parking evenings',
    visited: false,
    price_range: '$30-60',
    phone: '604-687-8588',
    website: 'https://kameiroyale.com',
    hours: ['Monday: 11:30 AM–2:30 PM, 4–9:30 PM','Tuesday: 11:30 AM–2:30 PM, 4–9:30 PM','Wednesday: 11:30 AM–2:30 PM, 4–9:30 PM','Thursday: 11:30 AM–2:30 PM, 4–9:30 PM','Friday: 11:30 AM–2:30 PM, 4–10 PM','Saturday: 5–10 PM','Sunday: 5–9:30 PM'],
    lat: 49.2871, lng: -123.1238,
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440017',
    name: 'Gojo Cafe Ethiopia',
    cuisine: 'Ethiopian',
    location: '2838 Commercial Dr, Vancouver, BC',
    recommended_by: '',
    notes: 'Ethiopian · injera & slow-cooked stews · communal sharing plates · beloved Commercial Drive institution',
    visited: false,
    price_range: '$20-40',
    phone: '604-708-5394',
    website: 'https://gojocafe.com',
    lat: 49.2586, lng: -123.0700,
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440018',
    name: 'SUYO Modern Peruvian',
    cuisine: 'Peruvian',
    location: '3475 Main St, Vancouver, BC',
    recommended_by: '',
    notes: 'Modern Peruvian · ceviche, tiradito & creative mains · Main Street · intimate tasting-menu vibe',
    visited: false,
    price_range: '$60-100',
    phone: '604-322-1588',
    website: 'https://suyo.ca',
    hours: ['Monday: Closed','Tuesday: 5–9 PM','Wednesday: 5–9 PM','Thursday: 5–9 PM','Friday: 5–9 PM','Saturday: 5–9 PM','Sunday: Closed'],
    lat: 49.2471, lng: -123.1016,
  },
];

// ── App ──────────────────────────────────────────────────────
function App() {
  const [restaurants,setRestaurants] = useState([]);
  const [loading,setLoading]         = useState(true);
  const [tab,setTab]                 = useState('home');
  const [showEdit,setShowEdit]       = useState(false);
  const [showImport,setShowImport]   = useState(false);
  const [showAddMenu,setShowAddMenu]     = useState(false);
  const [editTarget,setEditTarget]   = useState(null);
  const [detail,setDetail]           = useState(null);
  const [search,setSearch]           = useState('');
  const [toast,setToast]             = useState(null);
  const [session,setSession]         = useState(null);
  const [authChecked,setAuthChecked] = useState(false);

  function showToast(msg) { setToast(msg); setTimeout(()=>setToast(null),2500); }

  // Auth state
  useEffect(() => {
    sb.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthChecked(true);
    });
    const { data: { subscription } } = sb.auth.onAuthStateChange((_ev, session) => {
      setSession(session);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function insertPending() {
    if (!PENDING_SPOTS.length) return;
    const ids = PENDING_SPOTS.map(s=>s.id);
    const { data: existing } = await sb.from('spots').select('id').in('id', ids);
    const existingIds = new Set((existing||[]).map(r=>r.id));
    const toInsert = PENDING_SPOTS.filter(s=>!existingIds.has(s.id));
    if (!toInsert.length) return;
    let { error } = await sb.from('spots').insert(toInsert);
    if (error && (error.message?.includes('column') || error.message?.includes('schema') || error.code==='PGRST204')) {
      const safe = toInsert.map(({id,name,cuisine,location,recommended_by,notes,visited,rating})=>
        ({id,name:name||'',cuisine:cuisine||'Other',location:location||null,recommended_by:recommended_by||null,notes:notes||null,visited:!!visited,rating:rating||null}));
      ({ error } = await sb.from('spots').insert(safe));
    }
    if (error) showToast('Seed error: '+error.message);
  }

  async function handleSave(form) {
    const payload = appToDb(form);
    let error;
    if (editTarget) ({ error } = await sb.from('spots').update(payload).eq('id',editTarget.id));
    else            ({ error } = await sb.from('spots').insert(payload));
    if (error && (error.message?.includes('column') || error.message?.includes('schema') || error.code==='PGRST204')) {
      const safe = {name:payload.name,cuisine:payload.cuisine,location:payload.location,recommended_by:payload.recommended_by,notes:payload.notes,visited:payload.visited,rating:payload.rating};
      if (editTarget) ({ error } = await sb.from('spots').update(safe).eq('id',editTarget.id));
      else            ({ error } = await sb.from('spots').insert(safe));
    }
    if (error) { showToast('Save failed: '+error.message); return; }
    setShowEdit(false); setShowImport(false); setEditTarget(null); setDetail(null);
    showToast(editTarget?'Updated':'Pinned');
    await loadSpots();
  }

  async function loadSpots() {
    await insertPending();
    const {data,error} = await sb.from('spots').select('*').order('created_at',{ascending:false});
    if (error) { showToast('Load error: '+error.message); return; }
    setRestaurants((data||[]).map(dbToApp));
    setLoading(false);
  }

  useEffect(()=>{ if (session) loadSpots(); },[session]);

  const filtered = useMemo(()=>{
    const q=search.toLowerCase();
    return restaurants.filter(r=>!q||
      r.name.toLowerCase().includes(q)||
      r.cuisine.toLowerCase().includes(q)||
      r.recommender.toLowerCase().includes(q)||
      (r.location||'').toLowerCase().includes(q));
  },[restaurants,search]);

  const wantList    = filtered.filter(r=>r.status==='want');
  const visitedList = filtered.filter(r=>r.status==='visited');

  async function handleMarkVisited(id) {
    const {error}=await sb.from('spots').update({visited:true}).eq('id',id);
    if (error) { showToast('Update failed'); return; }
    setRestaurants(rs=>rs.map(r=>r.id===id?{...r,status:'visited'}:r));
    setDetail(d=>d?.id===id?{...d,status:'visited'}:d);
    showToast('Marked as visited');
  }

  async function handleRate(id,rating) {
    const {error}=await sb.from('spots').update({rating,visited:true}).eq('id',id);
    if (error) { showToast('Rating failed'); return; }
    setRestaurants(rs=>rs.map(r=>r.id===id?{...r,rating,status:'visited'}:r));
    setDetail(d=>d?.id===id?{...d,rating,status:'visited'}:d);
    showToast(rating+'/5 — saved');
  }

  async function handleDelete(id) {
    const {error}=await sb.from('spots').delete().eq('id',id);
    if (error) { showToast('Delete failed: '+error.message); return; }
    setRestaurants(rs=>rs.filter(r=>r.id!==id));
    setDetail(null);
    showToast('Removed.');
  }

  const wantCount    = restaurants.filter(r=>r.status==='want').length;
  const visitedCount = restaurants.filter(r=>r.status==='visited').length;

  // Auth guards — show nothing until we know the auth state
  if (!authChecked) return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',background:C.bg}}>
      <p style={{fontFamily:C.ui,fontSize:14,color:C.dim}}>Loading…</p>
    </div>
  );
  if (!session) return <SignIn/>;

  return (<>
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=Inter:wght@300;400;500;600&display=swap');
      *{box-sizing:border-box;margin:0;padding:0;}
      body{background:${C.bg};-webkit-text-size-adjust:100%;}
      ::placeholder{color:${C.dim}!important;opacity:0.7;}
      ::-webkit-scrollbar{width:4px;}
      ::-webkit-scrollbar-track{background:transparent;}
      ::-webkit-scrollbar-thumb{background:rgba(0,0,0,0.12);border-radius:4px;}
      select option{background:${C.hi};}
      .leaflet-container{font-family:'Inter',system-ui,sans-serif!important;}
      @keyframes fadeIn{from{opacity:0}to{opacity:1}}
      @keyframes slideUp{from{opacity:0;transform:translateY(20px) scale(0.98)}to{opacity:1;transform:none}}
    `}</style>

    <div style={{minHeight:'100vh',display:'flex',flexDirection:'column',background:C.bg}}>

      {/* Header */}
      <div style={{position:'sticky',top:0,zIndex:50,background:'rgba(244,236,224,0.9)',backdropFilter:'blur(20px)',WebkitBackdropFilter:'blur(20px)',borderBottom:`1px solid ${C.bd}`}}>
        <div style={{maxWidth:560,margin:'0 auto',padding:'12px 16px 0'}}>

          {/* Title row */}
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
            <div>
              <h1 style={{fontFamily:C.display,fontSize:26,color:C.text,margin:0,letterSpacing:'-0.01em',lineHeight:1}}>PinPlate</h1>
              <p style={{fontFamily:C.ui,fontSize:11,color:C.dim,marginTop:3,fontWeight:400,display:'flex',alignItems:'center',gap:8}}>{wantCount} to visit · {visitedCount} visited<button onClick={()=>sb.auth.signOut()} style={{background:'none',border:'none',fontFamily:C.ui,fontSize:11,color:C.dim,cursor:'pointer',padding:0,textDecoration:'underline',textDecorationColor:'rgba(168,144,122,0.4)'}}>Sign out</button></p>
            </div>
            <div style={{display:'flex',gap:8,alignItems:'center',position:'relative'}}>
              <button onClick={()=>location.reload()} title="Refresh" style={{background:'transparent',border:`1px solid ${C.bd}`,borderRadius:10,padding:'8px 10px',color:C.mid,cursor:'pointer',display:'flex',alignItems:'center'}}>
                <Ic n="refresh" size={14}/>
              </button>
              <button onClick={()=>setShowAddMenu(v=>!v)} style={{background:C.espr,color:'#fdf8f3',border:'none',borderRadius:10,padding:'9px 16px',fontFamily:C.ui,fontSize:13,fontWeight:600,cursor:'pointer',letterSpacing:'0.01em'}}>+ Add</button>
              {showAddMenu&&(
                <div style={{position:'absolute',top:'calc(100% + 8px)',right:0,background:C.hi,borderRadius:14,border:`1px solid ${C.bd}`,boxShadow:'0 8px 28px rgba(0,0,0,0.12)',padding:6,zIndex:100,minWidth:190,animation:'slideUp 0.15s ease'}} onClick={e=>e.stopPropagation()}>
                  <button onClick={()=>{setShowAddMenu(false);setEditTarget(null);setShowEdit(true);}} style={{width:'100%',padding:'10px 14px',border:'none',background:'none',textAlign:'left',fontFamily:C.ui,fontSize:13,fontWeight:500,color:C.text,cursor:'pointer',borderRadius:8,display:'flex',gap:10,alignItems:'center'}}><Ic n="edit" size={15}/>Add manually</button>
                  <button onClick={()=>{setShowAddMenu(false);setShowImport(true);}} style={{width:'100%',padding:'10px 14px',border:'none',background:'none',textAlign:'left',fontFamily:C.ui,fontSize:13,fontWeight:500,color:C.text,cursor:'pointer',borderRadius:8,display:'flex',gap:10,alignItems:'center'}}><Ic n="pin" size={15}/>Import from Maps</button>
                </div>
              )}
            </div>
          </div>

          {/* Tabs */}
          <div style={{display:'flex',gap:0,borderBottom:`1px solid transparent`}}>
            {[{k:'home',l:'List'},{k:'map',l:'Map'}].map(t=>(
              <button key={t.k} onClick={()=>setTab(t.k)} style={{padding:'8px 20px 10px',border:'none',background:'none',cursor:'pointer',fontFamily:C.ui,fontSize:13,fontWeight:tab===t.k?600:400,color:tab===t.k?C.text:C.dim,borderBottom:`2px solid ${tab===t.k?C.amber:'transparent'}`,transition:'all 0.15s',marginBottom:-1}}>{t.l}</button>
            ))}
          </div>

        </div>

        {/* Search (list view only) */}
        {tab==='home'&&(
          <div style={{maxWidth:560,margin:'0 auto',padding:'10px 16px 12px'}}>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search restaurants, cuisine, city…" style={{width:'100%',padding:'9px 14px',background:C.hi,border:`1px solid ${C.bd}`,borderRadius:10,color:C.text,fontFamily:C.ui,fontSize:13,outline:'none',boxShadow:'0 1px 3px rgba(0,0,0,0.04)'}}/>
          </div>
        )}
      </div>

      {/* List view */}
      {tab==='home'&&(
        loading
          ?<div style={{textAlign:'center',padding:'70px 0'}}><p style={{fontFamily:C.ui,fontSize:14,color:C.dim,fontWeight:400}}>Loading…</p></div>
          :<Feed restaurants={filtered} onCardClick={setDetail}/>
      )}

      {/* Map view */}
      {tab==='map'&&!loading&&(
        <MapView spots={restaurants} onMarkerClick={r=>setDetail(r)}/>
      )}
    </div>

    {showAddMenu&&<div style={{position:'fixed',inset:0,zIndex:40}} onClick={()=>setShowAddMenu(false)}/>}

    {detail&&<DetailPanel r={detail} onClose={()=>setDetail(null)} onEdit={r=>{setEditTarget(r);setDetail(null);setShowEdit(true);}} onMarkVisited={handleMarkVisited} onRate={handleRate} onDelete={handleDelete}/>}
    {showEdit&&<EditModal onClose={()=>{setShowEdit(false);setEditTarget(null);}} onSave={handleSave} editData={editTarget}/>}
    {showImport&&<ImportModal onClose={()=>setShowImport(false)} onImport={handleSave}/>}

    {toast&&<div style={{position:'fixed',bottom:'calc(24px + env(safe-area-inset-bottom))',left:'50%',transform:'translateX(-50%)',background:C.espr,color:'#fdf8f3',padding:'10px 20px',borderRadius:50,fontFamily:C.ui,fontSize:13,fontWeight:500,zIndex:9999,boxShadow:'0 4px 20px rgba(0,0,0,0.2)',animation:'slideUp 0.2s ease',maxWidth:'calc(100vw - 32px)',textAlign:'center'}}>{toast}</div>}
  </>);
}
