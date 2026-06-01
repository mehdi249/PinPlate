const { useState, useMemo, useEffect, useRef } = React;

const SUPABASE_URL = 'https://biafijftxhealzmmwsmk.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJpYWZpamZ0eGhlYWx6bW13c21rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAyNTQ3NjYsImV4cCI6MjA5NTgzMDc2Nn0.el4_ujwNYvbYdFtvzAEooKd1SvZlJd5YGVdlGlSo6Q8';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const CUISINES = ["Italian","Japanese","Mexican","Thai","Indian","French","Chinese","Mediterranean","American","Korean","Vietnamese","Middle Eastern","Other"];

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
    html.match(/content="([^"]+)"[^>]+property="og:title"/i)?.[1]?.trim() || '';
  const latM = html.match(/"latitude"\s*:\s*(-?\d+\.\d+)/) || html.match(/itemprop="latitude"[^>]+content="(-?\d+\.\d+)"/i);
  const lngM = html.match(/"longitude"\s*:\s*(-?\d+\.\d+)/) || html.match(/itemprop="longitude"[^>]+content="(-?\d+\.\d+)"/i);
  return { name, lat: latM?parseFloat(latM[1]):null, lng: lngM?parseFloat(lngM[1]):null };
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

// ── StarRating ───────────────────────────────────────────────
const StarRating = ({ value, onChange, readonly, size=16 }) => (
  <div style={{display:'flex',gap:'2px'}}>
    {[1,2,3,4,5].map(n=>(
      <span key={n} onClick={()=>!readonly&&onChange&&onChange(n)} style={{
        fontSize:`${size}px`, cursor:readonly?'default':'pointer',
        color:n<=(value||0)?'#c8773a':'rgba(180,140,110,0.25)',
        transition:'color 0.15s', userSelect:'none',
      }}>★</span>
    ))}
  </div>
);

// ── Map view ─────────────────────────────────────────────────
const MapView = ({ spots, onMarkerClick }) => {
  const el          = useRef(null);
  const map         = useRef(null);
  const marks       = useRef({});
  const locateMarker = useRef(null);

  useEffect(()=>{
    if (map.current) return;
    map.current = L.map(el.current,{ center:[40.7128,-74.006], zoom:12 });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
      attribution:'© OpenStreetMap contributors', maxZoom:19,
    }).addTo(map.current);
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
      const bg = visited?'#5a9a6a':'#c8773a';
      const icon = L.divIcon({
        html:`<div style="width:30px;height:30px;background:${bg};border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:2.5px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.28);display:flex;align-items:center;justify-content:center"><span style="transform:rotate(45deg);color:#fff;font-size:12px;font-weight:700;line-height:25px;display:block;text-align:center">${visited?'✓':'+'}</span></div>`,
        iconSize:[30,42], iconAnchor:[15,42], className:'',
      });
      const mk = L.marker([r.lat,r.lng],{icon})
        .addTo(map.current)
        .bindPopup(`<div style="font-family:serif;min-width:140px"><strong style="font-size:14px">${r.name}</strong><br/><span style="font-size:11px;color:${bg}">${r.cuisine}</span>${r.location?`<br/><span style="font-size:11px;color:#666">📍 ${r.location}</span>`:''}</div>`);
      mk.on('click',()=>{ mk.openPopup(); onMarkerClick(r); });
      marks.current[r.id]=mk;
      bounds.push([r.lat,r.lng]);
    });
    if (bounds.length) map.current.fitBounds(bounds,{padding:[50,50],maxZoom:14});
  },[spots]);

  const mappable = spots.filter(r=>r.lat&&r.lng);
  const unmapped = spots.filter(r=>!r.lat||!r.lng);

  return (
    <div style={{flex:1,position:'relative'}}>
      <div ref={el} style={{width:'100%',height:'calc(100vh - 120px)'}}/>
      {/* Locate Me */}
      <button onClick={()=>{
        if (!navigator.geolocation) { alert('Location not supported by this browser'); return; }
        navigator.geolocation.getCurrentPosition(pos=>{
          const {latitude:lat,longitude:lng}=pos.coords;
          map.current.setView([lat,lng],15);
          if (locateMarker.current) locateMarker.current.remove();
          locateMarker.current=L.circleMarker([lat,lng],{radius:8,fillColor:'#4a90d9',color:'#fff',weight:2.5,opacity:1,fillOpacity:1}).addTo(map.current).bindPopup('📍 You are here');
        },()=>alert('Location access denied. Please allow location in your browser settings.'));
      }} style={{position:'absolute',bottom:24,left:12,zIndex:1000,background:'rgba(255,248,240,0.95)',backdropFilter:'blur(12px)',WebkitBackdropFilter:'blur(12px)',border:'1px solid rgba(180,140,110,0.3)',borderRadius:10,padding:'9px 14px',fontFamily:"'Lora',serif",fontSize:13,color:'#1e0e04',cursor:'pointer',boxShadow:'0 2px 12px rgba(0,0,0,0.12)',display:'flex',alignItems:'center',gap:6}}>🎯 Locate Me</button>
      {/* Legend */}
      <div style={{position:'absolute',top:12,right:12,background:'rgba(255,248,240,0.92)',backdropFilter:'blur(12px)',borderRadius:12,padding:'10px 14px',border:'1px solid rgba(180,140,110,0.2)',zIndex:1000,boxShadow:'0 2px 12px rgba(0,0,0,0.1)'}}>
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
          <div style={{width:12,height:12,background:'#c8773a',borderRadius:'50%'}}/>
          <span style={{fontFamily:"'Lora',serif",fontSize:12,color:'#1e0e04'}}>Want to try</span>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <div style={{width:12,height:12,background:'#5a9a6a',borderRadius:'50%'}}/>
          <span style={{fontFamily:"'Lora',serif",fontSize:12,color:'#1e0e04'}}>Visited</span>
        </div>
        {unmapped.length>0&&<p style={{fontFamily:"'Lora',serif",fontSize:10,color:'rgba(100,70,40,0.4)',marginTop:8,borderTop:'1px solid rgba(180,140,110,0.2)',paddingTop:6}}>{unmapped.length} spot{unmapped.length>1?'s':''} without location</p>}
      </div>
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
    const isShort = rawUrl.includes('share.google') || rawUrl.includes('maps.app.goo.gl') || rawUrl.includes('goo.gl/maps');
    setBusy(true);
    let resolved = rawUrl;
    let htmlData = { name:'', lat:null, lng:null };
    if (isShort) {
      const race = p => Promise.race([p, new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),10000))]);
      try {
        const d = await race(fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(rawUrl)}`).then(r=>r.json()));
        if (d.status?.url) resolved = d.status.url;
        if (d.contents)    htmlData = parseGoogleMapsHtml(d.contents);
      } catch(e1) {
        try {
          const html = await race(fetch(`https://corsproxy.io/?${encodeURIComponent(rawUrl)}`).then(r=>r.text()));
          htmlData = parseGoogleMapsHtml(html);
          const m = html.match(/"(https?:\/\/(?:www\.)?google\.com\/maps\/[^"]{20,})"/);
          if (m) resolved = m[1].replace(/\\u003d/g,'=').replace(/\\u0026/g,'&');
        } catch(e2) { /* both failed — fall through */ }
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
      lat:parsed.lat, lng:parsed.lng, googleMapsUrl:resolved,
    };
    if (isShort && parsed.name) {
      onImport(base);
    } else {
      setForm(base);
      setStep('preview');
    }
    setBusy(false);
  }

  const inp = {width:'100%',padding:'10px 13px',background:'rgba(200,160,120,0.12)',border:'1px solid rgba(180,140,110,0.28)',borderRadius:10,fontFamily:"'Lora',serif",fontSize:14,color:'#1e0e04',outline:'none',boxSizing:'border-box'};
  const lbl = {display:'block',fontFamily:"'DM Serif Display',serif",fontSize:11,letterSpacing:'0.08em',color:'rgba(100,70,40,0.55)',marginBottom:5,textTransform:'uppercase'};
  const canSave = form?.name?.trim();

  return (
    <div style={{position:'fixed',inset:0,zIndex:300,background:'rgba(20,12,6,0.5)',backdropFilter:'blur(8px)',WebkitBackdropFilter:'blur(8px)',display:'flex',alignItems:'center',justifyContent:'center',padding:20,animation:'fadeIn 0.2s ease'}} onClick={onClose}>
      <div style={{width:'100%',maxWidth:440,maxHeight:'88vh',overflowY:'auto',borderRadius:22,background:'rgba(255,248,240,0.92)',backdropFilter:'blur(32px)',WebkitBackdropFilter:'blur(32px)',border:'1px solid rgba(255,255,255,0.7)',boxShadow:'0 24px 64px rgba(30,14,4,0.2)',padding:28,animation:'slideUp 0.25s cubic-bezier(0.34,1.4,0.64,1)'}} onClick={e=>e.stopPropagation()}>

        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
          <h2 style={{fontFamily:"'DM Serif Display',serif",fontSize:20,color:'#1e0e04',margin:0}}>
            {step==='paste'?'Import from Google Maps':'Confirm Details'}
          </h2>
          <button onClick={onClose} style={{background:'rgba(180,140,110,0.15)',border:'1px solid rgba(180,140,110,0.25)',color:'rgba(100,70,40,0.5)',borderRadius:'50%',width:30,height:30,cursor:'pointer',fontSize:13,display:'flex',alignItems:'center',justifyContent:'center'}}>✕</button>
        </div>

        {step==='paste' && (<>
          <p style={{fontFamily:"'Lora',serif",fontSize:13,color:'rgba(100,70,40,0.6)',marginBottom:10,lineHeight:1.6}}>
            Paste any Google Maps link below and tap Import.
          </p>
          <div style={{background:'rgba(200,119,58,0.08)',border:'1px solid rgba(200,119,58,0.2)',borderRadius:10,padding:'10px 13px',marginBottom:14}}>
            <p style={{fontFamily:"'Lora',serif",fontSize:12,color:'rgba(100,70,40,0.7)',lineHeight:1.7,margin:0}}>
              <strong>Best results:</strong> In Google Maps, tap the restaurant → tap <strong>Share</strong> → choose <strong>Safari</strong> → long-press the address bar → <strong>Copy</strong>. This gives a full URL with all details.
            </p>
          </div>
          <div style={{marginBottom:16}}>
            <label style={lbl}>Google Maps Link</label>
            <input style={inp} value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://maps.app.goo.gl/… or maps.google.com/…" autoFocus/>
          </div>
          <div style={{display:'flex',gap:10}}>
            <button onClick={onClose} style={{flex:1,padding:11,borderRadius:10,background:'rgba(180,140,110,0.1)',border:'1px solid rgba(180,140,110,0.2)',color:'rgba(100,70,40,0.5)',fontFamily:"'DM Serif Display',serif",fontSize:14,cursor:'pointer'}}>Cancel</button>
            <button onClick={handleParse} disabled={busy} style={{flex:2,padding:11,borderRadius:10,background:url&&!busy?'#2c1f14':'rgba(180,140,110,0.12)',border:'none',color:url&&!busy?'#fdf8f3':'rgba(100,70,40,0.3)',fontFamily:"'DM Serif Display',serif",fontSize:14,cursor:url&&!busy?'pointer':'default'}}>{busy?'Importing…':'Import →'}</button>
          </div>
        </>)}

        {step==='preview' && form && (<>
          {busy&&<p style={{fontFamily:"'Lora',serif",fontSize:12,color:'#c8773a',marginBottom:12}}>📍 Getting address…</p>}
          <div style={{display:'flex',flexDirection:'column',gap:13}}>
            <div><label style={lbl}>Restaurant Name *</label><input style={inp} value={form.name} onChange={e=>set('name',e.target.value)}/></div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
              <div><label style={lbl}>Cuisine</label>
                <select style={{...inp,cursor:'pointer'}} value={form.cuisine} onChange={e=>set('cuisine',e.target.value)}>
                  {CUISINES.map(c=><option key={c}>{c}</option>)}
                </select>
              </div>
              <div><label style={lbl}>Recommended By</label><input style={inp} value={form.recommender} onChange={e=>set('recommender',e.target.value)} placeholder="e.g. Sarah"/></div>
            </div>
            <div><label style={lbl}>Location</label><input style={inp} value={form.location} onChange={e=>set('location',e.target.value)}/></div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
              <div><label style={lbl}>Website</label><input style={inp} value={form.website} onChange={e=>set('website',e.target.value)} placeholder="restaurant.com"/></div>
              <div><label style={lbl}>Phone</label><input style={inp} value={form.phone} onChange={e=>set('phone',e.target.value)} placeholder="+1 (212) 000-0000"/></div>
            </div>
            <div><label style={lbl}>Notes</label><textarea style={{...inp,resize:'vertical',minHeight:60}} value={form.note} onChange={e=>set('note',e.target.value)} placeholder="What to order, tips…"/></div>
            {form.lat&&form.lng&&(
              <div style={{background:'rgba(90,154,106,0.1)',border:'1px solid rgba(90,154,106,0.25)',borderRadius:10,padding:'9px 12px'}}>
                <p style={{fontFamily:"'Lora',serif",fontSize:12,color:'#3d7a4f',margin:0}}>✓ Coordinates found — will appear on map</p>
              </div>
            )}
          </div>
          <div style={{display:'flex',gap:10,marginTop:20}}>
            <button onClick={()=>setStep('paste')} style={{flex:1,padding:11,borderRadius:10,background:'rgba(180,140,110,0.1)',border:'1px solid rgba(180,140,110,0.2)',color:'rgba(100,70,40,0.5)',fontFamily:"'DM Serif Display',serif",fontSize:14,cursor:'pointer'}}>← Back</button>
            <button onClick={()=>canSave&&onImport(form)} style={{flex:2,padding:11,borderRadius:10,background:canSave?'#2c1f14':'rgba(180,140,110,0.12)',border:'none',color:canSave?'#fdf8f3':'rgba(100,70,40,0.3)',fontFamily:"'DM Serif Display',serif",fontSize:14,cursor:canSave?'pointer':'default',transition:'all 0.2s'}}>📍 Pin It</button>
          </div>
        </>)}
      </div>
    </div>
  );
};

// ── Detail panel ─────────────────────────────────────────────
const DetailPanel = ({ r, onClose, onEdit, onMarkVisited, onRate }) => {
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

  const photos = (r.photos||[]).filter(p=>typeof p==='string'&&p.startsWith('http'));
  const actionBtns = [
    r.phone&&{label:'Call',icon:'📞',fn:call},
    {label:'Directions',icon:'🧭',fn:directions},
    r.website&&{label:'Website',icon:'🌐',fn:()=>openUrl(r.website)},
    {label:'Menu',icon:'📋',fn:menu},
    {label:'Share',icon:'📤',fn:share},
  ].filter(Boolean);

  const row = (icon,content,onTap) => (
    <button onClick={onTap||undefined} style={{width:'100%',display:'flex',alignItems:'center',gap:16,padding:'15px 18px',background:'none',border:'none',cursor:onTap?'pointer':'default',textAlign:'left',borderBottom:'1px solid rgba(180,140,110,0.12)'}}>
      <span style={{fontSize:19,flexShrink:0,width:24,textAlign:'center'}}>{icon}</span>
      <div style={{flex:1,minWidth:0}}>{content}</div>
      {onTap&&<span style={{color:'rgba(100,70,40,0.3)',fontSize:16,flexShrink:0}}>›</span>}
    </button>
  );

  return (
    <div style={{position:'fixed',inset:0,zIndex:200,background:'rgba(20,12,6,0.45)',backdropFilter:'blur(4px)',WebkitBackdropFilter:'blur(4px)',animation:'fadeIn 0.2s ease'}} onClick={onClose}>
      <div style={{position:'fixed',bottom:0,left:0,right:0,maxHeight:'92vh',borderRadius:'22px 22px 0 0',background:'rgba(255,250,244,0.98)',backdropFilter:'blur(40px)',WebkitBackdropFilter:'blur(40px)',boxShadow:'0 -8px 48px rgba(30,14,4,0.18)',overflowY:'auto',animation:'slideUp 0.3s cubic-bezier(0.34,1.1,0.64,1)'}} onClick={e=>e.stopPropagation()}>

        {/* Drag handle + close */}
        <div style={{position:'sticky',top:0,zIndex:10,background:'rgba(255,250,244,0.95)',backdropFilter:'blur(20px)',WebkitBackdropFilter:'blur(20px)',padding:'12px 18px 0',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
          <div style={{flex:1}}/>
          <div style={{width:36,height:4,borderRadius:2,background:'rgba(180,140,110,0.35)'}}/>
          <div style={{flex:1,display:'flex',justifyContent:'flex-end'}}>
            <button onClick={onClose} style={{background:'rgba(180,140,110,0.15)',border:'none',color:'rgba(100,70,40,0.6)',borderRadius:'50%',width:30,height:30,cursor:'pointer',fontSize:13,display:'flex',alignItems:'center',justifyContent:'center'}}>✕</button>
          </div>
        </div>

        {/* Photos */}
        {photos.length>0?(
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:2,margin:'10px 0 0'}}>
            {photos.slice(0,6).map((p,i)=><img key={i} src={p} style={{width:'100%',aspectRatio:'1',objectFit:'cover'}} alt=""/>)}
          </div>
        ):(
          <div style={{margin:'10px 18px 0',height:130,background:'linear-gradient(135deg,rgba(200,160,120,0.18),rgba(200,160,120,0.08))',borderRadius:14,display:'flex',alignItems:'center',justifyContent:'center',border:'1px solid rgba(180,140,110,0.15)'}}>
            <span style={{fontSize:44,opacity:0.25}}>🍽</span>
          </div>
        )}

        {/* Name + meta */}
        <div style={{padding:'18px 18px 14px',borderBottom:'1px solid rgba(180,140,110,0.13)'}}>
          <h2 style={{fontFamily:"'DM Serif Display',serif",fontSize:26,color:'#1e0e04',margin:'0 0 8px',lineHeight:1.1}}>{r.name}</h2>
          <div style={{display:'flex',alignItems:'center',gap:7,flexWrap:'wrap'}}>
            {r.rating&&<><span style={{fontFamily:"'Lora',serif",fontWeight:600,fontSize:14,color:'#c8773a'}}>{r.rating}.0</span><StarRating value={r.rating} readonly size={13}/><span style={{color:'rgba(120,80,40,0.35)'}}>·</span></>}
            {r.priceRange&&<><span style={{fontFamily:"'Lora',serif",fontSize:13,color:'rgba(100,70,40,0.65)'}}>{r.priceRange}</span><span style={{color:'rgba(120,80,40,0.35)'}}>·</span></>}
            <span style={{fontFamily:"'Lora',serif",fontSize:13,color:'#c8773a'}}>{r.cuisine}</span>
            <span style={{color:'rgba(120,80,40,0.35)'}}>·</span>
            <span style={{fontFamily:"'Lora',serif",fontSize:13,color:r.status==='visited'?'#5a9a6a':'#b8873a'}}>{r.status==='visited'?'✓ Visited':'◎ Want to Try'}</span>
          </div>
        </div>

        {/* Action buttons */}
        <div style={{display:'flex',gap:10,padding:'14px 18px',overflowX:'auto',borderBottom:'1px solid rgba(180,140,110,0.13)',WebkitOverflowScrolling:'touch'}}>
          {actionBtns.map(b=>(
            <button key={b.label} onClick={b.fn} style={{display:'flex',flexDirection:'column',alignItems:'center',gap:7,background:'rgba(200,160,120,0.13)',border:'1px solid rgba(180,140,110,0.22)',borderRadius:16,padding:'13px 18px',cursor:'pointer',flexShrink:0,minWidth:68,transition:'background 0.15s'}}>
              <span style={{fontSize:22}}>{b.icon}</span>
              <span style={{fontFamily:"'Lora',serif",fontSize:11,color:'rgba(50,28,8,0.75)',whiteSpace:'nowrap'}}>{b.label}</span>
            </button>
          ))}
        </div>

        {/* Info rows */}
        <div style={{paddingBottom:8}}>

          {r.location&&row('📍',
            <><p style={{fontFamily:"'Lora',serif",fontSize:14,color:'#1e0e04'}}>{r.location}</p><p style={{fontFamily:"'Lora',serif",fontSize:12,color:'rgba(100,70,40,0.45)',marginTop:1}}>Open in Google Maps</p></>,
            openInMaps
          )}

          {r.hours?.length>0&&(
            <div style={{borderBottom:'1px solid rgba(180,140,110,0.12)'}}>
              <button onClick={()=>setHoursOpen(v=>!v)} style={{width:'100%',display:'flex',alignItems:'center',gap:16,padding:'15px 18px',background:'none',border:'none',cursor:'pointer',textAlign:'left'}}>
                <span style={{fontSize:19,width:24,textAlign:'center',flexShrink:0}}>🕐</span>
                <span style={{fontFamily:"'Lora',serif",fontSize:14,color:'#1e0e04',flex:1}}>Hours</span>
                <span style={{color:'rgba(100,70,40,0.4)',fontSize:14,transition:'transform 0.2s',display:'inline-block',transform:hoursOpen?'rotate(90deg)':'none'}}>›</span>
              </button>
              {hoursOpen&&(
                <div style={{padding:'0 18px 14px 58px'}}>
                  {r.hours.map((h,i)=>(
                    <div key={i} style={{display:'flex',justifyContent:'space-between',padding:'4px 0',borderBottom:i<r.hours.length-1?'1px solid rgba(180,140,110,0.08)':'none'}}>
                      <span style={{fontFamily:"'Lora',serif",fontSize:13,color:'rgba(60,35,14,0.55)'}}>{h.day}</span>
                      <span style={{fontFamily:"'Lora',serif",fontSize:13,color:h.time==='Closed'?'#b05050':'#3d7a4f',fontWeight:500}}>{h.time}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {r.phone&&row('📞',
            <span style={{fontFamily:"'Lora',serif",fontSize:14,color:'#c8773a'}}>{r.phone}</span>,
            call
          )}

          {r.website&&row('🌐',
            <span style={{fontFamily:"'Lora',serif",fontSize:14,color:'#c8773a',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',display:'block'}}>{r.website.replace(/^https?:\/\//,'')}</span>,
            ()=>openUrl(r.website)
          )}

          {r.note&&row('💬',
            <><p style={{fontFamily:"'Lora',serif",fontSize:12,color:'rgba(100,70,40,0.45)',marginBottom:3}}>Note{r.recommender?' from '+r.recommender:''}</p><p style={{fontFamily:"'Lora',serif",fontSize:14,color:'rgba(30,14,4,0.8)',fontStyle:'italic',lineHeight:1.5}}>"{r.note}"</p></>
          )}

          {r.recommender&&row('👤',
            <><p style={{fontFamily:"'Lora',serif",fontSize:12,color:'rgba(100,70,40,0.45)',marginBottom:2}}>Recommended by</p><p style={{fontFamily:"'Lora',serif",fontSize:14,color:'#1e0e04'}}>{r.recommender}</p></>
          )}

          {/* Your rating */}
          <div style={{display:'flex',alignItems:'center',gap:16,padding:'15px 18px',borderBottom:'1px solid rgba(180,140,110,0.12)'}}>
            <span style={{fontSize:19,width:24,textAlign:'center',flexShrink:0}}>⭐</span>
            <div>
              <p style={{fontFamily:"'Lora',serif",fontSize:12,color:'rgba(100,70,40,0.45)',marginBottom:6}}>Your rating</p>
              <StarRating value={r.rating} onChange={v=>onRate(r.id,v)} size={28}/>
            </div>
          </div>
        </div>

        {/* Bottom actions */}
        <div style={{display:'flex',gap:10,padding:'12px 18px 36px'}}>
          {r.status==='want'&&(
            <button onClick={()=>onMarkVisited(r.id)} style={{flex:2,padding:14,borderRadius:14,background:'rgba(90,154,106,0.15)',border:'1.5px solid rgba(90,154,106,0.3)',color:'#3d7a4f',fontFamily:"'DM Serif Display',serif",fontSize:15,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:6}}>✓ Mark as Visited</button>
          )}
          <button onClick={()=>onEdit(r)} style={{flex:1,padding:14,borderRadius:14,background:'rgba(180,140,110,0.12)',border:'1px solid rgba(180,140,110,0.25)',color:'rgba(60,35,14,0.7)',fontFamily:"'DM Serif Display',serif",fontSize:15,cursor:'pointer'}}>✏️ Edit</button>
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
  const inp={width:'100%',padding:'10px 13px',background:'rgba(200,160,120,0.12)',border:'1px solid rgba(180,140,110,0.28)',borderRadius:10,fontFamily:"'Lora',serif",fontSize:14,color:'#1e0e04',outline:'none',boxSizing:'border-box'};
  const lbl={display:'block',fontFamily:"'DM Serif Display',serif",fontSize:11,letterSpacing:'0.08em',color:'rgba(100,70,40,0.55)',marginBottom:5,textTransform:'uppercase'};
  const ok=form.name.trim()&&form.recommender.trim();
  return (
    <div style={{position:'fixed',inset:0,zIndex:300,background:'rgba(20,12,6,0.5)',backdropFilter:'blur(8px)',WebkitBackdropFilter:'blur(8px)',display:'flex',alignItems:'center',justifyContent:'center',padding:20,animation:'fadeIn 0.2s ease'}} onClick={onClose}>
      <div style={{width:'100%',maxWidth:440,maxHeight:'88vh',overflowY:'auto',borderRadius:22,background:'rgba(255,248,240,0.92)',backdropFilter:'blur(32px)',WebkitBackdropFilter:'blur(32px)',border:'1px solid rgba(255,255,255,0.7)',boxShadow:'0 24px 64px rgba(30,14,4,0.2)',padding:28,animation:'slideUp 0.25s cubic-bezier(0.34,1.4,0.64,1)'}} onClick={e=>e.stopPropagation()}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:22}}>
          <h2 style={{fontFamily:"'DM Serif Display',serif",fontSize:20,color:'#1e0e04',margin:0}}>{editData?'Edit Restaurant':'Add Manually'}</h2>
          <button onClick={onClose} style={{background:'rgba(180,140,110,0.15)',border:'1px solid rgba(180,140,110,0.25)',color:'rgba(100,70,40,0.5)',borderRadius:'50%',width:30,height:30,cursor:'pointer',fontSize:13,display:'flex',alignItems:'center',justifyContent:'center'}}>✕</button>
        </div>
        <div style={{display:'flex',flexDirection:'column',gap:13}}>
          <div><label style={lbl}>Restaurant Name *</label><input style={inp} value={form.name} onChange={e=>set('name',e.target.value)} placeholder="e.g. Chez Pierre"/></div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <div><label style={lbl}>Cuisine</label><select style={{...inp,cursor:'pointer'}} value={form.cuisine} onChange={e=>set('cuisine',e.target.value)}>{CUISINES.map(c=><option key={c}>{c}</option>)}</select></div>
            <div><label style={lbl}>Recommended By *</label><input style={inp} value={form.recommender} onChange={e=>set('recommender',e.target.value)} placeholder="e.g. Sarah"/></div>
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
            <div style={{display:'flex',gap:10}}>
              {['want','visited'].map(s=>(
                <button key={s} onClick={()=>set('status',s)} style={{flex:1,padding:10,borderRadius:10,border:`1.5px solid ${form.status===s?'#c8773a':'rgba(180,140,110,0.25)'}`,background:form.status===s?'rgba(200,119,58,0.1)':'transparent',color:form.status===s?'#c8773a':'rgba(100,70,40,0.45)',fontFamily:"'DM Serif Display',serif",fontSize:13,cursor:'pointer',transition:'all 0.15s'}}>
                  {s==='want'?'◎ Want to Try':'✓ Been There'}
                </button>
              ))}
            </div>
          </div>
          {form.status==='visited'&&<div><label style={lbl}>Your Rating</label><StarRating value={form.rating} onChange={v=>set('rating',v)} size={22}/></div>}
        </div>
        <div style={{display:'flex',gap:10,marginTop:22}}>
          <button onClick={onClose} style={{flex:1,padding:11,borderRadius:10,background:'rgba(180,140,110,0.1)',border:'1px solid rgba(180,140,110,0.2)',color:'rgba(100,70,40,0.5)',fontFamily:"'DM Serif Display',serif",fontSize:14,cursor:'pointer'}}>Cancel</button>
          <button onClick={()=>ok&&onSave(form)} style={{flex:2,padding:11,borderRadius:10,background:ok?'#2c1f14':'rgba(180,140,110,0.12)',border:'none',color:ok?'#fdf8f3':'rgba(100,70,40,0.3)',fontFamily:"'DM Serif Display',serif",fontSize:14,cursor:ok?'pointer':'default',transition:'all 0.2s'}}>Save Restaurant</button>
        </div>
      </div>
    </div>
  );
};

// ── Card ─────────────────────────────────────────────────────
const Card = ({ r, onClick }) => {
  function nav(e) {
    e.stopPropagation();
    const q=r.lat&&r.lng?`${r.lat},${r.lng}`:encodeURIComponent([r.name,r.location].filter(Boolean).join(' '));
    window.open(`https://maps.google.com/maps?daddr=${q}`,'_blank');
  }
  function site(e) {
    e.stopPropagation();
    const url=r.website.startsWith('http')?r.website:'https://'+r.website;
    window.open(url,'_blank');
  }
  return (
    <div onClick={onClick} style={{background:'rgba(255,248,240,0.6)',backdropFilter:'blur(20px)',WebkitBackdropFilter:'blur(20px)',border:'1px solid rgba(255,255,255,0.5)',borderRadius:14,padding:'14px 15px',cursor:'pointer',boxShadow:'0 2px 12px rgba(30,14,4,0.07), inset 0 1px 0 rgba(255,255,255,0.7)',transition:'transform 0.18s, box-shadow 0.18s'}}
    onMouseEnter={e=>{e.currentTarget.style.transform='translateY(-2px)';e.currentTarget.style.boxShadow='0 6px 24px rgba(30,14,4,0.11), inset 0 1px 0 rgba(255,255,255,0.8)';}}
    onMouseLeave={e=>{e.currentTarget.style.transform='';e.currentTarget.style.boxShadow='0 2px 12px rgba(30,14,4,0.07), inset 0 1px 0 rgba(255,255,255,0.7)';}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:5}}>
        <h3 style={{fontFamily:"'DM Serif Display',serif",fontSize:15,color:'#1e0e04',margin:0,lineHeight:1.2,flex:1,minWidth:0,paddingRight:8}}>{r.name}</h3>
        {r.status==='visited'&&r.rating&&<StarRating value={r.rating} readonly size={11}/>}
      </div>
      <div style={{display:'flex',gap:4,alignItems:'center',flexWrap:'wrap',marginBottom:6}}>
        <span style={{fontSize:10,color:'#c8773a',fontFamily:"'Lora',serif",letterSpacing:'0.05em'}}>{r.cuisine}</span>
        {r.location&&<><span style={{color:'rgba(120,80,40,0.3)',fontSize:9}}>·</span><span style={{fontSize:10,color:'rgba(100,70,40,0.45)',fontFamily:"'Lora',serif",overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:110,display:'inline-block'}}>📍 {r.location}</span></>}
      </div>
      {r.note&&<p style={{fontFamily:"'Lora',serif",fontSize:11,color:'rgba(60,35,14,0.5)',margin:'0 0 8px',fontStyle:'italic',lineHeight:1.4,overflow:'hidden',display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical'}}>"{r.note}"</p>}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <span style={{fontSize:10,color:'rgba(100,70,40,0.4)',fontFamily:"'Lora',serif"}}>by <span style={{color:'#c8773a'}}>{r.recommender}</span></span>
        <div style={{display:'flex',gap:4}}>
          <button onClick={nav} title="Directions" style={{padding:'4px 8px',borderRadius:6,background:'rgba(200,119,58,0.12)',border:'1px solid rgba(200,119,58,0.2)',color:'#c8773a',fontSize:11,cursor:'pointer'}}>🧭</button>
          {r.website&&<button onClick={site} title="Website" style={{padding:'4px 8px',borderRadius:6,background:'rgba(180,140,110,0.1)',border:'1px solid rgba(180,140,110,0.2)',color:'rgba(60,35,14,0.6)',fontSize:11,cursor:'pointer'}}>🌐</button>}
        </div>
      </div>
    </div>
  );
};

// ── Column ───────────────────────────────────────────────────
const Column = ({ title, icon, items, onCardClick }) => (
  <div style={{flex:1,minWidth:0}}>
    <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:12}}>
      <span style={{fontSize:13}}>{icon}</span>
      <h2 style={{fontFamily:"'DM Serif Display',serif",fontSize:15,color:'#1e0e04',margin:0,flex:1}}>{title}</h2>
      <span style={{fontSize:11,fontFamily:"'Lora',serif",color:'rgba(100,70,40,0.4)',background:'rgba(180,140,110,0.15)',borderRadius:20,padding:'2px 8px'}}>{items.length}</span>
    </div>
    <div style={{display:'flex',flexDirection:'column',gap:8}}>
      {items.length===0?(
        <div style={{textAlign:'center',padding:'28px 12px',background:'rgba(255,248,240,0.3)',borderRadius:12,border:'1px dashed rgba(180,140,110,0.3)'}}>
          <p style={{fontFamily:"'Lora',serif",fontSize:12,color:'rgba(100,70,40,0.35)'}}>Nothing yet</p>
        </div>
      ):items.map(r=><Card key={r.id} r={r} onClick={()=>onCardClick(r)}/>)}
    </div>
  </div>
);

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
];

// ── App ──────────────────────────────────────────────────────
function App() {
  const [restaurants,setRestaurants] = useState([]);
  const [loading,setLoading]         = useState(true);
  const [tab,setTab]                 = useState('home');
  const [showEdit,setShowEdit]       = useState(false);
  const [showImport,setShowImport]   = useState(false);
  const [showAddMenu,setShowAddMenu] = useState(false);
  const [editTarget,setEditTarget]   = useState(null);
  const [detail,setDetail]           = useState(null);
  const [search,setSearch]           = useState('');
  const [toast,setToast]             = useState(null);

  function showToast(msg) { setToast(msg); setTimeout(()=>setToast(null),2500); }

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
    showToast(editTarget?'Updated!':'Pinned! 📍');
    await loadSpots();
  }

  async function loadSpots() {
    await insertPending();
    const {data,error} = await sb.from('spots').select('*').order('created_at',{ascending:false});
    if (error) { showToast('Load error: '+error.message); return; }
    setRestaurants((data||[]).map(dbToApp));
    setLoading(false);
  }

  useEffect(()=>{ loadSpots(); },[]);

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
    showToast('Marked as visited! ✓');
  }

  async function handleRate(id,rating) {
    const {error}=await sb.from('spots').update({rating,visited:true}).eq('id',id);
    if (error) { showToast('Rating failed'); return; }
    setRestaurants(rs=>rs.map(r=>r.id===id?{...r,rating,status:'visited'}:r));
    setDetail(d=>d?.id===id?{...d,rating,status:'visited'}:d);
    showToast('★'.repeat(rating)+' Saved!');
  }

  return (<>
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=Lora:ital,wght@0,400;0,500;1,400&display=swap');
      *{box-sizing:border-box;margin:0;padding:0;}
      body{background:#e8d9c8;}
      ::placeholder{color:rgba(100,70,40,0.35)!important;}
      ::-webkit-scrollbar{width:4px;}
      ::-webkit-scrollbar-track{background:transparent;}
      ::-webkit-scrollbar-thumb{background:rgba(180,140,110,0.3);border-radius:4px;}
      select option{background:#f5ede0;}
      .leaflet-container{font-family:'Lora',serif!important;}
      @keyframes fadeIn{from{opacity:0}to{opacity:1}}
      @keyframes slideUp{from{opacity:0;transform:translateY(20px) scale(0.98)}to{opacity:1;transform:none}}
    `}</style>

    <div style={{minHeight:'100vh',display:'flex',flexDirection:'column',background:'linear-gradient(160deg,#e8d5be 0%,#ddc9b0 40%,#e0cfc0 100%)',fontFamily:"'Lora',serif"}}>
      <div style={{position:'fixed',inset:0,pointerEvents:'none',background:'radial-gradient(ellipse at 20% 20%,rgba(255,245,230,0.4) 0%,transparent 60%),radial-gradient(ellipse at 80% 80%,rgba(200,160,110,0.15) 0%,transparent 60%)'}}/>

      {/* Header */}
      <div style={{position:'sticky',top:0,zIndex:50,background:'rgba(240,226,208,0.75)',backdropFilter:'blur(24px)',WebkitBackdropFilter:'blur(24px)',borderBottom:'1px solid rgba(255,255,255,0.5)',boxShadow:'0 1px 0 rgba(180,140,110,0.15)',padding:'12px 16px 11px'}}>
        <div style={{maxWidth:780,margin:'0 auto',position:'relative'}}>
          {/* Add button – top right */}
          <div style={{position:'absolute',top:0,right:0,zIndex:10}}>
            <button onClick={()=>setShowAddMenu(v=>!v)} style={{background:'#2c1f14',color:'#fdf8f3',border:'none',borderRadius:10,padding:'8px 15px',fontFamily:"'DM Serif Display',serif",fontSize:13,cursor:'pointer',letterSpacing:'0.03em',boxShadow:'0 3px 10px rgba(30,14,4,0.22)'}}>+ Add</button>
            {showAddMenu&&(
              <div style={{position:'absolute',top:'calc(100% + 8px)',right:0,background:'rgba(255,248,240,0.96)',backdropFilter:'blur(20px)',borderRadius:12,border:'1px solid rgba(180,140,110,0.25)',boxShadow:'0 8px 32px rgba(30,14,4,0.15)',padding:6,zIndex:100,minWidth:190,animation:'slideUp 0.15s ease'}} onClick={e=>e.stopPropagation()}>
                <button onClick={()=>{setShowAddMenu(false);setEditTarget(null);setShowEdit(true);}} style={{width:'100%',padding:'10px 14px',border:'none',background:'none',textAlign:'left',fontFamily:"'Lora',serif",fontSize:13,color:'#1e0e04',cursor:'pointer',borderRadius:8,display:'flex',gap:10,alignItems:'center'}}>✏️ Add manually</button>
                <button onClick={()=>{setShowAddMenu(false);setShowImport(true);}} style={{width:'100%',padding:'10px 14px',border:'none',background:'none',textAlign:'left',fontFamily:"'Lora',serif",fontSize:13,color:'#1e0e04',cursor:'pointer',borderRadius:8,display:'flex',gap:10,alignItems:'center'}}>📍 Import from Google Maps</button>
              </div>
            )}
          </div>
          {/* Centered logo */}
          <div style={{textAlign:'center',paddingBottom:8}}>
            <h1 style={{fontFamily:"'DM Serif Display',serif",fontSize:24,color:'#1e0e04',letterSpacing:'-0.01em'}}>PinPlate</h1>
            <p style={{fontSize:11,color:'rgba(100,70,40,0.5)',marginTop:2,fontFamily:"'Lora',serif"}}>
              {restaurants.filter(r=>r.status==='want').length} to try · {restaurants.filter(r=>r.status==='visited').length} visited
            </p>
          </div>
          {/* Tab toggle – centred below logo */}
          <div style={{display:'flex',justifyContent:'center',marginBottom:tab==='home'?10:0}}>
            <div style={{display:'flex',background:'rgba(180,140,110,0.15)',borderRadius:10,padding:3,border:'1px solid rgba(180,140,110,0.2)'}}>
              {[{k:'home',l:'🍽 List'},{k:'map',l:'🗺 Map'}].map(t=>(
                <button key={t.k} onClick={()=>setTab(t.k)} style={{padding:'6px 16px',borderRadius:8,border:'none',cursor:'pointer',fontFamily:"'Lora',serif",fontSize:13,transition:'all 0.15s',background:tab===t.k?'rgba(255,248,240,0.9)':'transparent',color:tab===t.k?'#1e0e04':'rgba(100,70,40,0.5)',boxShadow:tab===t.k?'0 1px 4px rgba(30,14,4,0.1)':'none'}}>{t.l}</button>
              ))}
            </div>
          </div>
          {tab==='home'&&(
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search restaurants, cuisine, city, friend…" style={{width:'100%',padding:'9px 14px',background:'rgba(255,248,240,0.55)',backdropFilter:'blur(16px)',WebkitBackdropFilter:'blur(16px)',border:'1px solid rgba(255,255,255,0.55)',borderRadius:10,color:'#1e0e04',fontFamily:"'Lora',serif",fontSize:13,outline:'none',boxShadow:'inset 0 1px 3px rgba(30,14,4,0.05)'}}/>
          )}
        </div>
      </div>

      {/* List view */}
      {tab==='home'&&(
        <div style={{maxWidth:780,margin:'0 auto',width:'100%',padding:'18px 16px 80px'}}>
          {loading?(
            <div style={{textAlign:'center',padding:'60px 0'}}><p style={{fontFamily:"'Lora',serif",fontSize:15,color:'rgba(60,35,14,0.4)'}}>Loading…</p></div>
          ):(
            <div style={{display:'flex',gap:14,alignItems:'flex-start'}}>
              <Column title="Recommended" icon="◎" items={wantList} onCardClick={setDetail}/>
              <Column title="Visited" icon="✓" items={visitedList} onCardClick={setDetail}/>
            </div>
          )}
        </div>
      )}

      {/* Map view */}
      {tab==='map'&&!loading&&(
        <MapView spots={restaurants} onMarkerClick={r=>setDetail(r)}/>
      )}
    </div>

    {showAddMenu&&<div style={{position:'fixed',inset:0,zIndex:40}} onClick={()=>setShowAddMenu(false)}/>}

    {detail&&<DetailPanel r={detail} onClose={()=>setDetail(null)} onEdit={r=>{setEditTarget(r);setDetail(null);setShowEdit(true);}} onMarkVisited={handleMarkVisited} onRate={handleRate}/>}
    {showEdit&&<EditModal onClose={()=>{setShowEdit(false);setEditTarget(null);}} onSave={handleSave} editData={editTarget}/>}
    {showImport&&<ImportModal onClose={()=>setShowImport(false)} onImport={handleSave}/>}

    {toast&&<div style={{position:'fixed',bottom:24,left:'50%',transform:'translateX(-50%)',background:'#2c1f14',color:'#fdf8f3',padding:'10px 20px',borderRadius:50,fontFamily:"'Lora',serif",fontSize:14,zIndex:500,boxShadow:'0 4px 20px rgba(30,14,4,0.25)',animation:'slideUp 0.2s ease',whiteSpace:'nowrap'}}>{toast}</div>}
  </>);
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);
