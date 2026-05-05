// ===== PREMIUM FEATURES JS =====
// Shared helpers
function getAuthHeaders(){const h={'Content-Type':'application/json'};try{const u=firebase.auth().currentUser;if(u)return u.getIdToken().then(t=>{h['Authorization']='Bearer '+t;return h})}catch(e){}return Promise.resolve(h)}
async function premiumFetch(url,body){const h=await getAuthHeaders();const r=await fetch(url,{method:'POST',headers:h,body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw new Error(d.error||'İşlem başarısız');return d}
function premiumShowLoading(msg){const o=document.getElementById('loadingOverlay');const t=document.getElementById('loadingText');if(o){o.classList.add('show');if(t)t.textContent=msg||'İşleniyor...'}}
function premiumHideLoading(){const o=document.getElementById('loadingOverlay');if(o)o.classList.remove('show')}
function riskColor(r){return r==='yuksek'||r==='tehlikeli'?'var(--red)':r==='orta'?'var(--amber)':'var(--green)'}
function riskBg(r){return r==='yuksek'||r==='tehlikeli'?'rgba(248,113,113,0.12)':r==='orta'?'rgba(251,191,36,0.12)':'rgba(52,211,153,0.12)'}
function statusIcon(d){return d==='normal'?'✅':d==='dusuk'?'🔽':d==='kritik'?'🚨':'🔺'}
// XSS-safe text escaper for premium features
function safeText(v){if(typeof escapeHtml==='function')return escapeHtml(v);return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}

// ===== 1. TAHLİL OKUYUCU =====
let selectedLabFile=null;
function handleLabFileSelect(e){const f=e.target.files[0];if(!f)return;selectedLabFile=f;document.getElementById('labUploadContent').innerHTML='<div style="font-size:24px">✅</div><div class="upload-text">'+f.name+'</div>';showToast('Tahlil görseli yüklendi','success')}

async function analyzeLabResults(){
const txt=document.getElementById('labInput').value.trim();
if(!txt&&!selectedLabFile){showToast('Tahlil metni girin veya fotoğraf yükleyin','error');return}
premiumShowLoading('Tahlil sonuçları analiz ediliyor...');
try{
let data;
if(selectedLabFile){
const fd=new FormData();fd.append('image',selectedLabFile);
let hdr={};try{const u=firebase.auth().currentUser;if(u){const t=await u.getIdToken();hdr['Authorization']='Bearer '+t}}catch(e){}
const r=await fetch('/api/analyze-lab-image',{method:'POST',headers:hdr,body:fd});
const j=await r.json();if(!r.ok)throw new Error(j.error);data=j.result;
}else{
const j=await premiumFetch('/api/analyze-lab-results',{labText:txt});data=j.result;
}
renderLabResults(data);
}catch(e){showToast('Hata: '+e.message,'error')}finally{premiumHideLoading()}
}

function renderLabResults(d){
const c=document.getElementById('labResults');const inp=document.getElementById('labInputArea');
inp.style.display='none';c.style.display='block';
const vals=(d.degerler||[]).map(v=>`
<div style="padding:14px;background:${v.durum==='normal'?'rgba(52,211,153,0.06)':v.durum==='kritik'?'rgba(248,113,113,0.1)':'rgba(251,191,36,0.08)'};border:1px solid var(--border);border-radius:12px;border-left:4px solid ${v.durum==='normal'?'var(--green)':v.durum==='kritik'?'var(--red)':'var(--amber)'}">
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
<strong style="font-size:0.95rem">${statusIcon(v.durum)} ${v.isim||''}</strong>
<span style="font-weight:700;color:${v.durum==='normal'?'var(--green)':v.durum==='kritik'?'var(--red)':'var(--amber)'}">${v.sonuc||''} ${v.birim||''}</span>
</div>
<div style="font-size:0.8rem;color:var(--text-muted)">Referans: ${v.referans||'-'}</div>
<div style="font-size:0.85rem;color:var(--text-secondary);margin-top:4px">${v.aciklama||''}</div>
</div>`).join('');

const anormal=(d.anormal_degerler_ozet||[]).map(a=>`<li style="padding:6px 0;color:var(--amber);font-size:0.9rem">⚠️ ${a}</li>`).join('');
const uzman=(d.onerilen_uzmanlik||[]).map(u=>`<span style="padding:6px 14px;background:rgba(34,211,238,0.1);border:1px solid rgba(34,211,238,0.2);border-radius:100px;font-size:0.85rem;color:var(--teal)">${u}</span>`).join('');
const tavs=(d.genel_tavsiyeler||[]).map(t=>`<li style="padding:6px 0;font-size:0.9rem;color:var(--text-secondary)">💡 ${t}</li>`).join('');

c.innerHTML=`
<div class="nav-btn-container"><button class="back-btn" onclick="resetLabResults()">← Yeni Tahlil</button></div>
<div style="text-align:center;margin-bottom:20px">
<div style="width:100px;height:100px;border-radius:50%;background:conic-gradient(var(--teal) ${(d.saglik_skoru||75)*3.6}deg,rgba(255,255,255,0.05) 0deg);display:inline-flex;align-items:center;justify-content:center;margin-bottom:10px">
<div style="width:80px;height:80px;border-radius:50%;background:var(--bg-card);display:flex;align-items:center;justify-content:center;font-size:1.8rem;font-weight:800;color:var(--teal)">${d.saglik_skoru||75}</div>
</div>
<div style="font-size:0.85rem;color:var(--text-muted)">Sağlık Skoru</div>
</div>
<div class="result-panel" style="margin-bottom:16px"><div class="rp-section"><div class="rp-section-title">📋 Genel Değerlendirme</div><p style="color:var(--text-secondary);line-height:1.6">${d.ozet||''}</p></div></div>
${d.acil_uyari?`<div class="doctor-alert urgent" style="margin-bottom:16px"><span class="doctor-alert-icon">🚨</span><div><div class="doctor-alert-title">Acil Uyarı</div><div class="doctor-alert-desc">${d.acil_uyari}</div></div></div>`:''}
<div class="result-panel" style="margin-bottom:16px"><div class="rp-section"><div class="rp-section-title">🧪 Değerler</div><div style="display:flex;flex-direction:column;gap:10px">${vals}</div></div></div>
${anormal?`<div class="result-panel" style="margin-bottom:16px"><div class="rp-section"><div class="rp-section-title">⚠️ Anormal Değerler</div><ul style="list-style:none">${anormal}</ul></div></div>`:''}
${uzman?`<div class="result-panel" style="margin-bottom:16px"><div class="rp-section"><div class="rp-section-title">🏥 Önerilen Uzmanlıklar</div><div style="display:flex;flex-wrap:wrap;gap:8px">${uzman}</div></div></div>`:''}
${tavs?`<div class="result-panel"><div class="rp-section"><div class="rp-section-title">💡 Tavsiyeler</div><ul style="list-style:none">${tavs}</ul></div></div>`:''}`
}

function resetLabResults(){document.getElementById('labResults').style.display='none';document.getElementById('labResults').innerHTML='';document.getElementById('labInputArea').style.display='block';selectedLabFile=null;document.getElementById('labInput').value='';document.getElementById('labUploadContent').innerHTML='<div style="font-size:24px">📄</div><div class="upload-text">veya tahlil fotoğrafı yükle</div>'}

// ===== 2. SAĞLIK PROFİLİ =====
async function analyzeHealthProfile(){
const age=document.getElementById('profAge').value;
const gender=document.getElementById('profGender').value;
const height=document.getElementById('profHeight').value;
const weight=document.getElementById('profWeight').value;
if(!age||!gender||!height||!weight){showToast('Yaş, cinsiyet, boy ve kilo zorunludur','error');return}
const profile={yas:age,cinsiyet:gender,boy_cm:height,kilo_kg:weight,kan_grubu:document.getElementById('profBlood').value,kronik:document.getElementById('profChronic').value,alerjiler:document.getElementById('profAllergies').value,aile_gecmisi:document.getElementById('profFamily').value,sigara:document.getElementById('profSmoke').value,alkol:document.getElementById('profAlcohol').value,ilaclar:document.getElementById('profMeds').value};
premiumShowLoading('Sağlık profiliniz analiz ediliyor...');
try{
const j=await premiumFetch('/api/health-profile',{profile});
renderProfileResults(j.result);
}catch(e){showToast('Hata: '+e.message,'error')}finally{premiumHideLoading()}
}

function renderProfileResults(d){
const c=document.getElementById('profileResults');document.getElementById('profileForm').style.display='none';c.style.display='block';
const bmi=d.bmi||{};
const risks=(d.risk_haritasi||[]).map(r=>`
<div style="padding:16px;background:${riskBg(r.risk)};border:1px solid var(--border);border-radius:12px">
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
<strong>${r.alan||''}</strong>
<span style="padding:4px 12px;border-radius:100px;font-size:0.75rem;font-weight:700;background:${riskBg(r.risk)};color:${riskColor(r.risk)}">${(r.risk||'').toUpperCase()}</span>
</div>
<div style="height:6px;background:rgba(255,255,255,0.08);border-radius:10px;overflow:hidden;margin-bottom:8px">
<div style="height:100%;width:${r.puan||0}%;background:${riskColor(r.risk)};border-radius:10px"></div>
</div>
<div style="font-size:0.82rem;color:var(--text-secondary)">${(r.faktorler||[]).join(', ')}</div>
<div style="font-size:0.82rem;color:var(--teal);margin-top:4px">💡 ${r.oneri||''}</div>
</div>`).join('');

const checks=(d.periyodik_kontroller||[]).map(p=>`<li style="padding:6px 0;font-size:0.9rem;color:var(--text-secondary)">📅 ${p}</li>`).join('');
const tips=(d.kisisel_tavsiyeler||[]).map(t=>`<li style="padding:6px 0;font-size:0.9rem;color:var(--text-secondary)">✨ ${t}</li>`).join('');
const needs=d.gunluk_ihtiyaclar||{};

c.innerHTML=`
<div class="nav-btn-container"><button class="back-btn" onclick="resetProfile()">← Profili Düzenle</button></div>
<div style="text-align:center;margin-bottom:20px">
<div style="width:110px;height:110px;border-radius:50%;background:conic-gradient(var(--green) ${(d.genel_skor||70)*3.6}deg,rgba(255,255,255,0.05) 0deg);display:inline-flex;align-items:center;justify-content:center;margin-bottom:10px">
<div style="width:90px;height:90px;border-radius:50%;background:var(--bg-card);display:flex;align-items:center;justify-content:center;flex-direction:column">
<div style="font-size:2rem;font-weight:800;color:var(--green)">${d.genel_skor||70}</div>
<div style="font-size:0.65rem;color:var(--text-muted)">SAĞLIK SKORU</div>
</div></div></div>
<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px">
<div class="timer-stat-card"><div class="timer-stat-value" style="font-size:1.4rem;background:linear-gradient(135deg,var(--teal),var(--green));-webkit-background-clip:text;-webkit-text-fill-color:transparent">${bmi.deger||'-'}</div><div class="timer-stat-label">BMI · ${bmi.kategori||''}</div></div>
<div class="timer-stat-card"><div class="timer-stat-value" style="font-size:1.4rem;background:linear-gradient(135deg,var(--amber),#f59e0b);-webkit-background-clip:text;-webkit-text-fill-color:transparent">${needs.kalori||'-'}</div><div class="timer-stat-label">Günlük Kalori</div></div>
<div class="timer-stat-card"><div class="timer-stat-value" style="font-size:1.4rem;background:linear-gradient(135deg,var(--teal),var(--green));-webkit-background-clip:text;-webkit-text-fill-color:transparent">${needs.su_litre||'-'}L</div><div class="timer-stat-label">Günlük Su</div></div>
</div>
<div class="result-panel" style="margin-bottom:16px"><div class="rp-section"><div class="rp-section-title">🗺️ Risk Haritası</div><div style="display:grid;gap:12px">${risks}</div></div></div>
${checks?`<div class="result-panel" style="margin-bottom:16px"><div class="rp-section"><div class="rp-section-title">📅 Periyodik Kontroller</div><ul style="list-style:none">${checks}</ul></div></div>`:''}
${tips?`<div class="result-panel"><div class="rp-section"><div class="rp-section-title">✨ Kişisel Tavsiyeler</div><ul style="list-style:none">${tips}</ul></div></div>`:''}`
}

function resetProfile(){document.getElementById('profileResults').style.display='none';document.getElementById('profileResults').innerHTML='';document.getElementById('profileForm').style.display='block'}

// ===== 3. İLAÇ ETKİLEŞİM =====
let drugListItems=[];
function addDrug(){const inp=document.getElementById('drugInput');const v=inp.value.trim();if(!v)return;addDrugDirect(v);inp.value=''}
function addDrugDirect(name){if(drugListItems.includes(name))return;drugListItems.push(name);renderDrugList();document.getElementById('interactionBtn').disabled=drugListItems.length<2}
function removeDrug(i){drugListItems.splice(i,1);renderDrugList();document.getElementById('interactionBtn').disabled=drugListItems.length<2}
function renderDrugList(){const c=document.getElementById('drugList');c.innerHTML=drugListItems.map((d,i)=>`<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:10px"><span style="flex:1;font-weight:600">💊 ${d}</span><button onclick="removeDrug(${i})" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:1rem">✕</button></div>`).join('')}

async function checkInteractions(){
if(drugListItems.length<2){showToast('En az 2 ilaç girin','error');return}
premiumShowLoading('İlaç etkileşimleri kontrol ediliyor...');
try{
const j=await premiumFetch('/api/drug-interactions',{medications:drugListItems});
renderInteractionResults(j.result);
}catch(e){showToast('Hata: '+e.message,'error')}finally{premiumHideLoading()}
}

function renderInteractionResults(d){
const c=document.getElementById('interactionResults');document.getElementById('interactionForm').style.display='none';c.style.display='block';
const ints=(d.etkilesimler||[]).map(e=>`
<div style="padding:14px;background:${riskBg(e.ciddiyet)};border:1px solid var(--border);border-radius:12px;border-left:4px solid ${riskColor(e.ciddiyet)}">
<div style="display:flex;justify-content:space-between;margin-bottom:6px"><strong>${e.ilac1} ↔ ${e.ilac2}</strong><span style="padding:3px 10px;border-radius:100px;font-size:0.72rem;font-weight:700;color:${riskColor(e.ciddiyet)};background:${riskBg(e.ciddiyet)}">${(e.ciddiyet||'').toUpperCase()}</span></div>
<p style="font-size:0.88rem;color:var(--text-secondary);margin-bottom:4px">${e.aciklama||''}</p>
<p style="font-size:0.85rem;color:var(--teal)">💡 ${e.oneri||''}</p>
</div>`).join('');

const food=(d.besin_etkilesimleri||[]).map(b=>`<div style="padding:10px 14px;background:var(--bg-secondary);border-radius:10px;margin-bottom:8px"><strong>🍎 ${b.ilac}</strong> + <strong>${b.besin}</strong><div style="font-size:0.85rem;color:var(--text-secondary);margin-top:4px">${b.etki}</div></div>`).join('');
const alc=(d.alkol_uyumu||[]).map(a=>`<div style="padding:10px 14px;background:${riskBg(a.risk)};border-radius:10px;margin-bottom:8px"><strong>🍷 ${a.ilac}</strong> <span style="color:${riskColor(a.risk)};font-weight:700">[${(a.risk||'').toUpperCase()}]</span><div style="font-size:0.85rem;color:var(--text-secondary);margin-top:4px">${a.aciklama||''}</div></div>`).join('');
const sched=(d.zaman_cizelgesi||[]).map(z=>`<div style="padding:10px 14px;background:var(--bg-secondary);border-radius:10px;margin-bottom:8px;display:flex;gap:10px"><span style="font-size:1.2rem">⏰</span><div><strong>${z.ilac}</strong><div style="font-size:0.85rem;color:var(--amber)">${z.zaman}</div>${z.not?`<div style="font-size:0.82rem;color:var(--text-muted)">${z.not}</div>`:''}</div></div>`).join('');

c.innerHTML=`
<div class="nav-btn-container"><button class="back-btn" onclick="resetInteractions()">← Yeni Kontrol</button></div>
${d.genel_uyari?`<div class="doctor-alert ${(d.etkilesimler||[]).some(e=>e.ciddiyet==='tehlikeli')?'urgent':'soon'}" style="margin-bottom:16px"><span class="doctor-alert-icon">⚠️</span><div><div class="doctor-alert-title">Genel Uyarı</div><div class="doctor-alert-desc">${d.genel_uyari}</div></div></div>`:''}
${ints?`<div class="result-panel" style="margin-bottom:16px"><div class="rp-section"><div class="rp-section-title">⚠️ Etkileşimler</div><div style="display:flex;flex-direction:column;gap:10px">${ints}</div></div></div>`:'<div class="result-panel" style="margin-bottom:16px"><div class="rp-section" style="text-align:center;padding:30px"><div style="font-size:2rem;margin-bottom:8px">✅</div><p style="color:var(--green);font-weight:600">Tehlikeli etkileşim tespit edilmedi</p></div></div>'}
${food?`<div class="result-panel" style="margin-bottom:16px"><div class="rp-section"><div class="rp-section-title">🍎 Besin Etkileşimleri</div>${food}</div></div>`:''}
${alc?`<div class="result-panel" style="margin-bottom:16px"><div class="rp-section"><div class="rp-section-title">🍷 Alkol Uyumu</div>${alc}</div></div>`:''}
${sched?`<div class="result-panel"><div class="rp-section"><div class="rp-section-title">⏰ İlaç Zaman Çizelgesi</div>${sched}</div></div>`:''}`
}

function resetInteractions(){document.getElementById('interactionResults').style.display='none';document.getElementById('interactionResults').innerHTML='';document.getElementById('interactionForm').style.display='block';drugListItems=[];renderDrugList();document.getElementById('interactionBtn').disabled=true}
