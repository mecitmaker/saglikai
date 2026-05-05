// ===== 4. BELİRTİ TAKİP =====
let _trackerEntries = JSON.parse(localStorage.getItem('symptomTracker') || '[]');

function addTrackerEntry(){
const sym=document.getElementById('trackerSymptom').value.trim();
if(!sym){showToast('Belirti girin','error');return}
const entry={tarih:new Date().toISOString().split('T')[0]+' '+new Date().toLocaleTimeString('tr-TR',{hour:'2-digit',minute:'2-digit'}),belirti:sym,siddet:parseInt(document.getElementById('trackerSeverity').value),not:document.getElementById('trackerNote').value.trim(),id:Date.now()};
_trackerEntries.push(entry);
localStorage.setItem('symptomTracker',JSON.stringify(_trackerEntries));
document.getElementById('trackerSymptom').value='';document.getElementById('trackerNote').value='';
document.getElementById('trackerSeverity').value=5;document.getElementById('sevLabel').textContent='5';
renderTrackerEntries();showToast('Belirti kaydedildi','success');
document.getElementById('trendBtn').disabled=_trackerEntries.length<2;
}

function deleteTrackerEntry(id){
_trackerEntries=_trackerEntries.filter(e=>e.id!==id);
localStorage.setItem('symptomTracker',JSON.stringify(_trackerEntries));
renderTrackerEntries();
document.getElementById('trendBtn').disabled=_trackerEntries.length<2;
}

function renderTrackerEntries(){
const c=document.getElementById('trackerEntries');
if(!_trackerEntries.length){c.innerHTML='<div style="text-align:center;padding:30px;color:var(--text-muted)"><div style="font-size:2rem;margin-bottom:8px">📋</div><p>Henüz kayıt yok. Yukarıdan belirti ekleyin.</p></div>';renderTrackerChart();return}
const sevColors=['','#10b981','#34d399','#86efac','#fbbf24','#f59e0b','#f97316','#fb923c','#ef4444','#dc2626','#991b1b'];
c.innerHTML=_trackerEntries.slice().reverse().slice(0,15).map(e=>`
<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:10px;margin-bottom:8px;border-left:4px solid ${sevColors[e.siddet]||'var(--amber)'}">
<div style="text-align:center;min-width:36px"><div style="font-size:1.4rem;font-weight:800;color:${sevColors[e.siddet]}">${e.siddet}</div><div style="font-size:0.6rem;color:var(--text-muted)">/10</div></div>
<div style="flex:1;min-width:0"><div style="font-weight:600;font-size:0.95rem">${e.belirti}</div><div style="font-size:0.78rem;color:var(--text-muted)">${e.tarih}${e.not?' · '+e.not:''}</div></div>
<button onclick="deleteTrackerEntry(${e.id})" style="background:none;border:none;color:var(--red);cursor:pointer;opacity:0.5;font-size:0.9rem" title="Sil">🗑️</button>
</div>`).join('');
renderTrackerChart();
}

function renderTrackerChart(){
const chart=document.getElementById('trackerChart');
if(_trackerEntries.length<2){chart.style.display='none';return}
chart.style.display='block';
const canvas=document.getElementById('symptomChart');
const ctx=canvas.getContext('2d');
const rect=canvas.parentElement.getBoundingClientRect();
canvas.width=rect.width-40;canvas.height=180;
ctx.clearRect(0,0,canvas.width,canvas.height);
const entries=_trackerEntries.slice(-14);
const max=10;const padding={top:20,right:20,bottom:30,left:35};
const w=canvas.width-padding.left-padding.right;
const h=canvas.height-padding.top-padding.bottom;
const stepX=w/(entries.length-1||1);
// Grid
ctx.strokeStyle='rgba(255,255,255,0.06)';ctx.lineWidth=1;
for(let i=0;i<=5;i++){const y=padding.top+(h/5)*i;ctx.beginPath();ctx.moveTo(padding.left,y);ctx.lineTo(padding.left+w,y);ctx.stroke()}
// Line
const gradient=ctx.createLinearGradient(0,padding.top,0,padding.top+h);
gradient.addColorStop(0,'rgba(34,211,238,0.3)');gradient.addColorStop(1,'rgba(34,211,238,0)');
ctx.beginPath();ctx.moveTo(padding.left,padding.top+h);
entries.forEach((e,i)=>{const x=padding.left+i*stepX;const y=padding.top+h-(e.siddet/max)*h;ctx.lineTo(x,y)});
ctx.lineTo(padding.left+(entries.length-1)*stepX,padding.top+h);ctx.closePath();
ctx.fillStyle=gradient;ctx.fill();
// Line stroke
ctx.beginPath();
entries.forEach((e,i)=>{const x=padding.left+i*stepX;const y=padding.top+h-(e.siddet/max)*h;i===0?ctx.moveTo(x,y):ctx.lineTo(x,y)});
ctx.strokeStyle='#22d3ee';ctx.lineWidth=2.5;ctx.stroke();
// Dots
entries.forEach((e,i)=>{const x=padding.left+i*stepX;const y=padding.top+h-(e.siddet/max)*h;ctx.beginPath();ctx.arc(x,y,4,0,Math.PI*2);ctx.fillStyle=e.siddet>=7?'#ef4444':e.siddet>=4?'#fbbf24':'#34d399';ctx.fill();ctx.strokeStyle='var(--bg-card)';ctx.lineWidth=2;ctx.stroke()});
// Labels
ctx.fillStyle='rgba(255,255,255,0.4)';ctx.font='10px Inter';ctx.textAlign='center';
entries.forEach((e,i)=>{if(i%Math.ceil(entries.length/7)===0||i===entries.length-1){const x=padding.left+i*stepX;ctx.fillText(e.tarih.split(' ')[0].slice(5),x,canvas.height-5)}});
ctx.textAlign='right';
for(let i=0;i<=max;i+=2){const y=padding.top+h-(i/max)*h;ctx.fillText(i,padding.left-8,y+4)}
}

async function analyzeTrend(){
if(_trackerEntries.length<2){showToast('En az 2 kayıt gerekli','error');return}
premiumShowLoading('Belirti trendleri analiz ediliyor...');
try{
const j=await premiumFetch('/api/symptom-trend',{entries:_trackerEntries.slice(-30)});
renderTrendResults(j.result);
}catch(e){showToast('Hata: '+e.message,'error')}finally{premiumHideLoading()}
}

function renderTrendResults(d){
const c=document.getElementById('trendResults');c.style.display='block';
const trendIcon=d.genel_trend==='iyilesme'?'📈':d.genel_trend==='kotulesme'?'📉':'➡️';
const trendColor=d.genel_trend==='iyilesme'?'var(--green)':d.genel_trend==='kotulesme'?'var(--red)':'var(--amber)';
const patterns=(d.pattern_tespitleri||[]).map(p=>`<li style="padding:6px 0;font-size:0.9rem;color:var(--text-secondary)">🔍 ${p}</li>`).join('');
const triggers=(d.tetikleyiciler||[]).map(t=>`<span style="padding:5px 14px;background:rgba(248,113,113,0.1);border:1px solid rgba(248,113,113,0.2);border-radius:100px;font-size:0.85rem;color:var(--red)">${t}</span>`).join('');
const tips=(d.tavsiyeler||[]).map(t=>`<li style="padding:6px 0;font-size:0.9rem;color:var(--text-secondary)">💡 ${t}</li>`).join('');
const doc=d.doktora_git_mi||{};

c.innerHTML=`
<div class="result-panel" style="margin-bottom:16px"><div class="rp-section" style="text-align:center">
<div style="font-size:2.5rem;margin-bottom:8px">${trendIcon}</div>
<div style="font-size:1.1rem;font-weight:700;color:${trendColor};margin-bottom:8px">${d.genel_trend==='iyilesme'?'İyileşme Trendi':d.genel_trend==='kotulesme'?'Kötüleşme Trendi':'Stabil Durum'}</div>
<p style="color:var(--text-secondary);font-size:0.9rem">${d.trend_aciklama||''}</p>
</div></div>
${doc.gerekli?`<div class="doctor-alert urgent" style="margin-bottom:16px"><span class="doctor-alert-icon">🏥</span><div><div class="doctor-alert-title">Doktor Kontrolü Öneriliyor</div><div class="doctor-alert-desc">${doc.neden||''} — <strong>${doc.hangi_bolum||''}</strong></div></div></div>`:''}
${patterns?`<div class="result-panel" style="margin-bottom:16px"><div class="rp-section"><div class="rp-section-title">🔍 Pattern Tespitleri</div><ul style="list-style:none">${patterns}</ul></div></div>`:''}
${triggers?`<div class="result-panel" style="margin-bottom:16px"><div class="rp-section"><div class="rp-section-title">⚡ Tetikleyiciler</div><div style="display:flex;flex-wrap:wrap;gap:8px">${triggers}</div></div></div>`:''}
${tips?`<div class="result-panel" style="margin-bottom:16px"><div class="rp-section"><div class="rp-section-title">💡 Tavsiyeler</div><ul style="list-style:none">${tips}</ul></div></div>`:''}
${d.doktor_raporu_ozet?`<div class="result-panel"><div class="rp-section"><div class="rp-section-title">📋 Doktor Özeti</div><div style="padding:14px;background:rgba(34,211,238,0.06);border:1px solid rgba(34,211,238,0.15);border-radius:10px;font-size:0.9rem;color:var(--text-primary);line-height:1.6">${d.doktor_raporu_ozet}</div></div></div>`:''}`
}

// ===== 5. MENTAL SAĞLIK =====
let selectedMood='';
function selectMood(btn,val){
document.querySelectorAll('.mood-btn').forEach(b=>{b.style.borderColor='var(--border)';b.style.background='var(--bg-card)'});
btn.style.borderColor='var(--purple)';btn.style.background='rgba(167,139,250,0.15)';
selectedMood=val;
}

async function analyzeMentalHealth(){
if(!selectedMood){showToast('Ruh halinizi seçin','error');return}
const sleep=document.getElementById('mentalSleep').value;
if(!sleep){showToast('Uyku kalitesini seçin','error');return}
const checks=Array.from(document.querySelectorAll('.mental-check:checked')).map(c=>c.value);
const stress=document.getElementById('mentalStress').value;
const notes=document.getElementById('mentalNotes').value.trim();
const assessment={ruh_hali:selectedMood,stres_seviyesi:parseInt(stress),uyku:sleep,belirtiler:checks,ek_not:notes};
premiumShowLoading('Mental sağlığınız değerlendiriliyor...');
try{
const j=await premiumFetch('/api/mental-health',{assessment});
renderMentalResults(j.result);
}catch(e){showToast('Hata: '+e.message,'error')}finally{premiumHideLoading()}
}

function renderMentalResults(d){
const c=document.getElementById('mentalResults');document.getElementById('mentalForm').style.display='none';c.style.display='block';
const statusMap={iyi:{icon:'😊',color:'var(--green)',label:'İyi Durumda'},orta:{icon:'😐',color:'var(--amber)',label:'Orta'},dikkat_gerekli:{icon:'😟',color:'var(--red)',label:'Dikkat Gerekli'},acil_destek:{icon:'🆘',color:'var(--red)',label:'Acil Destek Gerekli'}};
const st=statusMap[d.genel_durum]||statusMap.orta;
const tips=(d.tavsiyeler||[]).map(t=>`
<div style="padding:14px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:12px;display:flex;gap:12px;align-items:flex-start">
<span style="font-size:1.5rem">${t.icon||'💡'}</span>
<div><strong style="font-size:0.95rem">${t.baslik||''}</strong><div style="font-size:0.85rem;color:var(--text-secondary);margin-top:4px">${t.aciklama||''}</div></div>
</div>`).join('');

const strengths=(d.guclu_yonler||[]).map(g=>`<span style="padding:6px 14px;background:rgba(52,211,153,0.1);border:1px solid rgba(52,211,153,0.2);border-radius:100px;font-size:0.85rem;color:var(--green)">💪 ${g}</span>`).join('');
const anx=(d.anksiyete_belirtileri||[]).filter(a=>a).map(a=>`<li style="padding:4px 0;font-size:0.88rem;color:var(--text-secondary)">• ${a}</li>`).join('');
const dep=(d.depresyon_belirtileri||[]).filter(a=>a).map(a=>`<li style="padding:4px 0;font-size:0.88rem;color:var(--text-secondary)">• ${a}</li>`).join('');
const prof=d.profesyonel_destek||{};

c.innerHTML=`
<div class="nav-btn-container"><button class="back-btn" onclick="resetMental()">← Yeniden Değerlendir</button></div>
${d.genel_durum==='acil_destek'?`<div class="doctor-alert urgent" style="margin-bottom:16px"><span class="doctor-alert-icon">🆘</span><div><div class="doctor-alert-title">Acil Destek Hattı: 182</div><div class="doctor-alert-desc">Lütfen hemen 182 İntihar Önleme Hattı'nı arayın veya en yakın acil servise başvurun. Yalnız değilsiniz.</div></div></div>`:''}
<div style="text-align:center;margin-bottom:20px;padding:24px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:var(--radius)">
<div style="font-size:3rem;margin-bottom:8px">${st.icon}</div>
<div style="width:90px;height:90px;border-radius:50%;background:conic-gradient(${st.color} ${(d.skor||50)*3.6}deg,rgba(255,255,255,0.05) 0deg);display:inline-flex;align-items:center;justify-content:center;margin-bottom:10px">
<div style="width:72px;height:72px;border-radius:50%;background:var(--bg-card);display:flex;align-items:center;justify-content:center;font-size:1.6rem;font-weight:800;color:${st.color}">${d.skor||50}</div>
</div>
<div style="font-weight:700;color:${st.color};margin-bottom:4px">${st.label}</div>
<div style="font-size:0.8rem;color:var(--text-muted)">Stres: ${d.stres_seviyesi||'-'}</div>
</div>
<div class="result-panel" style="margin-bottom:16px"><div class="rp-section"><div class="rp-section-title">📝 Değerlendirme</div><p style="color:var(--text-secondary);line-height:1.7;font-size:0.95rem">${d.degerlendirme||''}</p></div></div>
${strengths?`<div class="result-panel" style="margin-bottom:16px"><div class="rp-section"><div class="rp-section-title">💪 Güçlü Yönleriniz</div><div style="display:flex;flex-wrap:wrap;gap:8px">${strengths}</div></div></div>`:''}
${anx||dep?`<div class="result-panel" style="margin-bottom:16px"><div class="rp-section"><div class="rp-section-title">📊 Tespit Edilen Belirtiler</div>${anx?`<div style="margin-bottom:10px"><div style="font-size:0.82rem;color:var(--amber);font-weight:600;margin-bottom:6px">Anksiyete</div><ul style="list-style:none">${anx}</ul></div>`:''}${dep?`<div><div style="font-size:0.82rem;color:var(--purple);font-weight:600;margin-bottom:6px">Depresyon</div><ul style="list-style:none">${dep}</ul></div>`:''}</div></div>`:''}
${tips?`<div class="result-panel" style="margin-bottom:16px"><div class="rp-section"><div class="rp-section-title">🌟 Öneriler</div><div style="display:flex;flex-direction:column;gap:10px">${tips}</div></div></div>`:''}
${prof.gerekli?`<div class="doctor-alert soon" style="margin-bottom:16px"><span class="doctor-alert-icon">👨‍⚕️</span><div><div class="doctor-alert-title">Profesyonel Destek Önerisi</div><div class="doctor-alert-desc">${prof.neden||''} — <strong>${prof.uzmanlik||'Psikolog/Psikiyatrist'}</strong></div></div></div>`:''}
${d.moral_mesaji?`<div style="text-align:center;padding:20px;background:linear-gradient(135deg,rgba(167,139,250,0.08),rgba(34,211,238,0.05));border:1px solid var(--border);border-radius:var(--radius)"><div style="font-size:1.5rem;margin-bottom:8px">💜</div><p style="color:var(--text-primary);font-style:italic;line-height:1.6;font-size:0.95rem">"${d.moral_mesaji}"</p></div>`:''}`
}

function resetMental(){document.getElementById('mentalResults').style.display='none';document.getElementById('mentalResults').innerHTML='';document.getElementById('mentalForm').style.display='block';selectedMood='';document.querySelectorAll('.mood-btn').forEach(b=>{b.style.borderColor='var(--border)';b.style.background='var(--bg-card)'})}

// Init tracker on load
document.addEventListener('DOMContentLoaded',function(){
renderTrackerEntries();
document.getElementById('trendBtn').disabled=_trackerEntries.length<2;
});
