        // FIREBASE CONFIG (FROM USER)
        const firebaseConfig = {
            apiKey: "AIzaSyD9V2SRxCkcaI6__VnBb-zEeOny8z76pU8",
            authDomain: "saglik-ai-332dc.firebaseapp.com",
            projectId: "saglik-ai-332dc",
            storageBucket: "saglik-ai-332dc.firebasestorage.app",
            messagingSenderId: "982590249826",
            appId: "1:982590249826:web:2a2c6fcfc1883f706cea3b",
            measurementId: "G-M9P0W6D4HC"
        };

        // Initialize Firebase
        firebase.initializeApp(firebaseConfig);
        const auth = firebase.auth();
        const APP_CHECK_SITE_KEY = '6Ld0d8YsAAAAAJSTEWBk9bNfKo48Mjb6tTbt2w-4';
        let appCheck = null;

        if (APP_CHECK_SITE_KEY && APP_CHECK_SITE_KEY !== 'RECAPTCHA_SITE_KEY_BURAYA') {
            try {
                appCheck = firebase.appCheck();
                appCheck.activate(APP_CHECK_SITE_KEY, true);
            } catch (error) {
                console.warn('App Check başlatılamadı:', error);
            }
        } else {
            console.warn('App Check site key henüz tanımlanmadı.');
        }

        // Auth State Listener
        auth.onAuthStateChanged(async user => {
            const authUI = document.getElementById('auth-ui');
            if (user) {
                const name = user.displayName || user.email.split('@')[0];
                const initials = name.substring(0, 2).toUpperCase();
                authUI.innerHTML = '';
                const profile = document.createElement('div');
                profile.className = 'user-profile';
                const avatar = document.createElement('div');
                avatar.className = 'user-avatar';
                avatar.textContent = initials;
                const userName = document.createElement('span');
                userName.className = 'user-name';
                userName.textContent = name;
                const logoutBtn = document.createElement('button');
                logoutBtn.className = 'auth-btn';
                logoutBtn.textContent = 'Çıkış';
                logoutBtn.addEventListener('click', handleLogout);
                profile.appendChild(avatar);
                profile.appendChild(userName);
                profile.appendChild(logoutBtn);
                authUI.appendChild(profile);
                // Show notification to user
                if (!localStorage.getItem('sa_welcome_shown')) {
                    showToast(`Hoş geldin, ${name}! Profilin aktif.`, 'success');
                    localStorage.setItem('sa_welcome_shown', 'true');
                }
                await syncHistoryFromCloud();
                await syncPendingLocalHistoryToCloud();
                await syncHistoryFromCloud();
            } else {
                authUI.innerHTML = '';
                const loginLink = document.createElement('a');
                loginLink.href = '/login.html';
                loginLink.className = 'login-link';
                loginLink.textContent = '🔐 Giriş Yap / Kayıt Ol';
                authUI.appendChild(loginLink);
                localStorage.removeItem('sa_welcome_shown');
            }
        });

        async function handleLogout() {
            try {
                await auth.signOut();
                showToast('Hadi eyvallah, çıkış yapıldı.', 'info');
                setTimeout(() => window.location.reload(), 1000);
            } catch (error) {
                showToast('Çıkış yapılamadı!', 'error');
            }
        }

        // Add Auth Token to API requests
        async function getAuthHeader() {
            const user = auth.currentUser;
            if (user) {
                const token = await user.getIdToken();
                return { 'Authorization': `Bearer ${token}` };
            }
            return {};
        }

        async function getAppCheckHeader() {
            if (!appCheck) return {};
            try {
                const tokenResult = await appCheck.getToken();
                const token = tokenResult && tokenResult.token ? tokenResult.token : null;
                return token ? { 'X-Firebase-AppCheck': token } : {};
            } catch (error) {
                console.warn('App Check token alınamadı:', error);
                return {};
            }
        }

        // Modified analyze function to include auth
        const originalAnalyze = analyze;
        window.analyze = async function() {
            // Show a small indicator if guest
            if (!auth.currentUser) {
                console.log("Guest mode active - history saved locally only.");
            }
            return originalAnalyze();
        };

        // Modified fetch calls
        const originalFetch = window.fetch;
        window.fetch = async (...args) => {
            const [resource, config] = args;
            if (typeof resource === 'string' && resource.startsWith('/api/')) {
                const authHeader = await getAuthHeader();
                const appCheckHeader = await getAppCheckHeader();
                const newConfig = {
                    ...config,
                    headers: {
                        ...(config ? config.headers : {}),
                        ...authHeader,
                        ...appCheckHeader
                    }
                };
                return originalFetch(resource, newConfig);
            }
            return originalFetch(...args);
        };

        // ===== SETTINGS & THEME LOGIC =====
        function openSettingsModal() {
            document.getElementById('settingsModal').classList.add('active');
            // Show/hide auth buttons based on user state
            const isAuth = !!auth.currentUser;
            document.getElementById('logoutSettingsBtn').style.display = isAuth ? 'block' : 'none';
            document.getElementById('deleteAccountBtn').style.display = isAuth ? 'block' : 'none';
        }
        function closeSettingsModal() {
            document.getElementById('settingsModal').classList.remove('active');
        }
        
        function selectTheme(themeName, element) {
            document.querySelectorAll('.theme-option').forEach(el => el.classList.remove('selected'));
            element.classList.add('selected');
            document.documentElement.setAttribute('data-theme', themeName);
            
            // Apply CSS variables based on theme
            const root = document.documentElement;
            if(themeName === 'pink') {
                root.style.setProperty('--assistant-bg', 'rgba(244, 114, 182, 0.1)');
                root.style.setProperty('--assistant-border', '#f472b6');
                root.style.setProperty('--user-bg', 'rgba(251, 113, 133, 0.1)');
                root.style.setProperty('--user-border', '#fb7185');
            } else if(themeName === 'red') {
                root.style.setProperty('--assistant-bg', 'rgba(239, 68, 68, 0.1)');
                root.style.setProperty('--assistant-border', '#ef4444');
                root.style.setProperty('--user-bg', 'rgba(248, 113, 113, 0.1)');
                root.style.setProperty('--user-border', '#f87171');
            } else if(themeName === 'blue') {
                root.style.setProperty('--assistant-bg', 'rgba(59, 130, 246, 0.1)');
                root.style.setProperty('--assistant-border', '#3b82f6');
                root.style.setProperty('--user-bg', 'rgba(96, 165, 250, 0.1)');
                root.style.setProperty('--user-border', '#60a5fa');
            } else if(themeName === 'green') {
                root.style.setProperty('--assistant-bg', 'rgba(16, 185, 129, 0.1)');
                root.style.setProperty('--assistant-border', '#10b981');
                root.style.setProperty('--user-bg', 'rgba(52, 211, 153, 0.1)');
                root.style.setProperty('--user-border', '#34d399');
            } else if(themeName === 'orange') {
                root.style.setProperty('--assistant-bg', 'rgba(249, 115, 22, 0.1)');
                root.style.setProperty('--assistant-border', '#f97316');
                root.style.setProperty('--user-bg', 'rgba(251, 146, 60, 0.1)');
                root.style.setProperty('--user-border', '#fb923c');
            } else {
                root.style.setProperty('--assistant-bg', 'rgba(167, 139, 250, 0.1)');
                root.style.setProperty('--assistant-border', 'var(--purple)');
                root.style.setProperty('--user-bg', 'rgba(45, 212, 191, 0.1)');
                root.style.setProperty('--user-border', 'var(--teal)');
            }
        }

        function saveSettings() {
            const nameInput = document.getElementById('assistantName').value.trim() || 'SağlıkAI Asistanı';
            localStorage.setItem('sa_assistantName', nameInput);
            
            const selectedThemeEl = document.querySelector('.theme-option.selected');
            const themeClass = Array.from(selectedThemeEl.classList).find(c => c.startsWith('theme-'));
            const themeName = themeClass ? themeClass.replace('theme-', '') : 'default';
            localStorage.setItem('sa_theme', themeName);
            
            closeSettingsModal();
            showToast('Ayarlar kaydedildi!', 'success');
        }

        function loadSettings() {
            const savedName = localStorage.getItem('sa_assistantName');
            if(savedName) {
                document.getElementById('assistantName').value = savedName;
            }
            
            const savedTheme = localStorage.getItem('sa_theme') || 'default';
            const themeEl = document.querySelector(`.theme-${savedTheme}`);
            if(themeEl) {
                selectTheme(savedTheme, themeEl);
            }
        }
        
        async function deleteAccount() {
            if(!confirm('Hesabınızı ve tüm sağlık geçmişinizi kalıcı olarak silmek istediğinize emin misiniz? Bu işlem geri alınamaz!')) return;
            
            const user = auth.currentUser;
            if(!user) return;
            
            try {
                // Delete user documents from history endpoint
                await fetch('/api/history/all', { method: 'DELETE', headers: await getAuthHeader() });
                
                // Delete firebase auth user
                await user.delete();
                
                showToast('Hesabınız başarıyla silindi.', 'success');
                setTimeout(() => window.location.reload(), 1500);
            } catch (error) {
                if (error.code === 'auth/requires-recent-login') {
                    showToast('Güvenlik için lütfen yeniden giriş yapıp tekrar deneyin.', 'error');
                    auth.signOut();
                    setTimeout(() => window.location.href = '/login.html', 2000);
                } else {
                    showToast('Hesap silinirken hata: ' + error.message, 'error');
                }
            }
        }

        // Initialize settings on load
        window.addEventListener('DOMContentLoaded', loadSettings);

        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('/sw.js?v=14').catch((error) => {
                    console.warn('Service worker kaydı başarısız:', error);
                });
            });
        }
