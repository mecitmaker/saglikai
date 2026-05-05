        let selectedFile = null;
        let currentAbortController = null;
        let followUpHistory = [];
        let currentOriginalSymptoms = '';
        let currentResult = null;
        let followUpQuestionsQueue = [];
        let followUpQuestionIndex = 0;


        function escapeHtml(value) {
            return String(value ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        function escapeForSingleQuote(value) {
            return String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        }

        function sanitizeRichHtml(inputHtml) {
            const template = document.createElement('template');
            template.innerHTML = String(inputHtml || '');
            const blockedTags = ['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'form'];
            blockedTags.forEach(tag => { template.content.querySelectorAll(tag).forEach(node => node.remove()); });
            return template.innerHTML;
        }

        async function addMessage(text, sender) {
            const container = document.getElementById('resultsContainer');
            const html = `
                <div class="chat-bubble bubble-${sender} animate-fade-in">
                    <div class="chat-header">${sender === 'user' ? 'Siz' : '🤖 Asistan'}</div>
                    <div class="asistan-speech">${escapeHtml(text).replace(/\n/g, '<br>')}</div>
                </div>
            `;
            container.insertAdjacentHTML('beforeend', html);
            container.lastElementChild.scrollIntoView({ behavior: 'smooth' });
        }

        // ===== TOAST NOTIFICATIONS =====
        function showToast(message, type = 'info') {
            const container = document.getElementById('toast-container');
            const toast = document.createElement('div');
            toast.className = 'toast';
            const icon = type === 'error' ? '❌' : type === 'success' ? '✅' : 'ℹ️';
            const safeMsg = escapeHtml(message);
            toast.innerHTML = `<span>${icon}</span> <span>${safeMsg}</span>`;
            container.appendChild(toast);
            setTimeout(() => {
                toast.classList.add('hide');
                setTimeout(() => toast.remove(), 300);
            }, 3000);
        }

        // ===== NAVIGATION / RESET =====

        function cancelAnalysis() {
            if (currentAbortController) {
                currentAbortController.abort();
                currentAbortController = null;
                showLoading(false);
                showToast('İşlem durduruldu', 'info');
            }
        }

        function resetAI() {
            document.getElementById('results').style.display = 'none';
            document.getElementById('resultsContainer').style.display = 'none';
            document.getElementById('resultsContainer').innerHTML = '';
            document.getElementById('symptomInput').value = '';
            document.getElementById('heroSymptomInput').value = '';
            if (typeof removeImage === 'function') removeImage({ stopPropagation: () => {} });
            selectedFile = null;
            currentResult = null;
            followUpHistory = [];
            followUpQuestionsQueue = [];
            followUpQuestionIndex = 0;
            const chatInput = document.getElementById('chatInputArea');
            if (chatInput) chatInput.style.display = 'none';
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        function goBackToDashboard() {
            resetAI();
            switchTab('tab-dashboard', '🏠 Ana Sayfa');
        }

        function resetDisease() {
            document.getElementById('diseaseResults').style.display = 'none';
            document.getElementById('diseaseInput').value = '';
            document.getElementById('deepDiveContent').style.display = 'none';
            document.getElementById('deepDiveBtn').style.display = 'flex';
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        // ===== DEEP DIVE =====
        async function getDeepDive() {
            const disease = document.getElementById('diseaseInput').value.trim();
            const btn = document.getElementById('deepDiveBtn');
            const loading = document.getElementById('deepDiveLoading');
            const content = document.getElementById('deepDiveContent');
            btn.style.display = 'none';
            loading.style.display = 'block';
            currentAbortController = new AbortController();
            const signal = currentAbortController.signal;
            try {
                const res = await fetch('/api/deep-dive', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ disease }),
                    signal: signal
                });
                const data = await res.json();
                if (data.error) throw new Error(data.error);
                const r = data.result;
                document.getElementById('techMechanism').textContent = r.mechanism || "Bilgi sağlanamadı.";
                const processList = (val) => Array.isArray(val) ? val.join(', ') : val || 'Bilgi yok';
                document.getElementById('techRisks').textContent = processList(r.risk_factors);
                document.getElementById('techFindings').textContent = processList(r.clinical_findings);
                document.getElementById('techDiagnosis').textContent = processList(r.diagnostics);
                document.getElementById('techDiet').textContent = processList(r.diet_guide);
                document.getElementById('techResearch').textContent = processList(r.recent_research);
                loading.style.display = 'none';
                content.style.display = 'block';
                
                // Araştırma sonuçlarına pürüzsüzce odaklan
                setTimeout(() => {
                    content.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    // Sayfada ekstra bir itme yapalım ki tam hizalansın
                    window.scrollBy({ top: -20, behavior: 'smooth' });
                }, 100);

                showToast('Derinlemesine analiz tamamlandı!', 'success');
            } catch (error) {
                if (error.name === 'AbortError') return;
                loading.style.display = 'none';
                btn.style.display = 'flex';
                showToast('Detaylı analiz hatası: ' + error.message, 'error');
            } finally {
                currentAbortController = null;
            }
        }

        // ===== COPY TO CLIPBOARD =====
        async function copyResults(containerId) {
            const container = document.getElementById(containerId);
            const text = container.innerText;
            try {
                await navigator.clipboard.writeText(text);
                showToast('Sonuçlar panoya kopyalandı!', 'success');
            } catch (err) {
                showToast('Kopyalama başarısız oldu', 'error');
            }
        }

        // ===== CHECK AI STATUS =====
        async function checkStatus() {
            try {
                const res = await fetch('/api/status');
                const data = await res.json();
                const statusDot = document.getElementById('aiStatus');
                const statusText = document.getElementById('aiStatusText');
                const modeBadge = document.getElementById('aiModeBadge');
                if (statusDot && statusText) {
                    const isActive = data.status && data.status.includes('Aktif');
                    statusDot.classList.toggle('active', isActive);
                    statusDot.classList.toggle('error', !isActive);
                    statusText.textContent = data.status || 'Bilinmiyor';
                }
                if (modeBadge) {
                    const badges = [];
                    if (data.mode) badges.push(data.mode);
                    if (data.gemini) badges.push('Gemini ✓');
                    modeBadge.innerHTML = `<div class="ai-badge">${badges.join(' + ') || 'AI'}</div>`;
                }
            } catch {
                const statusDot = document.getElementById('aiStatus');
                const statusText = document.getElementById('aiStatusText');
                if (statusDot) { statusDot.classList.remove('active'); statusDot.classList.add('error'); }
                if (statusText) statusText.textContent = 'Sunucu bağlantısı yok';
            }
        }
        checkStatus();
        setInterval(checkStatus, 30000);

        // ===== ADD SYMPTOM CHIP =====
        function addSymptom(symptom) {
            const hero = document.getElementById('heroSymptomInput');
            const hidden = document.getElementById('symptomInput');
            const input = hero || hidden;
            if (!input) return;
            const current = input.value.trim();
            input.value = current ? current + ', ' + symptom : symptom;
            if (hero) hero.focus();
        }

        // ===== FILE UPLOAD =====
        const uploadZone = document.getElementById('uploadZone');
        if(uploadZone) {
            uploadZone.addEventListener('dragover', (e) => { e.preventDefault(); uploadZone.classList.add('dragover'); });
            uploadZone.addEventListener('dragleave', () => { uploadZone.classList.remove('dragover'); });
            uploadZone.addEventListener('drop', (e) => {
                e.preventDefault();
                uploadZone.classList.remove('dragover');
                if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
            });
        }

        function handleFileSelect(e) { if (e.target.files.length) handleFile(e.target.files[0]); }

        function handleFile(file) {
            if (!file.type.startsWith('image/')) { showToast('Lütfen bir görüntü dosyası seçin.', 'error'); return; }
            if (file.size > 10 * 1024 * 1024) { showToast('Dosya boyutu 10MB\'dan büyük olamaz.', 'error'); return; }
            selectedFile = file;
            // Show feedback on dashboard hero upload button
            const heroUpBtn = document.querySelector('.hero-upload-btn');
            if (heroUpBtn) heroUpBtn.innerHTML = '✅ ' + file.name.substring(0, 20);
            showToast('Fotoğraf yüklendi: ' + file.name, 'success');
        }

        function removeImage(e) {
            if(e) e.stopPropagation();
            selectedFile = null;
            const heroUpBtn = document.querySelector('.hero-upload-btn');
            if (heroUpBtn) heroUpBtn.innerHTML = '📸 Fotoğraf';
            const fi = document.getElementById('fileInput');
            if (fi) fi.value = '';
        }

        // ===== KVKK LOGIC =====
        const KVKK_VERSION = 'v1.0';
        function getLocalKVKKState() {
            const raw = localStorage.getItem('sa_kvkk_state');
            if (raw) { try { return JSON.parse(raw); } catch (e) { console.warn('KVKK parse error', e); } }
            if (localStorage.getItem('sa_kvkk_accepted') === 'true') return { accepted: true, version: KVKK_VERSION };
            return { accepted: false, version: null };
        }
        function setLocalKVKKState(state) {
            localStorage.setItem('sa_kvkk_state', JSON.stringify(state));
            localStorage.setItem('sa_kvkk_accepted', state.accepted ? 'true' : 'false');
        }
        function hasValidLocalKVKKConsent() { const state = getLocalKVKKState(); return state.accepted === true && state.version === KVKK_VERSION; }
        async function checkKVKK() {
            const localConsent = hasValidLocalKVKKConsent();
            if (!auth || !auth.currentUser) return localConsent;
            try {
                const res = await fetch('/api/consent/kvkk/status');
                const data = await res.json();
                if (res.ok && data.accepted === true) {
                    setLocalKVKKState({ accepted: true, version: data.version || KVKK_VERSION });
                    return true;
                }
                return false;
            } catch (e) { return localConsent; }
        }
        function promptKVKK() {
            const modal = document.getElementById('kvkkModal');
            document.getElementById('kvkkCheck').checked = false;
            document.getElementById('kvkkAcceptBtn').disabled = true;
            modal.classList.add('show');
        }
        async function acceptKVKK() {
            setLocalKVKKState({ accepted: true, version: KVKK_VERSION, acceptedAt: new Date().toISOString() });
            if (auth && auth.currentUser) {
                try {
                    await fetch('/api/consent/kvkk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: KVKK_VERSION }) });
                } catch (e) { console.warn('KVKK cloud sync failed'); }
            }
            document.getElementById('kvkkModal').classList.remove('show');
            analyze();
        }
        function declineKVKK() {
            document.getElementById('kvkkModal').classList.remove('show');
            showError('KVKK onayı olmadan analiz başlatılamaz.');
        }

        // ===== ANALYZE =====
        async function analyze() {
            const symptoms = document.getElementById('symptomInput').value.trim();
            if (!symptoms && !selectedFile) { showToast('Lütfen belirtilerinizi yazın.', 'error'); return; }
            if (!(await checkKVKK())) { promptKVKK(); return; }

            showLoading(true);
            currentAbortController = new AbortController();
            const signal = currentAbortController.signal;

            try {
                let result;
                if (selectedFile) {
                    const formData = new FormData();
                    formData.append('image', selectedFile);
                    if (symptoms) formData.append('symptoms', symptoms);
                    const res = await fetch('/api/analyze-image', { method: 'POST', body: formData, signal });
                    const data = await res.json();
                    if (data.error) throw new Error(data.error);
                    result = data.result;
                } else {
                    const res = await fetch('/api/analyze-symptoms', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ symptoms, history: followUpHistory.map(h => h.answer) }),
                        signal
                    });
                    const data = await res.json();
                    if (data.error) throw new Error(data.error);
                    result = data.result;
                }

                currentOriginalSymptoms = symptoms || 'Görüntü Analizi';
                currentResult = result;
                displayResults(result);
                document.getElementById('results').style.display = 'block';
            } catch (error) {
                if (error.name !== 'AbortError') showToast(error.message, 'error');
            } finally {
                showLoading(false);
                currentAbortController = null;
            }
        }

        async function handleFollowUp(qIndex, answer) {
            const question = (followUpQuestionsQueue[qIndex].q || followUpQuestionsQueue[qIndex].soru);
            followUpHistory.push({ question, answer });
            
            // Soru kartlarını temizle ve yükleniyor göster
            const wizardArea = document.getElementById('wizardArea');
            if (wizardArea) wizardArea.innerHTML = '<div class="wizard-loading">Analiz derinleştiriliyor...</div>';
            
            analyze();
        }

        // ===== DISPLAY RESULTS (DASHBOARD TOP, ASSISTANT BOTTOM) =====
        async function displayResults(result) {
            try {
                const container = document.getElementById('resultsContainer');
                container.style.display = 'block';
                container.innerHTML = ''; // Temizle
                
                const analysis = result.analiz || {};
                const teshisler = analysis.teshisler || result.teshisler || [];
                const risk_level = analysis.risk_seviyesi || result.risk_seviyesi || 'Normal';
                const riskColor = risk_level.includes('Kritik') || risk_level.includes('Yüksek') ? 'var(--red)' : 
                                 (risk_level.includes('Orta') ? 'var(--amber)' : 'var(--green)');

                const asistanMesaji = result.asistan_notu || result.asistan_mesaji || 'Analizinizi tamamladım. Size nasıl yardımcı olabilirim?';
                const takeawayItems = (result.cikarimlar || []).filter(Boolean).slice(0, 4);
                const takeawaysBlock = takeawayItems.length
                    ? `<ul class="visit-takeaways">${takeawayItems.map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`
                    : '';

                const dg = result.doktora_gitme || {};
                const doktorSeviye = dg.aciliyet || dg.seviye || 'Orta';
                const doktorNot = dg.aciklama || dg.not || '';

                let reportHtml = `
                <div class="visit-flow animate-fade-in">
                    <div id="visitSummaryTop" class="visit-summary-card">
                        <p class="visit-kicker">Önce sizi dinledim</p>
                        <div class="visit-narrative">${escapeHtml(asistanMesaji).replace(/\n/g, '<br>')}</div>
                        ${takeawaysBlock}
                    </div>

                    <details class="clinical-drawer animate-fade-in">
                        <summary>
                            <span style="display:inline-block; width: 12px; height: 12px; border-radius: 50%; background: ${riskColor}; box-shadow: 0 0 10px ${riskColor}; flex-shrink:0;"></span>
                            Olası tablolar ve öneriler (detay)
                        </summary>
                        <div style="margin-top: 18px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 18px;">
                            <div class="main-grid" style="gap: 15px; margin-bottom: 15px;">
                                <div class="tech-card" style="border-left: 3px solid var(--purple); padding: 15px;">
                                    <span class="tech-title" style="color: var(--purple); font-size: 0.9rem;">Olası durumlar</span>
                                    <div class="diagnoses-list">
                                        ${teshisler.map(t => `
                                            <div style="margin-bottom: 8px;">
                                                <strong>${escapeHtml(t.ad || t.hastalik)}</strong> <span style="color:var(--text-muted)">(${escapeHtml(t.oran || t.olasilik || '%-')})</span>
                                                <div style="font-size: 0.85rem; color: var(--text-secondary); margin-top:3px;">${escapeHtml(t.neden || t.aciklama || '')}</div>
                                            </div>
                                        `).join('')}
                                    </div>
                                </div>
                                <div class="tech-card" style="border-left: 3px solid var(--teal); padding: 15px;">
                                    <span class="tech-title" style="color: var(--teal); font-size: 0.9rem;">Tüm çıkarımlar</span>
                                    <ul style="padding-left: 20px; font-size: 0.9rem; color: var(--text-secondary); margin-top:8px;">${(result.cikarimlar || []).map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>
                                </div>
                            </div>
                            <div class="main-grid" style="gap: 15px; margin-bottom: 15px;">
                                <div class="tech-card" style="border-left: 3px solid var(--green); padding: 15px;">
                                    <span style="color: var(--green); font-weight: bold; font-size: 0.9rem;">Yapmanız iyi olur</span>
                                    <ul style="padding-left: 20px; font-size: 0.9rem; color: var(--text-secondary); margin-top:8px;">${(result.yapilmasi_gerekenler || []).map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>
                                </div>
                                <div class="tech-card" style="border-left: 3px solid var(--red); padding: 15px;">
                                    <span style="color: var(--red); font-weight: bold; font-size: 0.9rem;">Dikkat / kaçının</span>
                                    <ul style="padding-left: 20px; font-size: 0.9rem; color: var(--text-secondary); margin-top:8px;">${(result.kacinilmasi_gerekenler || []).map(i => `<li>${escapeHtml(i)}</li>`).join('')}</ul>
                                </div>
                            </div>
                            <div style="display:flex; flex-wrap:wrap; justify-content:space-between; align-items:center; gap:12px; background: rgba(251, 191, 36, 0.08); padding: 15px; border-radius: 12px; border-left: 3px solid var(--amber);">
                                <div style="flex:1; min-width:200px;">
                                    <h3 style="color:var(--amber); margin:0 0 5px 0; font-size: 0.95rem;">Doktora ne zaman başvurayım?</h3>
                                    <p style="margin:0; font-size:0.88rem; color:var(--text-primary); line-height:1.45;"><strong>${escapeHtml(doktorSeviye)}</strong> — ${escapeHtml(doktorNot)}</p>
                                </div>
                                <div style="display:flex; gap:10px; flex-wrap:wrap;">
                                    <button type="button" onclick="elevateToPro()" class="premium-pulse-btn" style="background:linear-gradient(135deg, #4f46e5, #7c3aed); color:white; border:none; padding:10px 16px; border-radius:10px; cursor:pointer; font-weight:600; white-space:nowrap; box-shadow: 0 4px 15px rgba(124, 58, 237, 0.3); display:flex; align-items:center; gap:8px;">
                                        <span style="display:inline-block; width:8px; height:8px; background:white; border-radius:50%; box-shadow:0 0 8px white;"></span>
                                        En Detaylı Analiz (PRO)
                                    </button>
                                    <button type="button" onclick="generateDoctorReport()" style="background:var(--purple); color:white; border:none; padding:10px 16px; border-radius:10px; cursor:pointer; font-weight:600; white-space:nowrap;">Rapor hazırla</button>
                                </div>
                            </div>
                        </div>
                    </details>

                    <div id="wizardArea" class="wizard-container"></div>
                </div>
                `;
                container.innerHTML = reportHtml;
                
                // Automatically enable chat mode for a ChatGPT-like experience
                const chatInputArea = document.getElementById('chatInputArea');
                if (chatInputArea) {
                    chatInputArea.style.display = 'flex';
                }
                
                followUpQuestionsQueue = result.sorular || result.takip_sorulari || [];
                followUpQuestionIndex = 0;
                renderFollowUpQuestions(followUpQuestionsQueue);
                
                setTimeout(() => {
                    const top = document.getElementById('visitSummaryTop');
                    if (top) top.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }, 120);

            } catch (e) { 
                console.error("Display Error:", e);
                showToast('Görüntüleme hatası oluştu.', 'error'); 
            }
        }

        function openChatFromWizard() {
            if (!currentResult) return;
            const encoded = encodeURIComponent(JSON.stringify(currentResult));
            startAssistantChat(encoded);
        }

        async function startAssistantChat() {
            const result = currentResult;
            if (!result) return;
            const container = document.getElementById('resultsContainer');
            const assistantName = localStorage.getItem('sa_assistantName') || 'SağlıkAI Asistanı';

            const btn = document.querySelector('.start-chat-btn');
            if(btn) btn.style.display = 'none';

            document.getElementById('chatInputArea').style.display = 'flex';

            const bubbleId = 'asst-' + Date.now();
            container.insertAdjacentHTML('beforeend', `
                <div id="${bubbleId}" class="chat-bubble bubble-assistant animate-fade-in" style="width: 100%; max-width: 100%; border-radius: 16px; background: rgba(34, 211, 238, 0.05); border: 1px solid rgba(34, 211, 238, 0.15); padding: 15px;">
                    <div class="chat-header" style="color: var(--teal); font-weight: 700; letter-spacing: 0.5px; font-size: 0.75rem; margin-bottom: 8px; text-transform: uppercase;">✨ ${escapeHtml(assistantName)}</div>
                    <div class="asistan-speech" style="font-size: 0.95rem; line-height: 1.6; color: var(--text-primary); font-weight: 400; letter-spacing: 0.2px;">${escapeHtml(result.asistan_mesaji || 'Nasıl yardımcı olabilirim?').replace(/\n/g, '<br>')}</div>
                    <div class="chat-action-icons" style="margin-top: 10px;">
                        <button onclick="copyResults('results')" title="Kopyala" style="background:none; border:none; color:var(--text-muted); cursor:pointer;"><i class="far fa-copy"></i> Kopyala</button>
                    </div>
                </div>
            `);
            document.getElementById(bubbleId).scrollIntoView({ behavior: 'smooth' });
        }

        // ===== VIP PRO ELEVATION =====
        async function elevateToPro() {
            if (!currentResult) return;
            showLoading('Eksper Konsey (Gemini Pro) analiz ediyor...');
            try {
                let headers = { 'Content-Type': 'application/json' };
                if (typeof getAuthHeaders === 'function') {
                    try { headers = await getAuthHeaders(); } catch(e){}
                }
                const res = await fetch('/api/elevate-to-pro', {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify({ analysis: currentResult, symptoms: currentOriginalSymptoms })
                });
                const data = await res.json();
                if (data.error) throw new Error(data.error);
                
                startAssistantChatPro(data.result);
            } catch (e) {
                showToast('Hata: ' + e.message, 'error');
            } finally {
                hideLoading();
            }
        }
        
        async function startAssistantChatPro(proResult) {
            const container = document.getElementById('resultsContainer');
            const chatArea = document.getElementById('chatInputArea');
            if (chatArea) chatArea.style.display = 'flex';
            
            const bubbleId = 'pro-' + Date.now();
            container.insertAdjacentHTML('beforeend', `
                <div id="${bubbleId}" class="chat-bubble bubble-assistant animate-fade-in" style="width: 100%; max-width: 100%; border-radius: 16px; background: rgba(239, 68, 68, 0.05); border: 1px solid rgba(239, 68, 68, 0.2); padding: 15px; border-left: 4px solid var(--red);">
                    <div class="chat-header" style="color: var(--red); font-weight: 700; font-size: 0.8rem; margin-bottom: 8px; text-transform: uppercase;">🌟 EKSPER GÖRÜŞÜ (GEMINI PRO)</div>
                    <div class="asistan-speech" style="font-size: 0.95rem; line-height: 1.6; color: var(--text-primary); font-weight: 400;">${escapeHtml(proResult.uzman_notu).replace(/\n/g, '<br>')}</div>
                    <ul style="margin-top:10px; padding-left:20px; color:var(--text-secondary); font-size:0.9rem;">
                        ${(proResult.kiritik_ihtimaller || []).map(i => `<li style="margin-bottom:4px;">${escapeHtml(i)}</li>`).join('')}
                    </ul>
                </div>
            `);
            document.getElementById(bubbleId).scrollIntoView({ behavior: 'smooth' });
        }

        // ===== CONTINUOUS CHAT LOGIC =====
        let currentChatHistory = [];

        async function generateDoctorReport() {
            if (!currentResult) {
                showToast('Önce bir analiz yapmalısınız.', 'error');
                return;
            }
            
            showToast('Klinik rapor hazırlanıyor...', 'info');
            
            try {
                const res = await fetch('/api/doctor-report', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ analysis: currentResult })
                });
                const data = await res.json();
                if (data.error) throw new Error(data.error);

                const r = data.result;
                
                // Populating the Patient Prep Modal
                document.getElementById('repDate').textContent = new Date().toLocaleString('tr-TR');
                
                document.getElementById('repHastaBeyani').textContent = r.hasta_beyani_ozeti || '-';
                
                // List Helpers
                const populateList = (id, items) => {
                    const el = document.getElementById(id);
                    if (el) {
                        el.innerHTML = (items || []).map(i => `<li>${i}</li>`).join('');
                    }
                };

                populateList('repAnaSemptomlar', r.ana_semptomlar);
                populateList('repEslikEden', r.eslik_eden_durumlar);
                
                document.getElementById('repSiddetSure').textContent = r.siddet_ve_sure || 'Belirtilmemiş';

                populateList('repTetikleyiciler', r.tetikleyici_veya_hafifletici_faktorler);
                populateList('repDoktorSorulari', r.doktora_sorulabilecek_sorular);

                // Show Modal
                document.getElementById('clinicalReportModal').classList.add('show');

                // Also save to history list
                const reportsList = document.getElementById('reportsList');
                const noData = reportsList.querySelector('.no-data');
                if (noData) noData.remove();

                const card = document.createElement('div');
                card.className = 'report-card animate-fade-in';
                const cardHeader = document.createElement('div');
                cardHeader.className = 'report-card-header';
                const title = document.createElement('span');
                title.textContent = `📋 ${new Date().toLocaleString('tr-TR')}`;
                const deleteBtn = document.createElement('button');
                deleteBtn.className = 'delete-report';
                deleteBtn.textContent = '✕';
                deleteBtn.addEventListener('click', () => card.remove());
                cardHeader.appendChild(title);
                cardHeader.appendChild(deleteBtn);

                const cardBody = document.createElement('div');
                cardBody.className = 'report-card-body';
                cardBody.innerHTML = sanitizeRichHtml(data?.result?.report_html || '');

                const cardFooter = document.createElement('div');
                cardFooter.className = 'report-card-footer';
                const printBtn = document.createElement('button');
                printBtn.className = 'print-mini-btn';
                printBtn.textContent = '🖨️ Yazdır';
                printBtn.addEventListener('click', () => window.print());
                cardFooter.appendChild(printBtn);

                card.appendChild(cardHeader);
                card.appendChild(cardBody);
                card.appendChild(cardFooter);
                reportsList.prepend(card);
                
                // Switch to reports tab
                switchTab('tab-reports', document.querySelector('[onclick*="tab-reports"]'));
                showToast('Rapor "Hekim Raporları" sekmesine eklendi.', 'success');
                
            } catch (error) {
                showToast('Hata: ' + error.message, 'error');
            }
        }

        // ===== EMERGENCY MAP LOGIC =====
        let map = null;
        let userMarker = null;
        let mapMarkers = [];

        function initMap() {
            if (map) {
                setTimeout(() => map.invalidateSize(), 200);
                return;
            }
            
            // Default center (Turkey center)
            map = L.map('healthMap').setView([39.9334, 32.8597], 6);
            
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; OpenStreetMap'
            }).addTo(map);

            centerOnUser();
        }

        function centerOnUser() {
            if (!navigator.geolocation) {
                showToast('Tarayıcınız konumu desteklemiyor.', 'error');
                return;
            }

            navigator.geolocation.getCurrentPosition(pos => {
                const { latitude, longitude } = pos.coords;
                map.setView([latitude, longitude], 14);
                
                if (userMarker) map.removeLayer(userMarker);
                userMarker = L.marker([latitude, longitude]).addTo(map).bindPopup('Siz Buradasınız').openPopup();
                
            }, err => {
                showToast('Konum erişimi reddedildi.', 'warning');
            });
        }

        async function findNearby(type, keyword = null) {
            const center = map.getCenter();
            const lat = center.lat;
            const lng = center.lng;

            const searchType = keyword ? 'Özel Arama' : (type === 'hospital' ? 'Hastaneler' : 'Eczaneler');
            showToast(`${searchType} aranıyor...`, 'info');

            // Using Overpass API
            let query = '';
            if (keyword) {
                // Search for healthcare nodes with specific name or speciality
                query = `[out:json];(node["healthcare"]~"${keyword}",i](around:10000, ${lat}, ${lng});node["name"]~"${keyword}",i](around:10000, ${lat}, ${lng}););out;`;
            } else {
                query = `[out:json];node["amenity"="${type}"](around:5000, ${lat}, ${lng});out;`;
            }
            
            const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;

            try {
                const res = await fetch(url);
                const data = await res.json();
                
                mapMarkers.forEach(m => map.removeLayer(m));
                mapMarkers = [];

                if (data.elements.length === 0) {
                    showToast('Yakında sonuç bulunamadı.', 'warning');
                    return;
                }

                data.elements.forEach(el => {
                    const safeName = escapeHtml(el.tags?.name || (type === 'hospital' ? 'Sağlık Merkezi' : 'Kurum'));
                    const safeStreet = escapeHtml(el.tags?.['addr:street'] || el.tags?.['healthcare:speciality'] || 'Bilgi yok');
                    const marker = L.marker([el.lat, el.lon]).addTo(map)
                        .bindPopup(`<b>${safeName}</b><br>${safeStreet}<br><a href="https://www.google.com/maps/search/${encodeURIComponent(safeName)}" target="_blank" style="color:var(--teal); font-size:12px;">Yol Tarifi Al</a>`);
                    mapMarkers.push(marker);
                });

                showToast(`${data.elements.length} sonuç bulundu.`, 'success');
                
            } catch (error) {
                showToast('Harita verisi alınamadı.', 'error');
            }
        }

        function findNearbySpecialist(specialty) {
            switchTab('tab-map', document.querySelector('[onclick*="tab-map"]'));
            initMap();
            setTimeout(() => findNearby('hospital', specialty), 800);
        }


        async function sendChatMessage() {
            const inputEl = document.getElementById('continuousChatInput');
            const btnEl = document.getElementById('chatSendBtn');
            const assistantName = localStorage.getItem('sa_assistantName') || 'SağlıkAI Asistanı';
            const message = inputEl.value.trim();
            
            if (!message) return;
            
            // Add user message to UI and history
            inputEl.value = '';
            inputEl.disabled = true;
            btnEl.disabled = true;
            
            await addMessage(message, 'user');
            currentChatHistory.push({ sender: 'user', text: message });
            
            // Show typing indicator
            const typingId = 'typing-' + Date.now();
            const container = document.getElementById('resultsContainer');
            container.insertAdjacentHTML('beforeend', `
                <div id="${typingId}" class="chat-bubble bubble-assistant typing-indicator">
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                </div>
            `);
            container.lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'end' });

            try {
                const chatAbort = new AbortController();
                const chatTimer = setTimeout(() => chatAbort.abort(), 20000); // 20sn frontend koruması
                
                const res = await fetch('/api/chat-followup', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        history: currentChatHistory,
                        message: message,
                        analysisContext: currentResult || null
                    }),
                    signal: chatAbort.signal
                });
                clearTimeout(chatTimer);

                if (!res.ok) throw new Error('Cevap alınamadı.');
                const data = await res.json();
                
                // Remove typing indicator
                const typingEl = document.getElementById(typingId);
                if(typingEl) typingEl.remove();
                
                // Add assistant message
                const miniAnalizHtml = (data.mini_analiz || [])
                    .map(item => `<li>${escapeHtml(item)}</li>`)
                    .join('');

                let soruKartlariHtml = '';
                if (data.karsi_sorular && data.karsi_sorular.length > 0) {
                    const formId = 'followup-form-' + Date.now();
                    
                    const questionsHtml = data.karsi_sorular.map((q, idx) => {
                        const seceneklerHtml = (q.secenekler || []).map(opt => `
                            <label style="display:flex; align-items:center; gap:8px; background: rgba(34,211,238,0.05); border: 1px solid rgba(34,211,238,0.2); padding: 8px 12px; border-radius: 8px; cursor: pointer; transition: 0.2s;">
                                <input type="radio" name="q_${idx}" value="${escapeHtml(opt)}" style="accent-color: var(--teal); width: 16px; height: 16px;">
                                <span style="font-size: 0.9rem; color: var(--text-primary);">${escapeHtml(opt)}</span>
                            </label>
                        `).join('');
                        
                        return `
                            <div style="margin-bottom: 15px;">
                                <div style="font-size: 0.9rem; color: var(--teal); margin-bottom: 8px; font-weight: 600;">${escapeHtml(q.soru)}</div>
                                <div style="display: flex; flex-direction: column; gap: 6px;">
                                    ${seceneklerHtml}
                                </div>
                            </div>
                        `;
                    }).join('');

                    soruKartlariHtml = `
                        <div id="${formId}" class="chat-followup-form" style="margin-top: 20px; padding: 15px; background: rgba(0,0,0,0.2); border-radius: 12px; border: 1px dashed rgba(34, 211, 238, 0.3);">
                            <div style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 15px;">Teşhisi netleştirmek için lütfen size uygun olanları seçin veya yazın:</div>
                            ${questionsHtml}
                            <div style="margin-top: 15px;">
                                <textarea id="${formId}-custom" placeholder="Kendi cevabınız veya eklemek istedikleriniz..." rows="2" style="width: 100%; padding: 10px; border-radius: 8px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: var(--text-primary); resize: none; font-family: inherit; font-size: 0.9rem;"></textarea>
                            </div>
                            <button onclick="submitMultiFollowUp('${formId}', ${data.karsi_sorular.length})" style="margin-top: 15px; width: 100%; background: var(--teal); color: #000; border: none; padding: 10px; border-radius: 8px; font-weight: bold; cursor: pointer; transition: 0.2s; box-shadow: 0 4px 15px rgba(34, 211, 238, 0.3);">Cevapları Gönder</button>
                        </div>
                    `;
                }

                const assistantHtml = `
                    <div class="chat-bubble bubble-assistant animate-fade-in" style="width: 100%; max-width: 100%; border-radius: 16px; background: rgba(34, 211, 238, 0.05); border: 1px solid rgba(34, 211, 238, 0.15); padding: 15px;">
                        <div class="chat-header" style="color: var(--teal); font-weight: 700; letter-spacing: 0.5px; font-size: 0.75rem; margin-bottom: 8px; text-transform: uppercase;">✨ ${escapeHtml(assistantName)}</div>
                        <div class="asistan-speech" style="font-size: 0.95rem; line-height: 1.6; color: var(--text-primary); font-weight: 400; letter-spacing: 0.2px;">${escapeHtml(String(data.response || '')).replace(/\n/g, '<br>')}</div>
                        ${miniAnalizHtml ? `<ul style="margin-top:8px; font-size: 0.9rem;">${miniAnalizHtml}</ul>` : ''}
                        ${soruKartlariHtml}
                    </div>
                `;
                container.insertAdjacentHTML('beforeend', assistantHtml);
                container.lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'end' });
                
                currentChatHistory.push({ sender: 'assistant', text: data.response });
                
            } catch (error) {
                const typingEl = document.getElementById(typingId);
                if(typingEl) typingEl.remove();
                if (error.name === 'AbortError') {
                    showToast('Sunucu yanıt vermedi (zaman aşımı). Tekrar deneyin.', 'warning');
                } else {
                    showToast('Bağlantı hatası: ' + (error.message || 'Bilinmiyor'), 'error');
                }
            } finally {
                inputEl.disabled = false;
                btnEl.disabled = false;
                inputEl.focus();
            }
        }

        function quickFillChat(text) {
            const inputEl = document.getElementById('continuousChatInput');
            if (!inputEl) return;
            inputEl.value = text;
            inputEl.focus();
        }
        async function renderFollowUpQuestions(questions) {
            const wizardArea = document.getElementById('wizardArea');
            if (!wizardArea) return;
            wizardArea.innerHTML = '';

            if (!questions || !questions.length) {
                wizardArea.innerHTML = `
                    <div class="visit-closure animate-fade-in">
                        <p>Şimdilik yeterli bilgi toplandı; yeni soru gerekmiyor.</p>
                        <p class="hint">İsterseniz aşağıdaki yazışma alanından devam edebilirsiniz.</p>
                    </div>
                `;
                return;
            }

            const formId = 'initial-followup-form-' + Date.now();

            const questionsHtml = questions.map((q, idx) => {
                const opts = q.opts || q.secenekler || [];
                const seceneklerHtml = opts.map(opt => `
                    <label class="visit-opt">
                        <input type="radio" name="q_${idx}" value="${escapeHtml(opt)}">
                        <span>${escapeHtml(opt)}</span>
                    </label>
                `).join('');

                return `
                    <div class="visit-q-block">
                        <div class="visit-q-label"><span class="visit-q-num">${idx + 1}</span>${escapeHtml(q.q || q.soru)}</div>
                        <div>${seceneklerHtml}</div>
                    </div>
                `;
            }).join('');

            const wizardHtml = `
                <div id="${formId}" class="visit-mcq-panel animate-fade-in">
                    <div class="visit-mcq-head">Birkaç net soru</div>
                    <p class="visit-mcq-sub">Doktor muayenesindeki gibi — lütfen her soruda size en yakın seçeneği işaretleyin. Yazı yazmanız gerekmez.</p>
                    ${questionsHtml}
                    <details class="visit-mcq-note">
                        <summary>İsterseniz kısa bir ek not ekleyin (isteğe bağlı)</summary>
                        <textarea id="${formId}-custom" placeholder="Örn: kullandığım ilaç, kronik rahatsızlık…" rows="2"></textarea>
                    </details>
                    <button type="button" class="visit-submit-btn" onclick="submitMultiFollowUp('${formId}', ${questions.length})">Cevapları gönder ve güncelle</button>
                </div>
            `;

            wizardArea.innerHTML = wizardHtml;
        }

        function quickFillChatAndSend(text) {
            const inputEl = document.getElementById('continuousChatInput');
            if (!inputEl) return;
            inputEl.value = text;
            
            // Remove the quick reply buttons so they don't click it again
            const wizardArea = document.getElementById('wizardArea');
            if(wizardArea) wizardArea.innerHTML = '';
            
            sendChatMessage();
        }

        function submitMultiFollowUp(formId, qCount) {
            const form = document.getElementById(formId);
            if (!form) return;

            const isInitialWizard = formId.startsWith('initial-followup-form-');

            let answers = [];
            for (let i = 0; i < qCount; i++) {
                const checked = form.querySelector(`input[name="q_${i}"]:checked`);
                if (checked) {
                    answers.push(`Soru ${i + 1}: ${checked.value}`);
                } else if (isInitialWizard) {
                    showToast('Lütfen her soruda bir seçenek işaretleyin.', 'warning');
                    return;
                }
            }

            const customInput = document.getElementById(`${formId}-custom`);
            if (customInput && customInput.value.trim()) {
                answers.push(`Ek notum: ${customInput.value.trim()}`);
            }

            if (answers.length === 0) {
                showToast('Lütfen en az bir seçim yapın veya kısa not yazın.', 'warning');
                return;
            }

            const finalMessage = answers.join(' | ');
            form.style.display = 'none';

            if (isInitialWizard) {
                processFollowUp(finalMessage);
                return;
            }

            const inputEl = document.getElementById('continuousChatInput');
            if (inputEl) {
                inputEl.value = finalMessage;
                sendChatMessage();
            }
        }

        function nextFollowUpQuestion() {
            if (!followUpQuestionsQueue || followUpQuestionsQueue.length === 0) return;
            followUpQuestionIndex = (followUpQuestionIndex + 1) % followUpQuestionsQueue.length;
            renderFollowUpQuestions(followUpQuestionsQueue);
        }

        async function selectFollowUp(btn, question, answer) {
            const fullAnswer = `${question}: ${answer}`;
            await processFollowUp(fullAnswer);
        }

        async function sendCustomFollowUp() {
            const input = document.getElementById('followupCustomInput');
            const text = input.value.trim();
            if (!text) return;
            input.value = '';
            await processFollowUp(text);
        }

        async function processFollowUp(answerText) {
            // Add user answer to chat history
            followUpHistory.push({ answer: answerText });

            // Show user message in chat
            const container = document.getElementById('resultsContainer');
            const userHtml = `
                <div class="chat-bubble bubble-user">
                    <div class="chat-header">Siz</div>
                    ${escapeHtml(answerText)}
                </div>
            `;
            container.insertAdjacentHTML('beforeend', userHtml);
            container.lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'end' });

            // Show typing indicator
            const typingId = 'typing-' + Date.now();
            container.insertAdjacentHTML('beforeend', `
                <div id="${typingId}" class="chat-bubble bubble-assistant typing-indicator">
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                </div>
            `);
            container.lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'end' });

            try {
                const fuAbort = new AbortController();
                const fuTimer = setTimeout(() => fuAbort.abort(), 20000);
                
                const res = await fetch('/api/follow-up', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        originalSymptoms: currentOriginalSymptoms,
                        previousResult: currentResult,
                        followUpAnswer: followUpHistory.map(h => h.answer).join('. ')
                    }),
                    signal: fuAbort.signal
                });
                clearTimeout(fuTimer);
                const data = await res.json();
                if (data.error) throw new Error(data.error);

                // Remove typing indicator
                const typingEl = document.getElementById(typingId);
                if(typingEl) typingEl.remove();

                currentResult = data.result;
                
                // Takip cevabı geldi — artık yeni soru SORMA, son kararı göster
                data.result.sorular = [];
                data.result.takip_sorulari = [];
                displayResults(data.result);
                
                // Wizard alanını zorla kapat
                const wizardArea = document.getElementById('wizardArea');
                if (wizardArea) {
                    wizardArea.innerHTML = `
                        <div class="visit-closure animate-fade-in" style="text-align:center; padding:20px;">
                            <div style="font-size:1.5rem; margin-bottom:8px;">✅</div>
                            <p style="font-weight:600; color:var(--green);">Analiz tamamlandı.</p>
                            <p class="hint" style="color:var(--text-muted); font-size:0.85rem;">Detaylar yukarıdaki raporda. Aşağıdan sohbete devam edebilirsiniz.</p>
                        </div>
                    `;
                }
                
                // Keep view focused on top of results
                document.getElementById('resultsContainer').scrollIntoView({ behavior: 'smooth', block: 'start' });
                showToast('Analiz güncellendi — sonuçlar hazır.', 'success');

            } catch (error) {
                const typingEl = document.getElementById(typingId);
                if(typingEl) typingEl.remove();
                showToast('Takip analizi hatası: ' + error.message, 'error');
                renderFollowUpQuestions(currentResult?.takip_sorulari || []);
            }
        }

        // ===== DISEASE SEARCH =====
        async function searchDisease() {
            const disease = document.getElementById('diseaseInput').value.trim();
            if (!disease) return;

            const loading = document.getElementById('diseaseLoading');
            const results = document.getElementById('diseaseResults');
            const btn = document.getElementById('diseaseAnalyzeBtn');
            const errBox = document.getElementById('diseaseErrorBox');
            
            hideDiseaseError();
            results.style.display = 'none';
            loading.style.display = 'flex';
            btn.disabled = true;

            currentAbortController = new AbortController();
            const signal = currentAbortController.signal;

            try {
                const res = await fetch('/api/disease-info', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ disease }),
                    signal: signal
                });
                const data = await res.json();

                if (data.error) throw new Error(data.error);
                const result = data.result;

                // Sync with server.js fields (hastalik_tanimi, etc.)
                document.getElementById('diseaseSummaryText').textContent = result.hastalik_tanimi || "Hastalık hakkında özet bilgi bulunamadı.";

                renderList('diseaseModernList', result.modern_tedaviler, '💊');
                renderList('diseaseTradList', result.geleneksel_ve_dogal_yontemler, 'ℹ️');
                renderList('diseaseExpertsList', result.turkiyede_uzman_kurumlar_ve_gelismeler, '🏛️');

                // Clinic & Expert Recommendations UI
                const clinicRec = document.getElementById('clinicRecommendations');
                if (result.klinik_ve_uzman_onerileri) {
                    const rec = result.klinik_ve_uzman_onerileri;
                    document.getElementById('clinicSpecialty').textContent = rec.uzmanlik_alanlari?.join(', ') || 'Belirtilmedi';
                    document.getElementById('clinicType').textContent = rec.hastane_tipleri?.join(', ') || 'Genel Kurumlar';
                    document.getElementById('clinicPopCenters').textContent = rec.turkiyedeki_populer_merkezler?.join(', ') || 'Büyük Şehirler';
                    
                    const mapBtn = document.getElementById('clinicMapBtn');
                    const searchKeyword = rec.arama_terimleri?.[0] || rec.uzmanlik_alanlari?.[0] || disease;
                    mapBtn.onclick = () => findNearbySpecialist(searchKeyword);
                    
                    clinicRec.style.display = 'block';
                } else {
                    clinicRec.style.display = 'none';
                }

                results.style.display = 'block';
                results.scrollIntoView({ behavior: 'smooth', block: 'start' });

            } catch (error) {
                if (error.name === 'AbortError') return;
                showDiseaseError(error.message || 'Arama sırasında bir hata oluştu.');
            } finally {
                loading.style.display = 'none';
                btn.disabled = false;
                currentAbortController = null;
            }
        }

        // ===== HELPERS =====
        function renderList(id, items, emoji) {
            const list = document.getElementById(id);
            if (!list) return;
            list.innerHTML = '';
            if (!items || !items.length) {
                list.innerHTML = '<li>Bilgi bulunamadı.</li>';
                return;
            }
            items.forEach(item => {
                const li = document.createElement('li');
                const icon = document.createElement('span');
                icon.textContent = emoji;
                li.appendChild(icon);
                li.appendChild(document.createTextNode(` ${String(item ?? '')}`));
                list.appendChild(li);
            });
        }

        function showLoading(show) {
            const overlay = document.getElementById('loadingOverlay');
            const btn = document.getElementById('analyzeBtn');
            const loadingBox = document.getElementById('loading');
            
            if (show) {
                if (overlay) overlay.classList.add('show');
                if (loadingBox) loadingBox.style.display = 'flex';
                if (btn) { btn.classList.add('loading'); btn.disabled = true; }
            } else {
                if (overlay) overlay.classList.remove('show');
                if (loadingBox) loadingBox.style.display = 'none';
                if (btn) { btn.classList.remove('loading'); btn.disabled = false; }
            }
        }

        function showDiseaseError(msg) {
            const box = document.getElementById('diseaseErrorBox');
            box.textContent = msg;
            box.classList.add('show');
        }

        function hideDiseaseError() {
            document.getElementById('diseaseErrorBox').classList.remove('show');
        }

        function showError(msg) {
            const box = document.getElementById('errorBox');
            box.textContent = msg;
            box.classList.add('show');
        }

        function hideError() {
            document.getElementById('errorBox').classList.remove('show');
        }

        // ===== DASHBOARD HERO FUNCTIONS =====
        function addHeroChip(symptom) {
            const ta = document.getElementById('heroSymptomInput');
            const current = ta.value.trim();
            if (current && !current.endsWith(',')) {
                ta.value = current + ', ' + symptom;
            } else {
                ta.value = current ? current + ' ' + symptom : symptom;
            }
            ta.focus();
        }

        function heroAnalyze() {
            const heroText = document.getElementById('heroSymptomInput').value.trim();
            if (!heroText && !selectedFile) {
                showToast('Lütfen belirtilerinizi yazın veya fotoğraf yükleyin.', 'error');
                return;
            }
            // Transfer text to tab-ai's input
            if (heroText) {
                document.getElementById('symptomInput').value = heroText;
            }
            // Switch to AI tab and trigger analysis
            switchTab('tab-ai', '🔬 Yapay Zeka Teşhis');
            setTimeout(() => analyze(), 300);
        }

        // ===== TAB NAVIGATION & DISCLAIMER =====
        let disclaimerAccepted = false;
        let targetTabBtn = null;

        function switchTab(tabId, tabNameOrBtn) {
            document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
            document.getElementById(tabId).classList.add('active');
            
            // Just in case old logic is used
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            if (tabNameOrBtn && typeof tabNameOrBtn === 'object' && tabNameOrBtn.classList) {
                tabNameOrBtn.classList.add('active');
            }
            
            const breadcrumb = document.getElementById('mainBreadcrumb');
            if (breadcrumb) {
                if (tabId === 'tab-dashboard') {
                    breadcrumb.style.display = 'none';
                } else {
                    breadcrumb.style.display = 'flex';
                    if (typeof tabNameOrBtn === 'string') {
                        document.getElementById('breadcrumbText').textContent = tabNameOrBtn;
                    }
                }
            }
        }

        // ===== LIVE NEWS FUNCTIONS =====
        let newsInitialized = false;
        let lastUpdateInterval = null;

        function initNewsTab() {
            if (newsInitialized) return;
            newsInitialized = true;
            
            // Randomly pick a featured story for the spotlight
            updateSpotlight();
            startLastUpdatedClock();
        }

        function updateSpotlight() {
            const cards = document.querySelectorAll('#newsFeedGrid .live-news-card');
            if (cards.length === 0) return;
            
            const randomCard = cards[Math.floor(Math.random() * cards.length)];
            const title = randomCard.querySelector('.lnc-title').textContent;
            const desc = randomCard.querySelector('.lnc-desc').textContent;
            const icon = randomCard.querySelector('.lnc-emoji').textContent;
            
            const spotlightTitle = document.getElementById('spotlightTitle');
            const spotlightDesc = document.getElementById('spotlightDesc');
            const spotlightIcon = document.getElementById('spotlightIcon');
            
            if (spotlightTitle) spotlightTitle.textContent = title;
            if (spotlightDesc) spotlightDesc.textContent = desc;
            if (spotlightIcon) spotlightIcon.textContent = icon;
        }

        function startLastUpdatedClock() {
            let seconds = 0;
            if (lastUpdateInterval) clearInterval(lastUpdateInterval);
            lastUpdateInterval = setInterval(() => {
                seconds++;
                const el = document.getElementById('lastUpdatedText');
                if (!el) return;
                if (seconds < 60) el.textContent = `🟢 Son güncelleme: ${seconds} saniye önce`;
                else if (seconds < 3600) el.textContent = `🟡 Son güncelleme: ${Math.floor(seconds/60)} dakika önce`;
                else el.textContent = `🔴 Veriler eski — yenilemek için ↻ Yenile tuşuna basın`;
            }, 1000);
        }

        function filterNews(cat, btn) {
            document.querySelectorAll('.news-filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const cards = document.querySelectorAll('#newsFeedGrid .live-news-card');
            cards.forEach((card, i) => {
                const cats = card.dataset.cat || '';
                const visible = cat === 'all' || cats.includes(cat);
                card.classList.toggle('hidden-card', !visible);
                if (visible) card.style.animationDelay = (i * 0.06) + 's';
            });
        }

        function refreshNewsAnim() {
            const btn = document.getElementById('refreshBtn');
            btn.classList.add('spinning');
            setTimeout(() => btn.classList.remove('spinning'), 700);
            // Re-animate all visible cards
            const cards = document.querySelectorAll('#newsFeedGrid .live-news-card:not(.hidden-card)');
            cards.forEach((card, i) => {
                card.style.animation = 'none';
                card.offsetHeight; // force reflow
                card.style.animation = '';
                card.style.animationDelay = (i * 0.07) + 's';
            });
            // Reset clock
            const el = document.getElementById('lastUpdatedText');
            if (el) el.textContent = '🟢 Son güncelleme: az önce';
            startLastUpdatedClock();
        }

        function switchTabWithDisclaimer(tabId, arg) {
            if (disclaimerAccepted) {
                switchTab(tabId, arg);
            } else {
                targetTabBtn = arg;
                document.getElementById('disclaimerModal').classList.add('show');
            }
        }

        function acceptDisclaimer() {
            disclaimerAccepted = true;
            document.getElementById('disclaimerModal').classList.remove('show');
            if (targetTabBtn) switchTab('tab-remedies', targetTabBtn);
        }

        function rejectDisclaimer() {
            document.getElementById('disclaimerModal').classList.remove('show');
        }

        // ===== MEDICATION (ECZA DOLABIM) =====
        let medSelectedFile = null;

        function handleMedFileSelect(e) {
            const file = e.target.files[0];
            if (!file) return;
            if (!file.type.startsWith('image/')) {
                showMedError('Lütfen ilaç kutusunun veya prospektüsün fotoğrafını seçin.');
                return;
            }
            medSelectedFile = file;
            const reader = new FileReader();
            reader.onload = (ev) => {
                const zone = document.getElementById('medUploadZone');
                zone.classList.add('has-image');
                document.getElementById('medUploadContent').innerHTML = `
                    <img src="${ev.target.result}" style="max-height: 80px; border-radius: 8px;" alt="İlaç Görüntüsü">
                    <div style="font-size:0.8rem; margin-top:5px; color:var(--teal);">${file.name}</div>
                `;
                document.getElementById('medAnalyzeImageBtn').disabled = false;
            };
            reader.readAsDataURL(file);
        }

        function showMedError(msg) {
            const box = document.getElementById('medErrorBox');
            box.textContent = msg;
            box.classList.add('show');
        }

        function hideMedError() {
            document.getElementById('medErrorBox').classList.remove('show');
        }

        function resetMedication() {
            document.getElementById('medResults').style.display = 'none';
            document.getElementById('medInputText').value = '';
            medSelectedFile = null;
            document.getElementById('medUploadZone').classList.remove('has-image');
            document.getElementById('medUploadContent').innerHTML = `
                <div class="upload-icon" style="font-size: 24px;">📸</div>
                <div class="upload-text">İlaç kutusunu <span>çek</span></div>
            `;
            document.getElementById('medFileInput').value = '';
            document.getElementById('medAnalyzeImageBtn').disabled = true;
            hideMedError();
        }

        async function analyzeMedication(type) {
            hideMedError();
            const loading = document.getElementById('medLoading');
            const results = document.getElementById('medResults');
            
            results.style.display = 'none';
            loading.style.display = 'flex';
            currentAbortController = new AbortController();

            try {
                let res;
                if (type === 'text') {
                    const text = document.getElementById('medInputText').value.trim();
                    if (!text) {
                        loading.style.display = 'none';
                        return showMedError('Lütfen bir ilaç adı yazın.');
                    }
                    res = await fetch('/api/analyze-medication', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ medication: text }),
                        signal: currentAbortController.signal
                    });
                } else {
                    if (!medSelectedFile) {
                        loading.style.display = 'none';
                        return showMedError('Lütfen bir fotoğraf seçin.');
                    }
                    const formData = new FormData();
                    formData.append('image', medSelectedFile);
                    res = await fetch('/api/analyze-medication-image', {
                        method: 'POST',
                        body: formData,
                        signal: currentAbortController.signal
                    });
                }

                const data = await res.json();
                if (data.error) {
                    if (type === 'image' && data.code === 'IMAGE_POLICY_REJECTED') {
                        throw new Error('Bu fotoğraf ilaç analizi için uygun değil. Lütfen ilaç kutusunu, blisteri veya prospektüsü net çekin.');
                    }
                    throw new Error(data.error);
                }
                
                const r = data.result;
                
                // Set Title and Subtext
                document.getElementById('medTitle').textContent = r.ilac_adi || 'Bilinmeyen İlaç';
                document.getElementById('medActiveSubstance').textContent = r.etkin_madde || 'Belirtilmedi';
                
                // Set Main Content
                document.getElementById('medPurposeNew').textContent = r.ne_ise_yarar || '-';
                document.getElementById('medUsageNew').textContent = r.nasil_kullanilir || '-';
                
                // Interactions
                document.getElementById('medAlcohol').textContent = r.etkilesimler?.alkol || 'Veri yok';
                document.getElementById('medFood').textContent = r.etkilesimler?.besin || 'Veri yok';
                
                // Details
                document.getElementById('medPregnancy').textContent = r.gebelik_kategorisi || 'Bilinmiyor';
                document.getElementById('medStorage').textContent = r.saklama_kosullari || 'Belirtilmedi';
                
                // Lists
                renderList('medSideEffectsList', r.yan_etkiler, '⚠️');
                renderList('medEquivalentsList', r.muadilleri, '🔄');
                
                // Risk Meter
                const riskBadge = document.getElementById('medRiskBadge');
                const risk = parseInt(r.risk_meter) || 1;
                riskBadge.textContent = risk > 7 ? 'Yüksek Risk' : (risk > 4 ? 'Orta Risk' : 'Düşük Risk');
                riskBadge.style.background = risk > 7 ? 'var(--red)' : (risk > 4 ? 'var(--amber)' : 'var(--teal)');
                
                results.style.display = 'block';
                results.scrollIntoView({ behavior: 'smooth', block: 'start' });

            } catch (error) {
                if (error.name === 'AbortError') return;
                showMedError(error.message || 'İlaç analiz edilemedi.');
            } finally {
                loading.style.display = 'none';
                currentAbortController = null;
            }
        }

        // ===== NATURAL REMEDIES =====
        function showRemedyError(msg) {
            const box = document.getElementById('remedyErrorBox');
            box.textContent = msg;
            box.classList.add('show');
        }

        function resetRemedy() {
            document.getElementById('remedyResults').style.display = 'none';
            document.getElementById('remedyInput').value = '';
            document.getElementById('remedyErrorBox').classList.remove('show');
        }

        async function searchRemedy() {
            const symptoms = document.getElementById('remedyInput').value.trim();
            if (!symptoms) return showRemedyError('Lütfen şikayetinizi yazın.');
            
            const loading = document.getElementById('remedyLoading');
            const results = document.getElementById('remedyResults');
            
            document.getElementById('remedyErrorBox').classList.remove('show');
            results.style.display = 'none';
            loading.style.display = 'flex';
            currentAbortController = new AbortController();

            try {
                const res = await fetch('/api/natural-remedies', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ symptoms }),
                    signal: currentAbortController.signal
                });
                const data = await res.json();
                if (data.error) throw new Error(data.error);
                
                const r = data.result;
                
                // Safety Check
                const alertBox = document.getElementById('remedySafetyAlert');
                const contentCards = document.getElementById('remedyContentCards');
                if (r.guvenli_mi === false) {
                    alertBox.style.display = 'flex';
                    document.getElementById('remedySafetyMsg').textContent = r.aciklama || 'Lütfen hemen acile başvurun.';
                    contentCards.style.display = 'none';
                } else {
                    alertBox.style.display = 'none';
                    contentCards.style.display = 'block';

                    // General info
                    const infoBox = document.getElementById('remedyInfoBox');
                    if (r.aciklama) {
                        infoBox.textContent = r.aciklama;
                        infoBox.style.display = 'block';
                    } else {
                        infoBox.style.display = 'none';
                    }

                    // Build categories
                    const catContainer = document.getElementById('remedyCategoriesContainer');
                    catContainer.innerHTML = '';

                    const categories = [
                        { key: 'bitkisel_caylar', icon: '🍵', title: 'Bitkisel Çaylar', color: 'var(--green)', fields: ['tarif', 'fayda'] },
                        { key: 'ev_uygulamalari', icon: '🏠', title: 'Ev Uygulamaları', color: 'var(--teal)', fields: ['aciklama'] },
                        { key: 'beslenme_onerileri', icon: '🥗', title: 'Beslenme Önerileri', color: 'var(--amber)', fields: ['aciklama'] },
                        { key: 'yasam_tarzi', icon: '🧘', title: 'Yaşam Tarzı Önerileri', color: 'var(--purple)', fields: ['aciklama'] },
                    ];

                    categories.forEach(cat => {
                        const items = r[cat.key];
                        if (!items || !items.length) return;

                        let cardsHTML = '';
                        items.forEach(item => {
                            const name = typeof item === 'string' ? item : (item.isim || item.name || '');
                            let desc = '';
                            if (typeof item === 'object') {
                                cat.fields.forEach(f => {
                                    if (item[f]) desc += (desc ? ' · ' : '') + item[f];
                                });
                            }
                            cardsHTML += `
                                <div class="remedy-rich-card" style="border-left-color: ${cat.color};">
                                    <div class="remedy-card-name">${escapeHtml(name)}</div>
                                    ${desc ? `<div class="remedy-card-desc">${escapeHtml(desc)}</div>` : ''}
                                </div>
                            `;
                        });

                        catContainer.innerHTML += `
                            <div class="remedy-category">
                                <div class="remedy-cat-header" style="color: ${cat.color};">
                                    <span>${cat.icon}</span> ${cat.title}
                                </div>
                                ${cardsHTML}
                            </div>
                        `;
                    });

                    // Don'ts
                    const dontsSection = document.getElementById('remedyDontsSection');
                    const dontsList = document.getElementById('remedyDontsList');
                    const donts = r.kacinilmasi_gerekenler;
                    if (donts && donts.length) {
                        dontsSection.style.display = 'block';
                        dontsList.innerHTML = '';
                        donts.forEach(item => {
                            const name = typeof item === 'string' ? item : (item.isim || item.name || '');
                            const reason = typeof item === 'object' ? (item.neden || '') : '';
                            dontsList.innerHTML += `
                                <div class="remedy-rich-card" style="border-left-color: var(--red);">
                                    <div class="remedy-card-name">${escapeHtml(name)}</div>
                                    ${reason ? `<div class="remedy-card-desc">${escapeHtml(reason)}</div>` : ''}
                                </div>
                            `;
                        });
                    } else {
                        dontsSection.style.display = 'none';
                    }

                    // Backward compat: if old format (onerilen_uygulamalar) exists
                    if (r.onerilen_uygulamalar && !r.bitkisel_caylar && !r.ev_uygulamalari) {
                        catContainer.innerHTML = '';
                        let fallbackHTML = '<div class="remedy-category"><div class="remedy-cat-header" style="color: var(--green);"><span>🍃</span> Önerilen Uygulamalar</div>';
                        r.onerilen_uygulamalar.forEach(item => {
                            const name = typeof item === 'string' ? item : (item.isim || '');
                            fallbackHTML += `<div class="remedy-rich-card"><div class="remedy-card-name">${escapeHtml(name)}</div></div>`;
                        });
                        fallbackHTML += '</div>';
                        catContainer.innerHTML = fallbackHTML;
                    }
                }
                
                results.style.display = 'block';
            } catch (error) {
                if (error.name === 'AbortError') return;
                showRemedyError(error.message || 'Çözüm aranırken hata oluştu.');
            } finally {
                loading.style.display = 'none';
                currentAbortController = null;
            }
        }

        // ===== HISTORY FUNCTIONS =====
        function getHistory() {
            const h = localStorage.getItem('sa_history');
            return h ? JSON.parse(h) : [];
        }

        function getHistorySignature(item) {
            return `${item.date || ''}|${item.symptoms || ''}`;
        }

        function mergeHistoryLists(localHistory, cloudHistory) {
            const merged = [];
            const seenIds = new Set();
            const seenSignatures = new Set();

            cloudHistory.forEach(item => {
                merged.push(item);
                if (item.id) seenIds.add(item.id);
                seenSignatures.add(getHistorySignature(item));
            });

            localHistory.forEach(item => {
                const hasSameId = item.id && seenIds.has(item.id);
                const hasSameSignature = seenSignatures.has(getHistorySignature(item));
                if (!hasSameId && !hasSameSignature) {
                    merged.push(item);
                }
            });

            return merged.slice(0, 20);
        }

        async function syncHistoryFromCloud() {
            if (!auth || !auth.currentUser) return;
            try {
                const res = await fetch('/api/history');
                if (!res.ok) return;
                const data = await res.json();
                if (!data.success || !Array.isArray(data.history)) return;
                const localHistory = getHistory();
                const merged = mergeHistoryLists(localHistory, data.history);
                localStorage.setItem('sa_history', JSON.stringify(merged));
            } catch (error) {
                console.warn('Cloud history alınamadı:', error);
            }
        }

        async function syncPendingLocalHistoryToCloud() {
            if (!auth || !auth.currentUser) return;
            const history = getHistory();
            const cloudIds = new Set(
                history
                    .map(item => item.id)
                    .filter(id => typeof id === 'string' && !/^\d+$/.test(id))
            );

            for (const item of history) {
                const isLocalTempRecord = typeof item.id === 'string' && /^\d+$/.test(item.id);
                if (!isLocalTempRecord) continue;
                if (cloudIds.has(item.id)) continue;
                try {
                    const res = await fetch('/api/history', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            symptoms: item.symptoms || '',
                            result: item.result || null
                        })
                    });
                    const data = await res.json();
                    if (res.ok && data.success && data.id) {
                        item.id = data.id;
                        cloudIds.add(data.id);
                    }
                } catch (error) {
                    console.warn('Local kayıt clouda taşınamadı:', error);
                }
            }
            localStorage.setItem('sa_history', JSON.stringify(history.slice(0, 20)));
        }

        function saveToHistory(symptoms, result) {
            const history = getHistory();
            
            const newRecord = {
                id: Date.now().toString(),
                date: new Date().toLocaleString('tr-TR'),
                symptoms: symptoms.substring(0, 100) + (symptoms.length > 100 ? '...' : ''),
                result: result
            };

            history.unshift(newRecord);
            if (history.length > 20) history.pop();
            localStorage.setItem('sa_history', JSON.stringify(history));

            // Sync with cloud if logged in
            if (auth && auth.currentUser) {
                fetch('/api/history', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ symptoms, result })
                }).then(res => res.json()).then(data => {
                    if (data.success) {
                        // Replace temp ID with Firestore document ID
                        const idx = history.findIndex(h => h.id === newRecord.id);
                        if(idx !== -1) {
                            history[idx].id = data.id;
                            localStorage.setItem('sa_history', JSON.stringify(history));
                        }
                    }
                }).catch(console.error);
            }
        }

        function openHistoryModal() {
            const modal = document.getElementById('historyModal');
            const list = document.getElementById('historyList');
            const history = getHistory();
            
            list.innerHTML = '';
            
            if (history.length === 0) {
                list.innerHTML = '<div class="history-empty">Henüz kaydedilmiş bir analiz yok.</div>';
            } else {
                history.forEach((item, index) => {
                    const itemEl = document.createElement('div');
                    itemEl.className = 'history-item';
                    itemEl.addEventListener('click', () => loadHistoryItem(index));

                    const dateRow = document.createElement('div');
                    dateRow.className = 'history-date';

                    const dateText = document.createElement('span');
                    dateText.textContent = String(item.date || '');

                    const deleteBtn = document.createElement('button');
                    deleteBtn.className = 'history-delete';
                    deleteBtn.textContent = 'Sil';
                    deleteBtn.addEventListener('click', (event) => deleteHistoryItem(event, index));

                    dateRow.appendChild(dateText);
                    dateRow.appendChild(deleteBtn);

                    const symptomsEl = document.createElement('div');
                    symptomsEl.className = 'history-symptoms';
                    symptomsEl.textContent = String(item.symptoms || '');

                    itemEl.appendChild(dateRow);
                    itemEl.appendChild(symptomsEl);
                    list.appendChild(itemEl);
                });
            }
            
            modal.classList.add('show');
        }

        function closeHistoryModal() {
            document.getElementById('historyModal').classList.remove('show');
        }

        function deleteHistoryItem(e, index) {
            e.stopPropagation();
            const history = getHistory();
            const item = history[index];
            history.splice(index, 1);
            localStorage.setItem('sa_history', JSON.stringify(history));
            openHistoryModal(); // refresh UI

            // Delete from cloud if logged in
            if (
                auth &&
                auth.currentUser &&
                item &&
                typeof item.id === 'string' &&
                !/^\d+$/.test(item.id)
            ) {
                fetch(`/api/history/${item.id}`, { method: 'DELETE' }).catch(console.error);
            }
        }

        function loadHistoryItem(index) {
            const history = getHistory();
            const item = history[index];
            if (item && item.result) {
                document.getElementById('symptomInput').value = item.symptoms !== 'Görüntü Analizi' ? item.symptoms : '';
                displayResults(item.result);
                closeHistoryModal();
            }
        }

        // Keyboard shortcut
        document.addEventListener('keydown', (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                analyze();
            }
            if (e.key === 'Escape') {
                closeHistoryModal();
            }
        });

        // ===== MEDICATION TIMER =====
        const DAY_NAMES = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
        let timerInterval = null;

        function getReminders() {
            const r = localStorage.getItem('sa_reminders');
            return r ? JSON.parse(r) : [];
        }

        function saveReminders(reminders) {
            localStorage.setItem('sa_reminders', JSON.stringify(reminders));
        }

        function toggleDay(el) {
            el.classList.toggle('active');
        }

        function addTimeSlot() {
            const container = document.getElementById('timerTimeSlots');
            const count = container.children.length;
            if (count >= 6) {
                showToast('Maksimum 6 saat ekleyebilirsiniz', 'error');
                return;
            }
            const defaultTimes = ['08:00', '12:00', '18:00', '22:00', '10:00', '15:00'];
            const div = document.createElement('div');
            div.className = 'time-slot';
            div.innerHTML = `
                <input type="time" value="${defaultTimes[count] || '12:00'}">
                <button class="time-slot-remove" onclick="removeTimeSlot(this)">✕</button>
            `;
            container.appendChild(div);
        }

        function removeTimeSlot(btn) {
            const container = document.getElementById('timerTimeSlots');
            if (container.children.length <= 1) {
                showToast('En az 1 saat olmalı', 'error');
                return;
            }
            btn.parentElement.remove();
        }

        function addReminder() {
            const name = document.getElementById('timerMedName').value.trim();
            const dose = document.getElementById('timerMedDose').value.trim();
            const note = document.getElementById('timerMedNote').value.trim();

            if (!name) {
                showToast('Lütfen ilaç adı girin', 'error');
                return;
            }

            // Gather times
            const timeSlots = document.querySelectorAll('#timerTimeSlots .time-slot input[type="time"]');
            const times = [];
            timeSlots.forEach(input => {
                if (input.value) times.push(input.value);
            });
            if (times.length === 0) {
                showToast('En az bir saat seçin', 'error');
                return;
            }

            // Gather days
            const dayChips = document.querySelectorAll('#timerDays .day-chip.active');
            const days = [];
            dayChips.forEach(chip => days.push(parseInt(chip.dataset.day)));
            if (days.length === 0) {
                showToast('En az bir gün seçin', 'error');
                return;
            }

            const reminder = {
                id: Date.now(),
                name,
                dose: dose || '1 doz',
                times: times.sort(),
                days,
                note,
                active: true,
                createdAt: new Date().toISOString()
            };

            const reminders = getReminders();
            reminders.unshift(reminder);
            saveReminders(reminders);

            // Reset form
            document.getElementById('timerMedName').value = '';
            document.getElementById('timerMedDose').value = '';
            document.getElementById('timerMedNote').value = '';

            renderReminders();
            requestNotificationPermission();
            showToast(`"${name}" hatırlatıcısı oluşturuldu!`, 'success');
        }

        function deleteReminder(id) {
            let reminders = getReminders();
            reminders = reminders.filter(r => r.id !== id);
            saveReminders(reminders);
            renderReminders();
            showToast('Hatırlatıcı silindi', 'info');
        }

        function toggleReminder(id) {
            const reminders = getReminders();
            const r = reminders.find(r => r.id === id);
            if (r) r.active = !r.active;
            saveReminders(reminders);
            renderReminders();
        }

        function getNextAlarmTime(reminder) {
            if (!reminder.active) return null;
            const now = new Date();
            // JavaScript: 0=Sunday, adjust for Turkish (0=Monday)
            const jsDay = now.getDay(); // 0=Sun
            const trDay = jsDay === 0 ? 6 : jsDay - 1; // 0=Mon

            // Check today's remaining times
            if (reminder.days.includes(trDay)) {
                const nowMinutes = now.getHours() * 60 + now.getMinutes();
                for (const t of reminder.times) {
                    const [h, m] = t.split(':').map(Number);
                    const timeMinutes = h * 60 + m;
                    if (timeMinutes > nowMinutes) {
                        const next = new Date(now);
                        next.setHours(h, m, 0, 0);
                        return next;
                    }
                }
            }

            // Check next days
            for (let offset = 1; offset <= 7; offset++) {
                const futureDay = (trDay + offset) % 7;
                if (reminder.days.includes(futureDay)) {
                    const firstTime = reminder.times[0];
                    const [h, m] = firstTime.split(':').map(Number);
                    const next = new Date(now);
                    next.setDate(now.getDate() + offset);
                    next.setHours(h, m, 0, 0);
                    return next;
                }
            }
            return null;
        }

        function formatCountdown(ms) {
            if (ms <= 0) return 'Şimdi!';
            const totalSecs = Math.floor(ms / 1000);
            const hours = Math.floor(totalSecs / 3600);
            const mins = Math.floor((totalSecs % 3600) / 60);
            const secs = totalSecs % 60;
            if (hours > 0) return `${hours}sa ${mins}dk sonra`;
            if (mins > 0) return `${mins}dk ${secs}sn sonra`;
            return `${secs}sn sonra`;
        }

        function renderReminders() {
            const reminders = getReminders();
            const list = document.getElementById('reminderList');

            // Update stats
            const total = reminders.length;
            const active = reminders.filter(r => r.active).length;
            document.getElementById('timerStatTotal').textContent = total;
            document.getElementById('timerStatActive').textContent = active;

            if (reminders.length === 0) {
                list.innerHTML = '';
                const empty = document.createElement('div');
                empty.className = 'reminder-empty';
                const icon = document.createElement('div');
                icon.className = 'reminder-empty-icon';
                icon.textContent = '⏰';
                const text = document.createElement('p');
                text.textContent = 'Henüz hatırlatıcı eklenmedi';
                const sub = document.createElement('small');
                sub.textContent = 'Yukarıdan yeni bir ilaç hatırlatıcısı ekleyin';
                empty.appendChild(icon);
                empty.appendChild(text);
                empty.appendChild(sub);
                list.appendChild(empty);
                document.getElementById('timerStatNext').textContent = '--:--';
                return;
            }

            // Find global next alarm
            let globalNext = null;
            reminders.forEach(r => {
                const next = getNextAlarmTime(r);
                if (next && (!globalNext || next < globalNext)) {
                    globalNext = next;
                }
            });
            document.getElementById('timerStatNext').textContent = globalNext
                ? globalNext.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
                : '--:--';

            list.innerHTML = reminders.map(r => {
                const nextAlarm = getNextAlarmTime(r);
                const countdown = nextAlarm ? formatCountdown(nextAlarm - new Date()) : '';
                const nextTimeStr = nextAlarm ? nextAlarm.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '';
                const safeName = escapeHtml(r.name || '');
                const safeDose = escapeHtml(r.dose || '');
                const safeNote = escapeHtml(r.note || '');

                return `
                    <div class="reminder-card" style="${!r.active ? 'opacity: 0.5;' : ''}">
                        <div class="reminder-icon">${r.active ? '💊' : '💤'}</div>
                        <div class="reminder-info">
                            <div class="reminder-med-name">${safeName}</div>
                            <div class="reminder-dose">${safeDose}${r.note ? ' · ' + safeNote : ''}</div>
                            <div class="reminder-times">
                                ${r.times.map(t => `
                                    <span class="reminder-time-badge ${nextTimeStr === t || (nextAlarm && r.times.length === 1) ? 'next' : ''}">
                                        ${escapeHtml(t)}
                                    </span>
                                `).join('')}
                            </div>
                            <div class="reminder-days-list">
                                ${DAY_NAMES.map((d, i) => `
                                    <span class="reminder-day-mini ${r.days.includes(i) ? 'active' : ''}">${d[0]}</span>
                                `).join('')}
                            </div>
                            ${r.active && countdown ? `<div class="reminder-countdown">⏱ ${countdown}</div>` : ''}
                        </div>
                        <div class="reminder-actions">
                            <button class="reminder-toggle ${r.active ? 'on' : ''}" onclick="toggleReminder(${r.id})" title="${r.active ? 'Kapat' : 'Aç'}"></button>
                            <button class="reminder-delete-btn" onclick="deleteReminder(${r.id})">Sil</button>
                        </div>
                    </div>
                `;
            }).join('');
        }

        // ===== NOTIFICATIONS =====
        function requestNotificationPermission() {
            if ('Notification' in window && Notification.permission === 'default') {
                Notification.requestPermission();
            }
        }

        function showTimerNotification(reminder, time) {
            // In-app notification
            const notif = document.createElement('div');
            notif.className = 'timer-notification';
            const safeName = escapeHtml(reminder.name || '');
            const safeDose = escapeHtml(reminder.dose || '');
            const safeTime = escapeHtml(time || '');
            const safeNote = escapeHtml(reminder.note || '');
            notif.innerHTML = `
                <button class="timer-notification-close" onclick="this.parentElement.remove()">✕</button>
                <div class="timer-notification-header">
                    <span>💊</span>
                    <strong>İlaç Zamanı!</strong>
                </div>
                <p><strong>${safeName}</strong> — ${safeDose}</p>
                <p style="font-size: 0.8rem; color: var(--text-muted); margin-top: 4px;">${safeTime}${reminder.note ? ' · ' + safeNote : ''}</p>
            `;
            document.body.appendChild(notif);
            setTimeout(() => {
                if (notif.parentElement) notif.remove();
            }, 15000);

            // Browser notification
            if ('Notification' in window && Notification.permission === 'granted') {
                new Notification('💊 İlaç Zamanı!', {
                    body: `${reminder.name} — ${reminder.dose}\n${reminder.note || ''}`,
                    icon: '💊',
                    requireInteraction: true
                });
            }

            // Play sound if possible
            try {
                const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                const oscillator = audioCtx.createOscillator();
                const gainNode = audioCtx.createGain();
                oscillator.connect(gainNode);
                gainNode.connect(audioCtx.destination);
                oscillator.frequency.value = 800;
                oscillator.type = 'sine';
                gainNode.gain.value = 0.3;
                oscillator.start();
                setTimeout(() => { oscillator.frequency.value = 1000; }, 200);
                setTimeout(() => { oscillator.frequency.value = 800; }, 400);
                setTimeout(() => { oscillator.stop(); audioCtx.close(); }, 600);
            } catch (e) { /* no audio support */ }
        }

        // Check reminders every second
        let lastCheckedMinute = '';
        function checkReminders() {
            const now = new Date();
            const currentTime = now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
            const jsDay = now.getDay();
            const trDay = jsDay === 0 ? 6 : jsDay - 1;

            // Only check once per minute
            if (currentTime === lastCheckedMinute) return;
            lastCheckedMinute = currentTime;

            const reminders = getReminders();
            reminders.forEach(r => {
                if (!r.active) return;
                if (!r.days.includes(trDay)) return;
                // Convert times to HH:MM format for comparison
                r.times.forEach(t => {
                    // Pad if needed
                    const parts = t.split(':');
                    const timeFormatted = parts[0].padStart(2, '0') + ':' + parts[1].padStart(2, '0');
                    if (timeFormatted === currentTime) {
                        showTimerNotification(r, t);
                    }
                });
            });

            // Update countdowns on screen
            renderReminders();
        }

        // Start timer system
        function initTimerSystem() {
            renderReminders();
            if (timerInterval) clearInterval(timerInterval);
            timerInterval = setInterval(checkReminders, 1000);
            // Update countdowns every 15 seconds
            setInterval(() => {
                const tab = document.getElementById('tab-timer');
                if (tab && tab.classList.contains('active')) {
                    renderReminders();
                }
            }, 15000);
        }
        initTimerSystem();

