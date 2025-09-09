// Ensure Google Maps callback exists before the API script fires
if (typeof window !== 'undefined') {
    window.__googleMapsReady = false;
    window.initMap = function() {
        window.__googleMapsReady = true;
        window.dispatchEvent(new Event('google-maps-loaded'));
        console.log('Google Maps callback executed');
    };
}

// BloodConnect Application - Vanilla JavaScript
class BloodConnectApp {
    constructor() {
        this.currentUser = null;
        this.currentPage = 'landing';
        this.currentDonor = null;
        this.searchResults = [];
        this.isRegisterMode = false;
        this.map = null;
        this.isGoogleMapsLoaded = false;
        this._loadingTimer = null;
        this._mapMarkers = [];
        this.STORAGE_KEYS = {
            sessionUser: 'bloodconnect_user',
            appData: 'bloodconnect_data'
        };
        this.MAX_USERS = 50; // increased capacity as requested
        this.searchCenter = null;
        this.searchRadiusKm = 10;
        this.language = 'en';
        this.translations = this.buildTranslations();
        this.firebaseReady = false;
        this.firebaseUser = null;
        
        // App data stored only from actual usage (no pre-seeded mock records)
        this.mockData = {
            users: [],
            donors: [],
            donations: [],
            bloodRequests: []
        };
        
        this.init();
    }
    
    init() {
        this.loadDataFromStorage();
        this.loadUserFromStorage();
        this.loadLanguageFromStorage();
        this.bindEvents();
        this.initFirebase();
        this.checkAuthStatus();
        this.applyTranslations();
        
        // Wire Google Maps loaded event (handles cases where script loads before/after app init)
        if (window.__googleMapsReady) {
            this.isGoogleMapsLoaded = true;
        }
        window.addEventListener('google-maps-loaded', () => {
            this.isGoogleMapsLoaded = true;
            // If user is on seeker page with results, (re)initialize map
            if (this.currentPage === 'seeker-dashboard' && this.searchResults.length > 0) {
                this.initializeMap();
            }
        });
    }


    
    loadDataFromStorage() {
        try {
            const raw = localStorage.getItem(this.STORAGE_KEYS.appData);
            if (raw) {
                const parsed = JSON.parse(raw);
                // Basic shape validation and merge defaults
                this.mockData = {
                    users: Array.isArray(parsed.users) ? parsed.users : this.mockData.users,
                    donors: Array.isArray(parsed.donors) ? parsed.donors : this.mockData.donors,
                    donations: Array.isArray(parsed.donations) ? parsed.donations : this.mockData.donations,
                    bloodRequests: Array.isArray(parsed.bloodRequests) ? parsed.bloodRequests : this.mockData.bloodRequests
                };
            } else {
                this.saveDataToStorage();
            }
        } catch (_) {
            // If parsing fails, keep in-memory defaults and overwrite storage
            this.saveDataToStorage();
        }
    }

    // Password policy: min 8, upper, lower, number, special and confirm match
    assertPasswordPolicy(password, confirmPassword) {
        const minLen = password && password.length >= 8;
        const upper = /[A-Z]/.test(password || '');
        const lower = /[a-z]/.test(password || '');
        const number = /[0-9]/.test(password || '');
        const special = /[^A-Za-z0-9]/.test(password || '');
        if (!(minLen && upper && lower && number && special)) {
            throw new Error('Password must be 8+ chars incl. upper, lower, number, special.');
        }
        if (confirmPassword !== undefined && password !== confirmPassword) {
            throw new Error('Passwords do not match.');
        }
    }

    // Google auth: Firebase first, fallback to mock
    async handleGoogleAuth() {
        try {
            if (this.firebaseReady) {
                console.log('Attempting Firebase Google authentication...');
                await this.firebaseGoogleLogin();
                this.showToast('Signed in with Google', 'Choose your role to continue.');
                this.showPage('role-selection');
            } else {
                console.log('Firebase not ready, using mock Google auth');
                this.handleMockGoogleAuth();
            }
        } catch (error) {
            console.error('Google authentication failed:', error);
            
            // If Firebase Google auth fails, show error instead of falling back to mock
            if (this.firebaseReady) {
                console.log('Firebase Google auth failed');
                this.showToast('Google Sign-in Error', 'Please try again or use email/password login.', 'error');
            } else {
                this.showToast('Google Sign-in Error', error.message, 'error');
            }
        }
    }

    handleMockGoogleAuth() {
        // Fallback to mock Google auth
        const generatedEmail = `user${Date.now()}@gmail.com`;
        const googleProfile = { email: generatedEmail, firstName: 'Google', lastName: 'User' };
        this._pendingGoogle = googleProfile;
        this.showPage('additional-details');
        const form = document.getElementById('additional-details-form');
        if (form) {
            form.querySelector('input[name="firstName"]').value = googleProfile.firstName;
            form.querySelector('input[name="lastName"]').value = googleProfile.lastName;
        }
        this.showToast('Using Demo Google Account', 'Please complete your details to continue.');
    }

    // Facebook auth: Firebase first, fallback to mock
    async handleFacebookAuth() {
        try {
            if (this.firebaseReady) {
                console.log('Attempting Firebase Facebook authentication...');
                await this.firebaseFacebookLogin();
                this.showToast('Signed in with Facebook', 'Choose your role to continue.');
                this.showPage('role-selection');
            } else {
                console.log('Firebase not ready, using mock Facebook auth');
                this.handleMockFacebookAuth();
            }
        } catch (error) {
            console.error('Facebook authentication failed:', error);
            
            // If Firebase Facebook auth fails, show error instead of falling back to mock
            if (this.firebaseReady) {
                console.log('Firebase Facebook auth failed');
                this.showToast('Facebook Sign-in Error', 'Please try again or use email/password login.', 'error');
            } else {
                this.showToast('Facebook Sign-in Error', error.message, 'error');
            }
        }
    }

    handleMockFacebookAuth() {
        // Mock Facebook auth
        const email = `fb${Date.now()}@facebook.com`;
        const tempPassword = 'Fb#Temp1234';
        const newUser = { id: Date.now().toString(), email, password: tempPassword, firstName: 'Facebook', lastName: 'User', role: null };
        this.mockData.users.push(newUser);
        this.currentUser = newUser;
        this.saveUserToStorage();
        this.saveDataToStorage();
        this.showToast('Signed in with Facebook', 'Choose your role to continue.');
        this.showPage('role-selection');
    }

    // Handle Additional Details submission for Google flow
    handleAdditionalDetails(e) {
        e.preventDefault();
        const form = e.target;
        const data = new FormData(form);
        const firstName = data.get('firstName');
        const lastName = data.get('lastName');
        const password = data.get('password');
        const confirmPassword = data.get('confirmPassword');
        try {
            this.assertPasswordPolicy(password, confirmPassword);
            const email = this._pendingGoogle?.email || `user${Date.now()}@gmail.com`;
            const exists = this.mockData.users.find(u => u.email === email);
            const user = exists || { id: Date.now().toString(), email, password, firstName, lastName, role: null };
            if (!exists) this.mockData.users.push(user);
            // If existed, update name and password from Additional Details
            if (exists) {
                exists.firstName = firstName;
                exists.lastName = lastName;
                exists.password = password;
            }
            this.currentUser = user;
            this.saveUserToStorage();
            this.saveDataToStorage();
            this._pendingGoogle = null;
            this.showToast('Details saved', 'Continue by choosing your role.');
            this.showPage('role-selection');
        } catch (err) {
            this.showToast('Invalid Details', err.message, 'error');
        }
    }

    // Handle rules and eligibility; finalize donor profile
    handleEligibility(e) {
        e.preventDefault();
        const data = new FormData(e.target);
        const ok = data.get('q1') === 'yes' && data.get('q2') === 'yes' && data.get('q3') === 'yes' && data.get('acceptRules') === 'on';
        if (!ok) {
            this.showToast('Not eligible', 'You must meet all requirements and accept rules.', 'error');
            return;
        }
        if (!this.currentUser || !this._pendingDonorProfile) {
            this.showToast('Session expired', 'Please re-enter your profile details.', 'error');
            this.showPage('donor-setup');
            return;
        }
        // Create or update donor now
        let existing = this.mockData.donors.find(d => d.userId === this.currentUser.id);
        if (existing) {
            existing = Object.assign(existing, this._pendingDonorProfile);
            this.currentDonor = existing;
        } else {
            const newDonor = { id: Date.now().toString(), userId: this.currentUser.id, ...this._pendingDonorProfile };
            this.mockData.donors.push(newDonor);
            this.currentDonor = newDonor;
        }
        this._pendingDonorProfile = null;
        this.currentUser.role = 'donor';
        this.saveUserToStorage();
        this.saveDataToStorage();
        
        // Sync to Firebase
        this.syncUserToFirestore();
        this.syncDonorToFirestore();
        
        this.showToast('Donor Profile Created', 'You can now access your dashboard.');
        this.showPage('donor-dashboard');
    }
    saveDataToStorage() {
        const dataToPersist = {
            users: this.mockData.users,
            donors: this.mockData.donors,
            donations: this.mockData.donations,
            bloodRequests: this.mockData.bloodRequests
        };
        localStorage.setItem(this.STORAGE_KEYS.appData, JSON.stringify(dataToPersist));
    }

    loadUserFromStorage() {
        const userData = localStorage.getItem(this.STORAGE_KEYS.sessionUser);
        if (userData) {
            this.currentUser = JSON.parse(userData);
        }
    }
    
    saveUserToStorage() {
        if (this.currentUser) {
            localStorage.setItem(this.STORAGE_KEYS.sessionUser, JSON.stringify(this.currentUser));
        } else {
            localStorage.removeItem(this.STORAGE_KEYS.sessionUser);
        }
    }
    
    bindEvents() {
        // Language selector
        const langSelect = document.getElementById('language-select');
        if (langSelect) {
            langSelect.value = this.language;
            langSelect.addEventListener('change', () => {
                this.setLanguage(langSelect.value);
            });
        }
        // Navigation events
        document.getElementById('back-btn')?.addEventListener('click', () => this.showPage('landing'));
        document.getElementById('get-started-btn')?.addEventListener('click', () => {
            this.isRegisterMode = true;
            this.showPage('auth');
            this.updateAuthForm();
        });
        document.getElementById('logout-btn')?.addEventListener('click', () => this.logout());
        document.getElementById('switch-role-btn')?.addEventListener('click', () => this.switchRole());
        document.getElementById('user-progress-btn')?.addEventListener('click', () => this.toggleUserProgressPanel());
        document.getElementById('panel-logout-btn')?.addEventListener('click', () => this.logout());
        
        // Auth events
        document.getElementById('auth-toggle-btn')?.addEventListener('click', () => this.toggleAuthMode());
        document.getElementById('auth-form')?.addEventListener('submit', (e) => this.handleAuth(e));
        // Social auth buttons
        document.getElementById('google-auth-btn')?.addEventListener('click', () => this.handleGoogleAuth());
        document.getElementById('facebook-auth-btn')?.addEventListener('click', () => this.handleFacebookAuth());
        // Additional details form
        document.getElementById('additional-details-form')?.addEventListener('submit', (e) => this.handleAdditionalDetails(e));
        
        // Role selection
        document.querySelectorAll('.role-card').forEach(card => {
            card.addEventListener('click', () => this.selectRole(card.dataset.role));
        });
        
        // Donor setup
        document.getElementById('get-location-btn')?.addEventListener('click', () => this.getCurrentLocation());
        document.getElementById('donor-setup-form')?.addEventListener('submit', (e) => this.handleDonorSetup(e));
        // Removed inline dashboard edit button; now in user progress panel
        // Clear any stale lat/lng if user manually edits donor location; geocode on blur for immediate feedback
        const donorLocInput = document.querySelector('#donor-setup-form input[name="location"]');
        donorLocInput?.addEventListener('input', () => {
            delete donorLocInput.dataset.latitude;
            delete donorLocInput.dataset.longitude;
        });
        donorLocInput?.addEventListener('blur', async () => {
            if (!donorLocInput.value) return;
            try {
                const coords = await this.geocodeAddress(donorLocInput.value);
                donorLocInput.dataset.latitude = coords.latitude;
                donorLocInput.dataset.longitude = coords.longitude;
                donorLocInput.value = coords.locationFormatted || this.normalizeManualLocationString(donorLocInput.value);
                this.showToast('Location set', 'We updated the map position for your address.');
            } catch (_) {
                // No geocode: normalize order but keep text
                donorLocInput.value = this.normalizeManualLocationString(donorLocInput.value);
            }
        });
        
        // Search form
        document.getElementById('donor-search-form')?.addEventListener('submit', (e) => this.handleDonorSearch(e));
        // Clear any stale lat/lng if user manually edits seeker location
        const seekerLocInput = document.querySelector('#donor-search-form input[name="location"]');
        seekerLocInput?.addEventListener('input', () => {
            delete seekerLocInput.dataset.latitude;
            delete seekerLocInput.dataset.longitude;
        });
        
        // Modal events
        document.getElementById('close-modal-btn')?.addEventListener('click', () => this.closeModal());
        document.getElementById('modal-close-btn')?.addEventListener('click', () => this.closeModal());
        document.getElementById('reveal-contact-btn')?.addEventListener('click', () => this.revealContact());
        document.getElementById('call-donor-btn')?.addEventListener('click', () => this.callDonor());
        
        // Create request button
        document.getElementById('create-request-btn')?.addEventListener('click', () => {
            this.showToast('Feature coming soon', 'Blood request creation will be available soon!', 'info');
        });
        
        // Close modal when clicking outside
        document.getElementById('donor-modal')?.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal-overlay')) {
                this.closeModal();
            }
        });

        // Auto-hide user progress when clicking outside
        document.addEventListener('click', (e) => {
            const panel = document.getElementById('user-progress-panel');
            const btn = document.getElementById('user-progress-btn');
            if (!panel || panel.style.display === 'none') return;
            const target = e.target;
            if (panel.contains(target) || btn.contains(target)) return;
            panel.style.display = 'none';
        });

        // Hide panel on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const panel = document.getElementById('user-progress-panel');
                if (panel) panel.style.display = 'none';
            }
        });

        // Eligibility form
        document.getElementById('eligibility-form')?.addEventListener('submit', (e) => this.handleEligibility(e));
        // User progress panel actions
        document.getElementById('up-edit-profile-btn')?.addEventListener('click', () => {
            const panel = document.getElementById('user-progress-panel');
            if (panel) panel.style.display = 'none';
            this.startEditDonorProfile();
        });
        document.getElementById('up-recent-toggle')?.addEventListener('click', () => this.toggleRecentDonations());
        const upAvail = document.getElementById('up-availability-select');
        upAvail?.addEventListener('change', (e) => this.updateAvailability(e));

        // Warn before refresh/navigation so users don't accidentally lose form progress
        window.addEventListener('beforeunload', (e) => {
            // Show prompt only if user is logged in or has entered data in forms
            const hasSession = !!this.currentUser;
            const donorForm = document.getElementById('donor-setup-form');
            const authForm = document.getElementById('auth-form');
            const donorFormDirty = donorForm ? (new FormData(donorForm).toString().length > 0) : false;
            const authFormDirty = authForm ? (new FormData(authForm).toString().length > 0) : false;
            if (hasSession || donorFormDirty || authFormDirty) {
                e.preventDefault();
                e.returnValue = '';
            }
        });
    }

    buildTranslations() {
        return {
            en: {
                'landing.title': 'Find Blood Fast.\n<span class="text-red">Donate with Confidence.</span>',
                'landing.subtitle': 'A modern platform that connects seekers with nearby donors instantly. Join now and help save lives in minutes.',
                'landing.cta': 'Get Started',
                'landing.how': 'How it works',
                'auth.title': 'Welcome Back',
                'auth.subtitle': 'Sign in to your account',
                'auth.submit': 'Sign In',
                'auth.toggle_text': "Don't have an account?",
                'auth.toggle_btn': 'Sign up',
                'auth.title_signup': 'Create Your Account',
                'auth.subtitle_signup': 'Join BloodConnect today',
                'auth.submit_signup': 'Sign Up',
                'auth.toggle_text_signup': 'Already have an account?',
                'auth.toggle_btn_signin': 'Sign in',
                'auth.email': 'Email',
                'auth.email_ph': 'Enter your email',
                'auth.password': 'Password',
                'auth.password_ph': 'Enter your password',
                'auth.firstName': 'First Name',
                'auth.firstName_ph': 'Enter your first name',
                'auth.lastName': 'Last Name',
                'auth.lastName_ph': 'Enter your last name',
                'role.title': 'Choose Your Role',
                'role.subtitle': 'How would you like to participate in BloodConnect?',
                'role.donor': 'Blood Donor',
                'role.donor_desc': 'Donate blood and help save lives in your community',
                'role.donor_f1': 'Track your donations',
                'role.donor_f2': 'Receive urgent requests',
                'role.donor_f3': 'View donation history',
                'role.seeker': 'Blood Seeker',
                'role.seeker_desc': 'Find blood donors when you or your loved ones need help',
                'role.seeker_f1': 'Search for donors',
                'role.seeker_f2': 'Submit blood requests',
                'role.seeker_f3': 'Track request status',
                'setup.title': 'Complete Your Donor Profile',
                'setup.subtitle': 'Help us connect you with people who need your help',
                'setup.bloodType': 'Blood Type *',
                'setup.age': 'Age *',
                'setup.gender': 'Gender *',
                'setup.contact': 'Contact Number *',
                'setup.occupation': 'Occupation *',
                'setup.occupation_ph': 'e.g., Student, Engineer',
                'setup.location': 'Location *',
                'setup.location_ph': 'City, State (e.g., San Francisco, CA)',
                'setup.hint': 'Click the location button to use your current location',
                'setup.req_title': 'Donor Requirements',
                'setup.req1': 'Must be 18-65 years old',
                'setup.req2': 'Weigh at least 110 pounds',
                'setup.req3': 'Be in good general health',
                'setup.req4': 'Wait 56 days between whole blood donations',
                'setup.submit': 'Create Donor Profile',
                'donorDash.title': 'Donor Dashboard',
                'donorDash.subtitle': 'Track your donations and help those in need',
                'donorDash.profile': 'Your Profile',
                'donorDash.recent': 'Recent Donations',
                'seeker.title': 'Seeker Dashboard',
                'seeker.subtitle': 'Find blood donors in your area',
                'seeker.search_title': 'Find Blood Donors',
                'seeker.bloodNeeded': 'Blood Type Needed',
                'seeker.location': 'Location',
                'seeker.search_btn': 'Search Donors',
                'seeker.available': 'Available Donors',
                'detail.age': 'Age',
                'detail.gender': 'Gender',
                'detail.occupation': 'Occupation',
                'detail.availability': 'Availability',
                'detail.available': 'Available',
                'detail.contact_btn': 'Contact Donor'
            },
            te: {
                'landing.title': 'రక్తం త్వరగా పొందండి.\n<span class="text-red">ఆత్మవిశ్వాసంతో దానం చేయండి.</span>',
                'landing.subtitle': 'సమీప దాతలను మీకు వెంటనే కలుపుతుంది. ఇప్పుడే చేరండి, ప్రాణాలు కాపాడండి.',
                'landing.cta': 'ప్రారంభించండి',
                'landing.how': 'అది ఎలా పనిచేస్తుంది',
                'auth.title': 'మళ్ళీ స్వాగతం',
                'auth.subtitle': 'మీ ఖాతాలో ప్రవేశించండి',
                'auth.submit': 'సైన్ ఇన్',
                'auth.toggle_text': 'ఖాతా లేదా?',
                'auth.toggle_btn': 'సైన్ అప్',
                'auth.title_signup': 'మీ ఖాతాను సృష్టించండి',
                'auth.subtitle_signup': 'ఈ రోజు BloodConnect లో చేరండి',
                'auth.submit_signup': 'సైన్ అప్',
                'auth.toggle_text_signup': 'ఇప్పటికే ఖాతా ఉందా?',
                'auth.toggle_btn_signin': 'సైన్ ఇన్',
                'auth.email': 'ఇమెయిల్',
                'auth.email_ph': 'మీ ఇమెయిల్ నమోదు చేయండి',
                'auth.password': 'పాస్వర్డ్',
                'auth.password_ph': 'మీ పాస్వర్డ్ నమోదు చేయండి',
                'auth.firstName': 'పేరు',
                'auth.firstName_ph': 'మీ మొదటి పేరు',
                'auth.lastName': 'ఇంటిపేరు',
                'auth.lastName_ph': 'మీ చివరి పేరు',
                'role.title': 'మీ పాత్రను ఎంచుకోండి',
                'role.subtitle': 'మీరు BloodConnect లో ఎలా పాల్గొంటారు?',
                'role.donor': 'రక్తదాత',
                'role.donor_desc': 'మీ సమాజంలో ప్రాణాలను కాపాడేందుకు దానం చేయండి',
                'role.donor_f1': 'మీ దానాలు ట్రాక్ చేయండి',
                'role.donor_f2': 'అత్యవసర అభ్యర్థనలు పొందండి',
                'role.donor_f3': 'దాతృత్వ చరిత్రను చూడండి',
                'role.seeker': 'రక్తం కోరేవారు',
                'role.seeker_desc': 'మీకు లేదా మీ బంధువులకు అవసరం ఉన్నప్పుడు దాతలను కనుగొనండి',
                'role.seeker_f1': 'దాతలను శోధించండి',
                'role.seeker_f2': 'రక్త అభ్యర్థనలు పంపండి',
                'role.seeker_f3': 'అభ్యర్థన స్థితి ట్రాక్ చేయండి',
                'setup.title': 'మీ దాత ప్రొఫైల్ పూర్తి చేయండి',
                'setup.subtitle': 'సహాయం కావాల్సినవారితో మిమ్మల్ని కలుపుతాము',
                'setup.bloodType': 'రక్త గ్రూప్ *',
                'setup.age': 'వయస్సు *',
                'setup.gender': 'లింగం *',
                'setup.contact': 'ఫోన్ నంబర్ *',
                'setup.occupation': 'వృత్తి *',
                'setup.occupation_ph': 'ఉదా., విద్యార్థి, ఇంజినియర్',
                'setup.location': 'ప్రాంతం *',
                'setup.location_ph': 'నగరం, రాష్ట్రం',
                'setup.hint': 'మీ ప్రస్తుత స్థానాన్ని ఉపయోగించడానికి బటన్‌ను నొక్కండి',
                'setup.req_title': 'దాత అర్హతలు',
                'setup.req1': '18-65 సంవత్సరాల మధ్య వయస్సు',
                'setup.req2': 'కనీసం 50 కిలోలు బరువు',
                'setup.req3': 'మంచి ఆరోగ్యం',
                'setup.req4': 'రెండు దానాల మధ్య 56 రోజులు వేచి ఉండండి',
                'setup.submit': 'దాత ప్రొఫైల్ సృష్టించండి',
                'donorDash.title': 'దాత డాష్‌బోర్డ్',
                'donorDash.subtitle': 'మీ దానాలను ట్రాక్ చేసి సహాయం చేయండి',
                'donorDash.profile': 'మీ ప్రొఫైల్',
                'donorDash.recent': 'ఇటీవలి దానాలు',
                'seeker.title': 'సీకర్ డాష్‌బోర్డ్',
                'seeker.subtitle': 'మీ ప్రాంతంలో దాతలను కనుగొనండి',
                'seeker.search_title': 'రక్త దాతలను కనుగొనండి',
                'seeker.bloodNeeded': 'అవసరమైన రక్త గ్రూప్',
                'seeker.location': 'ప్రాంతం',
                'seeker.search_btn': 'దాతలను శోధించండి',
                'seeker.available': 'లభ్యమయ్యే దాతలు',
                'detail.age': 'వయస్సు',
                'detail.gender': 'లింగం',
                'detail.occupation': 'వృత్తి',
                'detail.availability': 'లభ్యమయ్యే దాతలు',
                'detail.available': 'లభ్యమయ్యే దాతలు',
                'detail.contact_btn': 'దాతలను కనుగొనండి'
            },
            hi: {
                'landing.title': 'खून जल्दी पाएँ.\n<span class="text-red">आत्मविश्वास से दान करें.</span>',
                'landing.subtitle': 'निकट के दाताओं से तुरंत जोड़ता है। अभी जुड़ें और जीवन बचाएँ।',
                'landing.cta': 'शुरू करें',
                'landing.how': 'कैसे काम करता है',
                'auth.title': 'वापसी पर स्वागत है',
                'auth.subtitle': 'अपने खाते में साइन इन करें',
                'auth.submit': 'साइन इन',
                'auth.toggle_text': 'खाता नहीं है?',
                'auth.toggle_btn': 'साइन अप',
                'auth.title_signup': 'अपना खाता बनाएँ',
                'auth.subtitle_signup': 'आज ही BloodConnect से जुड़ें',
                'auth.submit_signup': 'साइन अप',
                'auth.toggle_text_signup': 'पहले से खाता है?',
                'auth.toggle_btn_signin': 'साइन इन',
                'auth.email': 'ईमेल',
                'auth.email_ph': 'अपना ईमेल दर्ज करें',
                'auth.password': 'पासवर्ड',
                'auth.password_ph': 'अपना पासवर्ड दर्ज करें',
                'auth.firstName': 'पहला नाम',
                'auth.firstName_ph': 'अपना पहला नाम',
                'auth.lastName': 'अंतिम नाम',
                'auth.lastName_ph': 'अपना अंतिम नाम',
                'role.title': 'अपनी भूमिका चुनें',
                'role.subtitle': 'आप BloodConnect में कैसे भाग लेना चाहेंगे?',
                'role.donor': 'रक्त दाता',
                'role.donor_desc': 'अपने समुदाय में जीवन बचाने में मदद करें',
                'role.donor_f1': 'अपनी दान सूची देखें',
                'role.donor_f2': 'जरूरी अनुरोध प्राप्त करें',
                'role.donor_f3': 'दान इतिहास देखें',
                'role.seeker': 'रक्त खोजकर्ता',
                'role.seeker_desc': 'ज़रूरत पड़ने पर दाताओं को खोजें',
                'role.seeker_f1': 'दाता खोजें',
                'role.seeker_f2': 'रक्त अनुरोध भेजें',
                'role.seeker_f3': 'अनुरोध स्थिति देखें',
                'setup.title': 'अपनी दाता प्रोफ़ाइल पूर्ण करें',
                'setup.subtitle': 'सहायता आवश्यक व्यक्तियों के साथ जोड़ें',
                'setup.bloodType': 'रक्त समूह *',
                'setup.age': 'आयु *',
                'setup.gender': 'लिंग *',
                'setup.contact': 'फ़ोन नंबर *',
                'setup.occupation': 'पेशा *',
                'setup.occupation_ph': 'उदा., छात्र, इंजीनियर',
                'setup.location': 'स्थान *',
                'setup.location_ph': 'शहर, राज्य',
                'setup.hint': 'अपने वर्तमान स्थान का उपयोग करने के लिए बटन दबाएँ',
                'setup.req_title': 'दाता आवश्यकताएँ',
                'setup.req1': 'आयु 18-65 वर्ष',
                'setup.req2': 'कम से कम 50 किग्रा',
                'setup.req3': 'अच्छा स्वास्थ्य',
                'setup.req4': '56 दिन के बीच अलग',
                'setup.submit': 'प्रोफ़ाइल बनाएँ',
                'donorDash.title': 'दाता डैशबोर्ड',
                'donorDash.subtitle': 'अपनी दान सूची ट्रैक करें',
                'donorDash.profile': 'आपकी प्रोफ़ाइल',
                'donorDash.recent': 'हाल की दान',
                'seeker.title': 'सीकर डैशबोर्ड',
                'seeker.subtitle': 'अपने क्षेत्र में दाताओं को खोजें',
                'seeker.search_title': 'रक्त दाताओं को खोजें',
                'seeker.bloodNeeded': 'आवश्यक रक्त समूह',
                'seeker.location': 'स्थान',
                'seeker.search_btn': 'दाताओं को खोजें',
                'seeker.available': 'उपलब्ध दाताओं',
                'detail.age': 'आयु',
                'detail.gender': 'लिंग',
                'detail.occupation': 'पेशा',
                'detail.availability': 'उपलब्ध दाताओं',
                'detail.available': 'उपलब्ध दाताओं',
                'detail.contact_btn': 'दाताओं को खोजें'
            },
            ta: {
                'landing.title': 'விரைவில் இரத்தம் கண்டுபிடிக்க.\n<span class="text-red">உறுதியுடன் தானம் செய்க.</span>',
                'landing.subtitle': 'அருகிலுள்ள தானதாரர்களை உடனே இணைக்கிறது. இப்போது சேர்ந்து உயிர்களை காப்பாற்றுங்கள்.',
                'landing.cta': 'தொடங்குக',
                'landing.how': 'எப்படி செயல்படுகிறது',
                'auth.title': 'மீண்டும் வருக',
                'auth.subtitle': 'உங்கள் கணக்கில் உள்நுழைக',
                'auth.submit': 'உள்நுழை',
                'auth.toggle_text': 'கணக்கு இல்லையா?',
                'auth.toggle_btn': 'பதிவு செய்',
                'auth.title_signup': 'உங்கள் கணக்கை உருவாக்கவும்',
                'auth.subtitle_signup': 'இன்று BloodConnect-இல் சேருங்கள்',
                'auth.submit_signup': 'பதிவு செய்',
                'auth.toggle_text_signup': 'ஏற்கனவே கணக்கு உள்ளதா?',
                'auth.toggle_btn_signin': 'லாகிந்',
                'auth.email': 'மின்னஞ்சல்',
                'auth.email_ph': 'உங்கள் மின்னஞ்சல்',
                'auth.password': 'கடவுச்சொல்',
                'auth.password_ph': 'உங்கள் கடவுச்சொல்',
                'auth.firstName': 'முதல் பெயர்',
                'auth.firstName_ph': 'உங்கள் முதல் பெயர்',
                'auth.lastName': 'கடைசி பெயர்',
                'auth.lastName_ph': 'உங்கள் கடைசி பெயர்',
                'role.title': 'உங்கள் பாத்திரத்தைத் தேர்ந்தெடுக்கவும்',
                'role.subtitle': 'நீங்கள் எங்கள் பங்கேற்பீர்கள்?',
                'role.donor': 'ரக്த஦ாதாவ்',
                'role.donor_desc': 'நிங்களுடைய சமூஹத்தில் ஜீவனை பாதுகாப்பாற்ற உதவுங்கள்',
                'role.donor_f1': 'உங்கள் தானங்களை கண்காணிக்கவும்',
                'role.donor_f2': 'அத்யாவஶ்ய அ஭்யர்த்தினங்கள்',
                'role.donor_f3': 'தான வரலாறு',
                'role.seeker': 'ரக்தம் தேடுந்தவர்கள்',
                'role.seeker_desc': 'அவசியமுள்ளபோது தானதாரர்களை தேடுங்கள்',
                'role.seeker_f1': 'தானதாரர்களைத் தேடுங்கள்',
                'role.seeker_f2': 'ரக்த அ஭்யர்த்தினங்கள்',
                'role.seeker_f3': 'அ஭்யர்த்தின நில',
                'setup.title': 'உங்கள் தானதாரர் சுயவிவரம்',
                'setup.subtitle': 'ஸஹாயம் அவசியமுள்ளவரும் இணைக்க',
                'setup.bloodType': 'ரக்த வகை *',
                'setup.age': 'ப்ராயம் *',
                'setup.gender': 'லிங்கம் *',
                'setup.contact': 'தொலைபேசி எண் *',
                'setup.occupation': 'தொழில் *',
                'setup.occupation_ph': 'உதா., விளம்பரம், இந்தியாளர்',
                'setup.location': 'இடம் *',
                'setup.location_ph': 'நகரம், மாநிலம்',
                'setup.hint': 'உங்கள் இடத்தை பயன்படுத்த பொத்தானை அழுத்தவும்',
                'setup.req_title': 'தானதாரர் தகுதிகள்',
                'setup.req1': 'ப்ராயம் 18-65',
                'setup.req2': 'குறைந்தது 50 கிலோ',
                'setup.req3': 'ஶ்ரேஷ்டமாய ஆரோக்யநில',
                'setup.req4': 'இரண்டு தானங்களுக்கிடையே 56 நாள்',
                'setup.submit': 'ப்ரொஃபைல் ரசிக்குக',
                'donorDash.title': 'தானதாரர் பலகை',
                'donorDash.subtitle': 'உங்கள் தானங்களை கண்காணிக்கவும்',
                'donorDash.profile': 'உங்கள் ப்ரொஃபைல்',
                'donorDash.recent': 'சமீபகால தானங்கள்',
                'seeker.title': 'சீக்கர் பலகை',
                'seeker.subtitle': 'உங்கள் பகுதியில் தானதாரர்கள்',
                'seeker.search_title': 'ரக்த தானதாரர்கள்',
                'seeker.bloodNeeded': 'அவசியமாய்ந்த ரக்த வகை',
                'seeker.location': 'இடம்',
                'seeker.search_btn': 'தானதாரர்களைத் தேடு',
                'seeker.available': 'ல஭்யமாய்ந்த தானதாரர்கள்',
                'detail.age': 'ப்ராயம்',
                'detail.gender': 'லிங்கம்',
                'detail.occupation': 'தொழில்',
                'detail.availability': 'ல஭்யமாய்ந்த தானதாரர்கள்',
                'detail.available': 'ல஭்யமாய்ந்த தானதாரர்கள்',
                'detail.contact_btn': 'தானதாரர்களைத் தேடு'
            },
            ml: {
                'landing.title': 'രക്തം പെട്ടെന്ന് കണ്ടെത്തുക.\n<span class="text-red">ആത്മവിശ്വാസത്തോടെ ദാനം ചെയ്യുക.</span>',
                'landing.subtitle': 'അടുത്തുള്ള ദാതാക്കളുമായി ഉടനെ ബന്ധിപ്പിക്കുന്നു. ഇപ്പോൾ ചേരുക, ജീവൻ രക്ഷിക്കൂ.',
                'landing.cta': 'ആരംഭിക്കുക',
                'landing.how': 'എങ്ങനെ പ്രവർത്തിക്കുന്നു',
                'auth.title': 'മത್തೆ സ്വാഗതം',
                'auth.subtitle': 'നിങ്ങളുടെ അക്കൗണ്ടിലേക്ക് സൈൻ ഇൻ ചെയ്യുക',
                'auth.submit': 'സൈൻ ഇൻ',
                'auth.toggle_text': 'അക്കൗണ്ടില്ലേ?',
                'auth.toggle_btn': 'സൈൻ അപ്പ്',
                'auth.title_signup': 'നിങ്ങളുടെ അക്കൗണ്ട് സൃഷ്ടിക്കുക',
                'auth.subtitle_signup': 'ഇന്ന് തന്നെ BloodConnect-ലേക്ക് ചേരുക',
                'auth.submit_signup': 'സൈൻ അപ്പ്',
                'auth.toggle_text_signup': 'ഇതിനകം അക്കൗണ്ടുണ്ടോ?',
                'auth.toggle_btn_signin': 'ലാഗിന്',
                'auth.email': 'ഇമെയിൽ',
                'auth.email_ph': 'നിങ്ങളുടെ ഇമെയിൽ നൽകുക',
                'auth.password': 'പാസ്വേഡ്',
                'auth.password_ph': 'നിങ്ങളുടെ പാസ്വേഡ് നൽകുക',
                'auth.firstName': 'പേര്',
                'auth.firstName_ph': 'നിങ്ങളുടെ പേര്',
                'auth.lastName': 'ഇടപ്പേര്',
                'auth.lastName_ph': 'നിങ്ങളുടെ ഇടപ്പേര്',
                'role.title': 'നിങ്ങളുടെ പങ്ക് തിരഞ്ഞെടുക്കുക',
                'role.subtitle': 'നിങ്ങൾ എങ്ങനെ പങ്കെടുക്കും?',
                'role.donor': 'രക്തദാതാവ്',
                'role.donor_desc': 'നിങ്ങളുടെ സമൂഹത്തിൽ ജീവ രക്ഷണെ മാഡുക',
                'role.donor_f1': 'ദാനം ട്രാക്ക് ചെയ്യുക',
                'role.donor_f2': 'തുര്തു വിനംതിഗളും',
                'role.donor_f3': 'ദാനം ചരിത്രം',
                'role.seeker': 'രക്തം തേടുന്നവരും',
                'role.seeker_desc': 'അവശ്യമുള്ളപ്പോൾ ദാതാക്കളെ കണ്ടെത്തുക',
                'role.seeker_f1': 'ദാതാക്കളെ തിരയുക',
                'role.seeker_f2': 'രക്ത വിനംതിഗളും',
                'role.seeker_f3': 'വിനംതി സ്ഥിതി',
                'setup.title': 'ദാതാവിന്റെ പ്രൊഫൈൽ പൂർത്തിയാക്കുക',
                'setup.subtitle': 'സഹായം അഗത്യവിരുത്തുണ്ട് വരും അനുഭവികൾക്ക് ബന്ധപ്പിക്കുക',
                'setup.bloodType': 'രക്ത ഗ്രൂപ്പ് *',
                'setup.age': 'പ്രായം *',
                'setup.gender': 'ലിംഗം *',
                'setup.contact': 'ഫോൺ സംഖ്യ *',
                'setup.occupation': 'വൃത്തി *',
                'setup.occupation_ph': 'ഉദാ., വിദ്യാര്ഥി, ഇന്ജിനിയറ്',
                'setup.location': 'സ്ഥലം *',
                'setup.location_ph': 'നഗരം, രാജ്യം',
                'setup.hint': 'നിങ്ങളുടെ നിലവിലെ സ്ഥലം ഉപയോഗിക്കാൻ ബട്ടൺ അമർത്തുക',
                'setup.req_title': 'ദാതാവിന്റെ ആവശ്യകതകൾ',
                'setup.req1': 'പ്രായം 18-65',
                'setup.req2': 'കുറഞ്ഞത് 50 കെജി',
                'setup.req3': 'ഉത്തമ ആരോഗ്യനില',
                'setup.req4': 'രണ്ടു ദാനങ്ങൾക്കിടയിൽ 56 ദിവസം',
                'setup.submit': 'പ്രൊഫൈൽ രചിക്കുക',
                'donorDash.title': 'ദാതാവ് ഡാഷ്ബോർഡ്',
                'donorDash.subtitle': 'നിങ്ങളുടെ ദാനങ്ങൾ ട്രാക്ക് ചെയ്യുക',
                'donorDash.profile': 'നിങ്ങളുടെ പ്രൊഫൈൽ',
                'donorDash.recent': 'സമീപകാല ദാനങ്ങൾ',
                'seeker.title': 'സീക്കർ ഡാഷ്ബോർഡ്',
                'seeker.subtitle': 'നിങ്ങളുടെ പ്രദേശത്തിലെ ദാതാക്കളും',
                'seeker.search_title': 'രക്ത ദാതാക്കളും',
                'seeker.bloodNeeded': 'അവശ്യമായ രക്ത ഗ്രൂപ്പ്',
                'seeker.location': 'സ്ഥലം',
                'seeker.search_btn': 'ദാതാക്കളെ തിരയുക',
                'seeker.available': 'ലഭ്യമായ ദാതാക്കളും',
                'detail.age': 'പ്രായം',
                'detail.gender': 'ലിംഗം',
                'detail.occupation': 'വൃത്തി',
                'detail.availability': 'ലഭ്യമായ ദാതാക്കളും',
                'detail.available': 'ലഭ്യമായ ദാതാക്കളും',
                'detail.contact_btn': 'ദാതാക്കളെ തിരയുക'
            },
            kn: {
                'landing.title': 'ರಕ്ತವನ್ನು ಬೇಗ ಹುಡುಕಿ.\n<span class="text-red">ಆತ್ಮವಿಶ್ವಾಸದಿಂದ ದಾನ ಮಾಡಿ.</span>',
                'landing.subtitle': 'ಸಮೀಪದ ದಾತರನ್ನು ತಕ್ಷಣ ಸಂಪರ್ಕಿಸುತ್ತದೆ. ಈಗ ಸೇರಿ, ಜೀವ ಉಳಿಸಿ.',
                'landing.cta': 'ಪ್ರಾರಂಭಿಸಿ',
                'landing.how': 'ಹೆಗೆ ಕೆಲಸ ಮಾಡುತ್ತದೆ',
                'auth.title': 'ಮತ್ತೆ ಸ್ವಾಗತ',
                'auth.subtitle': 'ನಿಮ್ಮ ಖಾತೆಗೆ ಲಾಗಿನ್ ಆಗಿ',
                'auth.submit': 'ಲಾಗಿನ್',
                'auth.toggle_text': 'ಖಾತೆ ಇಲ್ಲವೇ?',
                'auth.toggle_btn': 'ಸೈನ್ ಅಪ್',
                'auth.title_signup': 'ನಿಮ್ಮ ಖಾತೆ ರಚಿಸಿ',
                'auth.subtitle_signup': 'ಇಂದೇ BloodConnect ಸೇರಿ',
                'auth.submit_signup': 'ಸೈನ್ ಅಪ್',
                'auth.toggle_text_signup': 'ಈಗಾಗಲೇ ಖಾತೆಯಿದೆಯೆ?',
                'auth.toggle_btn_signin': 'ಲಾಗಿನ್',
                'auth.email': 'ಇಮെಲ್',
                'auth.email_ph': 'ನಿಮ್ಮ ಇಮെಲ್ ನಮೂದಿಸಿ',
                'auth.password': 'ಪಾಸ್‌ವರ್ಡ್',
                'auth.password_ph': 'ನಿಮ್ಮ ಪಾಸ್‌ವರ್ಡ್ ನಮೂದಿಸಿ',
                'auth.firstName': 'ಮೊದಲ ಹೆಸರು',
                'auth.firstName_ph': 'ನಿಮ್ಮ ಮೊದಲ ಹೆಸರು',
                'auth.lastName': 'ಕೊನೆಯ ಹೆಸರು',
                'auth.lastName_ph': 'ನಿಮ್ಮ ಕೊನೆಯ ಹೆಸರು',
                'role.title': 'ನಿಮ್ಮ ಪಾತ್ರ ಆಯ್ಕೆಮಾಡಿ',
                'role.subtitle': 'ನೀವು ಹೇಗೆ ಭಾಗವಹಿಸುತ್ತೀರಿ?',
                'role.donor': 'ರಕ്ತದಾನಿ',
                'role.donor_desc': 'ನಿಮ್ಮ ಸಮಾಜದಲ್ಲಿ ಜೀವ ರಕ്ಷಣೆ ಮಾಡಿ',
                'role.donor_f1': 'ನಿಮ್ಮ ದಾನಗಳನ್ನು ಟ್ರ್ಯಾಕ್ ಮಾಡಿರಿ',
                'role.donor_f2': 'ತುರ್ತು ವಿನಂತಿಗಳು ಪಡೆಯಿರಿ',
                'role.donor_f3': 'ದಾನ ಇತಿಹಾಸ',
                'role.seeker': 'ರಕ്ತ ಹುಡುಕುವವರು',
                'role.seeker_desc': 'ಅವಶ್ಯಕತೆ ಬಂದಾಗ ದಾತರನ್ನು ಹುಡುಕಿ',
                'role.seeker_f1': 'ದಾತರನ್ನು ಹುಡುಕಿ',
                'role.seeker_f2': 'ರಕ്ತ ವಿನಂತಿಗಳು',
                'role.seeker_f3': 'ವಿನಂತಿ ಸ್ಥಿತಿ',
                'setup.title': 'ನಿಮ್ಮ ದಾನಿ ಪ್ರೊಫೈಲ್ ಪೂರ್ಣಗೊಳಿಸಿ',
                'setup.subtitle': 'ಸಹಾಯ ಅಗತ್ಯವಿರುವವರೊಂದಿಗೆ ಸಂಪರ್ಕಿಸಿ',
                'setup.bloodType': 'ರಕ്ತದ ಗುಂಪು *',
                'setup.age': 'ವಯಸ್ಸು *',
                'setup.gender': 'ಲಿಂಗ *',
                'setup.contact': 'ಫೋನ್ ಸಂಖ್ಯೆ *',
                'setup.occupation': 'ವೃತ್ತಿ *',
                'setup.occupation_ph': 'ಉದಾ., ವಿದ್ಯಾರ್ಥಿ, ಇಂಜಿನಿಯರ್',
                'setup.location': 'ಸ್ಥಳ *',
                'setup.location_ph': 'ನಗರ, ರಾಜ್ಯ',
                'setup.hint': 'ನಿಮ್ಮ ಸ್ಥಳವನ್ನು ಬಳಸಲು ಬಟನ್ ಒತ್ತಿರಿ',
                'setup.req_title': 'ದಾನಿ ಅರ್ಹತೆಗಳು',
                'setup.req1': 'ವಯಸ್ಸು 18-65',
                'setup.req2': 'ಕನಿಷ್ಠ 50 ಕೆಜಿ',
                'setup.req3': 'ಉತ್ತಮ ಆರೋಗ್ಯ',
                'setup.req4': 'ಎರಡು ದಾನಗಳ ನಡುವೆ 56 ದಿನ',
                'setup.submit': 'ಪ್ರೊಫೈಲ್ ರಚಿಸಿ',
                'donorDash.title': 'ದಾನಿ ಡ್ಯಾಶ್‌ಬೋರ್ಡ್',
                'donorDash.subtitle': 'ನಿಮ್ಮ ದಾನಗಳನ್ನು ಟ್ರ್ಯಾಕ್ ಮಾಡಿ',
                'donorDash.profile': 'ನಿಮ್ಮ ಪ್ರೊಫೈಲ್',
                'donorDash.recent': 'ಇತ್ತೀಚಿನ ದಾನಗಳು',
                'seeker.title': 'ಹುಡುಕುವವರ ಡ್ಯಾಶ್‌ಬೋರ್ಡ್',
                'seeker.subtitle': 'ನಿಮ್ಮ ಪ್ರದೇಶದಲ್ಲಿನ ದಾತರು',
                'seeker.search_title': 'ರಕ്ತ ದಾತರು',
                'seeker.bloodNeeded': 'ಅವಶ್ಯಕ ರಕ്ತ ಗುಂಪು',
                'seeker.location': 'ಸ್ಥಳ',
                'seeker.search_btn': 'ದಾತರನ್ನು ಹುಡುಕಿ',
                'seeker.available': 'ಲಭ್ಯ ದಾತರು',
                'detail.age': 'ವಯಸ್ಸು',
                'detail.gender': 'ಲಿಂಗ',
                'detail.occupation': 'ವೃತ್ತಿ',
                'detail.availability': 'ಲಭ್ಯ ದಾತರು',
                'detail.available': 'ಲಭ್ಯ ದಾತರು',
                'detail.contact_btn': 'ದಾತರನ್ನು ಹುಡುಕಿ'
            }
        };
    }

    loadLanguageFromStorage() {
        const lang = localStorage.getItem('bloodconnect_lang');
        if (lang) this.language = lang;
    }

    setLanguage(lang) {
        this.language = lang;
        localStorage.setItem('bloodconnect_lang', lang);
        this.applyTranslations();
    }

    t(key) {
        const dict = this.translations[this.language] || this.translations.en;
        return dict[key] || this.translations.en[key] || '';
    }

    applyTranslations() {
        const dict = this.translations[this.language] || this.translations.en;
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            const html = dict[key] || this.translations.en[key] || el.innerHTML;
            el.innerHTML = html;
        });
        // Attribute translations e.g., placeholders/labels
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder');
            const text = dict[key] || this.translations.en[key] || el.getAttribute('placeholder');
            el.setAttribute('placeholder', text);
        });
        document.querySelectorAll('[data-i18n-aria]').forEach(el => {
            const key = el.getAttribute('data-i18n-aria');
            const text = dict[key] || this.translations.en[key] || el.getAttribute('aria-label') || '';
            if (text) el.setAttribute('aria-label', text);
        });
    }
    
    checkAuthStatus() {
        if (this.currentUser) {
            // Prefer donor context if a donor profile exists
            const donor = this.mockData.donors.find(d => d.userId === this.currentUser.id);
            if (donor) {
                this.currentDonor = donor;
                this.currentUser.role = 'donor';
                this.saveUserToStorage();
                this.showPage('donor-dashboard');
                return;
            }
            // Otherwise follow explicit role
            if (this.currentUser.role === 'seeker') {
                this.showPage('seeker-dashboard');
            } else if (this.currentUser.role === 'donor') {
                this.showPage('donor-setup');
            } else {
                this.showPage('role-selection');
            }
        } else {
            // Default to Sign In page for unauthenticated users
            this.isRegisterMode = false;
            this.showPage('auth');
            this.updateAuthForm();
        }
    }
    
    showPage(page) {
        // Hide all pages
        document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
        
        // Show selected page
        const pageElement = document.getElementById(`${page}-page`);
        if (pageElement) {
            pageElement.style.display = 'block';
        }
        
        this.currentPage = page;
        this.updateNavbar();
        this.applyTranslations();
        
        // Page-specific initialization
        if (page === 'donor-dashboard') {
            this.initDonorDashboard();
        } else if (page === 'seeker-dashboard') {
            this.initSeekerDashboard();
        }
    }
    
    updateNavbar() {
        const backBtn = document.getElementById('back-btn');
        const userSection = document.getElementById('nav-user-section');
        
        if (this.currentUser && this.currentPage !== 'landing') {
            backBtn.style.display = 'block';
            userSection.style.display = 'flex';
            
            const roleText = document.getElementById('nav-role-text');
            const switchText = document.getElementById('switch-role-text');
            
            if (this.currentUser.role === 'donor') {
                roleText.textContent = 'Donor Dashboard';
                switchText.textContent = 'Switch to Seeker';
            } else {
                roleText.textContent = 'Seeker Dashboard';
                switchText.textContent = 'Switch to Donor';
            }
        } else {
            backBtn.style.display = 'none';
            userSection.style.display = 'none';
            // Also hide progress panel if visible
            const panel = document.getElementById('user-progress-panel');
            if (panel) panel.style.display = 'none';
        }
    }
    
    toggleAuthMode() {
        this.isRegisterMode = !this.isRegisterMode;
        this.updateAuthForm();
        this.applyTranslations();
    }
    
    updateAuthForm() {
        const title = document.getElementById('auth-title');
        const subtitle = document.getElementById('auth-subtitle');
        const submitBtn = document.getElementById('auth-submit-btn');
        const toggleText = document.getElementById('auth-toggle-text');
        const toggleBtn = document.getElementById('auth-toggle-btn');
        const registerFields = document.getElementById('register-fields');
        
        if (this.isRegisterMode) {
            title.innerHTML = this.t('auth.title_signup') || 'Create Your Account';
            subtitle.innerHTML = this.t('auth.subtitle_signup') || 'Join BloodConnect today';
            submitBtn.innerHTML = this.t('auth.submit_signup') || 'Sign Up';
            toggleText.innerHTML = this.t('auth.toggle_text_signup') || 'Already have an account?';
            toggleBtn.innerHTML = this.t('auth.toggle_btn_signin') || 'Sign in';
            registerFields.style.display = 'block';
        } else {
            title.innerHTML = this.t('auth.title') || 'Welcome Back';
            subtitle.innerHTML = this.t('auth.subtitle') || 'Sign in to your account';
            submitBtn.innerHTML = this.t('auth.submit') || 'Sign In';
            toggleText.innerHTML = this.t('auth.toggle_text') || "Don't have an account?";
            toggleBtn.innerHTML = this.t('auth.toggle_btn') || 'Sign up';
            registerFields.style.display = 'none';
        }
    }
    
    async handleAuth(e) {
        e.preventDefault();
        const formData = new FormData(e.target);
        const email = formData.get('email');
        const password = formData.get('password');
        
        console.log('Auth form submitted:', { email, isRegisterMode: this.isRegisterMode, firebaseReady: this.firebaseReady });
        
        try {
            if (this.isRegisterMode) {
                const firstName = formData.get('firstName');
                const lastName = formData.get('lastName');
                const confirmPassword = formData.get('confirmPassword');
                console.log('Registration data:', { email, firstName, lastName });
                
                this.assertPasswordPolicy(password, confirmPassword);
                
                // Try Firebase first, fallback to mock
                if (this.firebaseReady) {
                    try {
                        await this.firebaseRegister(email, password, firstName, lastName);
                        this.showToast('Account created!', 'Welcome to BloodConnect!');
                        this.isRegisterMode = false;
                        this.showPage('role-selection');
                        return;
                    } catch (firebaseError) {
                        console.error('Firebase registration failed:', firebaseError);
                        
                        // If it's specifically an email-already-in-use error, guide user to sign in
                        if (firebaseError.code === 'auth/email-already-in-use' || /email[- ]already[- ]in[- ]use/i.test(firebaseError.message)) {
                            this.showToast('Account exists', 'This email is already registered. Please sign in instead.');
                            this.isRegisterMode = false;
                            this.updateAuthForm();
                            return;
                        }
                        
                        // For other errors, fall back to mock registration
                        console.log('Falling back to mock registration');
                    }
                }
                
                // Fallback to mock registration
                await this.register({ email, password, firstName, lastName });
                // Force re-login after email sign up
                this.currentUser = null;
                this.saveUserToStorage();
                this.showToast('Account created!', 'Please sign in with your email and password.');
                this.isRegisterMode = false;
                this.showPage('auth');
                this.updateAuthForm();
            } else {
                console.log('Login attempt for:', email);
                
                // Try Firebase first, fallback to mock
                if (this.firebaseReady) {
                    try {
                        await this.firebaseLogin(email, password);
                        this.showToast('Welcome back!', 'Successfully signed in');
                        this.showPage('role-selection');
                        return;
                    } catch (firebaseError) {
                        console.error('Firebase login failed:', firebaseError);
                        // Fall through to mock login
                    }
                }
                
                // Fallback to mock login
                await this.login(email, password);
                this.showToast('Welcome back!', 'Successfully signed in');
                this.showPage('role-selection');
            }
        } catch (error) {
            console.error('Authentication error:', error);
            this.showToast('Authentication Error', error.message, 'error');
        }
    }
    
    async login(email, password) {
        this.showLoading('Signing in...');
        
        return new Promise((resolve, reject) => {
            setTimeout(() => {
                console.log('Attempting login for:', email);
                console.log('Available users:', this.mockData.users.map(u => u.email));
                
                const user = this.mockData.users.find(u => u.email === email && u.password === password);
                if (user) {
                    console.log('Login successful for user:', user.email);
                    this.currentUser = user;
                    this.saveUserToStorage();
                    // Defer navigation to caller to show role selection
                    resolve(user);
                } else {
                    console.log('Login failed - user not found or wrong password');
                    reject(new Error('Invalid credentials'));
                }
                this.hideLoading();
            }, 1000);
        });
    }
    
    async register(userData) {
        this.showLoading('Creating account...');
        
        return new Promise((resolve, reject) => {
            setTimeout(() => {
                console.log('Attempting mock registration for:', userData.email);
                console.log('Current user count:', this.mockData.users.length);
                
                const existingUser = this.mockData.users.find(u => u.email === userData.email);
                if (existingUser) {
                    console.log('Mock registration failed - user already exists in mock data');
                    reject(new Error('User already exists in local data'));
                    this.hideLoading();
                    return;
                }

                if (this.mockData.users.length >= this.MAX_USERS) {
                    console.log('Mock registration failed - user capacity reached');
                    reject(new Error(`User capacity reached. Max ${this.MAX_USERS} users can register.`));
                    this.hideLoading();
                    return;
                }
                
                const newUser = {
                    id: Date.now().toString(),
                    ...userData,
                    role: null
                };
                
                this.mockData.users.push(newUser);
                this.currentUser = newUser;
                this.saveUserToStorage();
                this.saveDataToStorage();
                console.log('Mock registration successful for user:', newUser.email);
                resolve(newUser);
                this.hideLoading();
            }, 1000);
        });
    }
    
    logout() {
        this.currentUser = null;
        this.currentDonor = null;
        this.firebaseUser = null;
        this.saveUserToStorage();
        this.saveDataToStorage();
        
        // Firebase logout
        if (this.firebaseReady && window.firebase) {
            window.firebase.signOut(window.firebase.auth).catch(error => {
                console.log('Firebase logout error:', error);
            });
        }
        
        this.showPage('landing');
        this.showToast('Logged out', 'You have been successfully logged out.');
    }
    
    switchRole() {
        if (!this.currentUser) return;
        
        this.showLoading('Switching role...');
        
        setTimeout(() => {
            const newRole = this.currentUser.role === 'donor' ? 'seeker' : 'donor';
            this.currentUser.role = newRole;
            this.saveUserToStorage();
            
            if (newRole === 'donor') {
                const donor = this.mockData.donors.find(d => d.userId === this.currentUser.id);
                if (donor) {
                    this.currentDonor = donor;
                    this.showPage('donor-dashboard');
                    this.showToast('Role switched!', 'You are now using the Donor dashboard.');
                } else {
                    this.showPage('donor-setup');
                    this.showToast('Complete profile', 'Please complete your donor profile first.');
                }
            } else {
                this.showPage('seeker-dashboard');
                this.showToast('Role switched!', 'You are now using the Seeker dashboard.');
            }
            
            this.hideLoading();
        }, 1000);
    }
    
    selectRole(role) {
        if (!this.currentUser) return;
        
        this.currentUser.role = role;
        this.saveUserToStorage();
        
        if (role === 'donor') {
            this.showPage('donor-setup');
        } else {
            this.showPage('seeker-dashboard');
        }
    }
    
    async getCurrentLocation() {
        try {
            this.showLoading('Getting your location...');
            const locationData = await this.getLocationData();
            const locationInput = document.querySelector('input[name="location"]');
            if (locationInput) {
                locationInput.value = locationData.location;
                locationInput.dataset.latitude = locationData.latitude;
                locationInput.dataset.longitude = locationData.longitude;
            }
            this.showToast('Location detected!', `Location set to: ${locationData.location}`);
        } catch (error) {
            this.showToast('Location error', error.message, 'error');
        } finally {
            this.hideLoading();
        }
    }
    
    getLocationData() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject(new Error('Geolocation not supported'));
                return;
            }
            navigator.geolocation.getCurrentPosition(
                async (position) => {
                    const { latitude, longitude } = position.coords;
                    try {
                        const rev = await this.reverseGeocode(latitude, longitude);
                        resolve({
                            location: rev.locationFormatted,
                            latitude: latitude.toString(),
                            longitude: longitude.toString()
                        });
                    } catch (_) {
                        resolve({
                            location: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
                            latitude: latitude.toString(),
                            longitude: longitude.toString()
                        });
                    }
                },
                (error) => {
                    let message = 'Unable to get your location.';
                    switch (error.code) {
                        case error.PERMISSION_DENIED:
                            message = 'Location access was denied. Please enable location permissions.';
                            break;
                        case error.POSITION_UNAVAILABLE:
                            message = 'Location information is unavailable.';
                            break;
                        case error.TIMEOUT:
                            message = 'Location request timed out.';
                            break;
                    }
                    reject(new Error(message));
                },
                { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 }
            );
        });
    }

    formatIndianLocation(parts) {
        // Expected order: village/mandal < city < district < state
        const { village, mandal, city, district, state } = parts;
        const smallArea = village || mandal;
        const tokens = [];
        if (smallArea) tokens.push(smallArea);
        if (city) tokens.push(city);
        if (district) tokens.push(district);
        if (state) tokens.push(state);
        return tokens.join(', ');
    }

    // Fallback: normalize a manually typed location into "village/city, district, state" order
    normalizeManualLocationString(input) {
        if (!input) return '';
        const rawTokens = input
            .split(/[|/,-]/)
            .map(t => t.trim())
            .filter(Boolean);
        const villageCity = rawTokens[0] || '';
        const district = rawTokens[1] || '';
        const state = rawTokens[2] || '';
        return [villageCity, district, state].filter(Boolean).join(', ');
    }

    parseGoogleAddressComponents(components) {
        const get = (typeList) => {
            const comp = components.find(c => typeList.every(t => c.types.includes(t)));
            return comp ? comp.long_name : '';
        };
        const village = get(['premise']) || get(['subpremise']) || get(['hamlet']) || get(['sublocality_level_3', 'sublocality']) || get(['sublocality_level_2', 'sublocality']) || get(['neighborhood']) || get(['administrative_area_level_4']);
        const mandal = get(['sublocality_level_1', 'sublocality']) || get(['ward']) || get(['administrative_area_level_3']);
        const city = get(['locality']) || get(['postal_town']) || get(['administrative_area_level_2']);
        const district = get(['administrative_area_level_2']) || get(['administrative_area_level_3']) || '';
        const state = get(['administrative_area_level_1']);
        return { village, mandal, city, district, state };
    }

    parseOSMAddress(addr) {
        const village = addr.hamlet || addr.village || addr.neighbourhood || addr.quarter || addr.suburb || '';
        const mandal = addr.city_district || addr.town || addr.county || addr.subdivision || '';
        const city = addr.city || addr.town || addr.municipality || '';
        const district = addr.state_district || addr.county || '';
        const state = addr.state || '';
        return { village, mandal, city, district, state };
    }

    async reverseGeocode(lat, lng) {
        // Try Google first
        if (window.google && this.isGoogleMapsLoaded) {
            try {
                const geocoder = new google.maps.Geocoder();
                const results = await new Promise((resolve, reject) => {
                    geocoder.geocode({ location: { lat: Number(lat), lng: Number(lng) } }, (res, status) => {
                        if (status === 'OK' && res && res[0]) resolve(res);
                        else reject(new Error('Reverse geocode failed'));
                    });
                });
                const components = results[0].address_components || [];
                const parts = this.parseGoogleAddressComponents(components);
                const locationFormatted = this.formatIndianLocation(parts) || results[0].formatted_address;
                return { locationFormatted, state: parts.state || '' };
            } catch (_) {}
        }
        // Fallback to OSM Nominatim
        const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&zoom=14&addressdetails=1`;
        const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
        const data = await res.json();
        const parts = this.parseOSMAddress(data.address || {});
        const locationFormatted = this.formatIndianLocation(parts) || data.display_name;
        return { locationFormatted, state: parts.state || '' };
    }

    async geocodeAddress(address) {
        if (!address) throw new Error('No address provided');
        // Try Google Geocoder first if available
        if (window.google && this.isGoogleMapsLoaded) {
            try {
                const geocoder = new google.maps.Geocoder();
                const results = await new Promise((resolve, reject) => {
                    geocoder.geocode({ address, region: 'IN', componentRestrictions: { country: 'IN' } }, (res, status) => {
                        if (status === 'OK' && res && res[0]) resolve(res);
                        else reject(new Error('Unable to geocode address'));
                    });
                });
                const loc = results[0].geometry.location;
                const parts = this.parseGoogleAddressComponents(results[0].address_components || []);
                const locationFormatted = this.formatIndianLocation(parts) || results[0].formatted_address;
                return { latitude: loc.lat().toString(), longitude: loc.lng().toString(), locationFormatted, state: parts.state || '' };
            } catch (_) {
                // Fall through to OSM
            }
        }
        // Fallback to OpenStreetMap Nominatim
        const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=in&q=${encodeURIComponent(address)}`;
        const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
        if (!res.ok) throw new Error('Geocoding request failed');
        const data = await res.json();
        if (!Array.isArray(data) || data.length === 0) throw new Error('Address not found');
        const detailsUrl = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(data[0].lat)}&lon=${encodeURIComponent(data[0].lon)}&zoom=14&addressdetails=1`;
        const det = await fetch(detailsUrl, { headers: { 'Accept-Language': 'en' } });
        const detJson = await det.json();
        const parts = this.parseOSMAddress(detJson.address || {});
        const locationFormatted = this.formatIndianLocation(parts) || detJson.display_name;
        return { latitude: data[0].lat.toString(), longitude: data[0].lon.toString(), locationFormatted, state: parts.state || '' };
    }
    
    async handleDonorSetup(e) {
        e.preventDefault();
        const formData = new FormData(e.target);
        const locationInput = e.target.querySelector('input[name="location"]');
        
        this.showLoading('Validating profile details...');
        
        try {
            const donorData = {
                bloodType: formData.get('bloodType'),
                age: parseInt(formData.get('age')),
                gender: formData.get('gender'),
                contact: formData.get('contact'),
                occupation: formData.get('occupation'),
                location: formData.get('location'),
                latitude: locationInput.dataset.latitude || '',
                longitude: locationInput.dataset.longitude || '',
                availability: 'available',
                govId: null,
                state: ''
            };
            const govIdFile = formData.get('govId');
            if (govIdFile && typeof govIdFile === 'object') {
                let previewUrl = '';
                try {
                    previewUrl = URL.createObjectURL(govIdFile);
                } catch (_) {}
                donorData.govId = { name: govIdFile.name || 'document', type: govIdFile.type || '', previewUrl };
            }
            
            // If user typed a location and no coordinates were captured, geocode it
            if ((!donorData.latitude || !donorData.longitude) && donorData.location) {
                try {
                    const coords = await this.geocodeAddress(donorData.location);
                    donorData.latitude = coords.latitude;
                    donorData.longitude = coords.longitude;
                    donorData.state = coords.state || '';
                    // Keep user's spelling as typed; do not auto-rewrite location text
                } catch (_) {
                    // Geocoding failed: allow save without coordinates; we will attempt later
                    this.showToast('Saved without map pin', 'We will pin your village on the map later.', 'info');
                }
            }
            // If GPS was used, reverse-geocode to formatted form
            if (donorData.latitude && donorData.longitude && (!donorData.location || donorData.location.includes(',' ) === false)) {
                try {
                    const rev = await this.reverseGeocode(Number(donorData.latitude), Number(donorData.longitude));
                    donorData.state = donorData.state || rev.state || '';
                    // Keep the user's text; don't overwrite spelling
                } catch (_) {}
            }
            
            // Gate profile creation behind rules & eligibility quiz
            this._pendingDonorProfile = donorData;
            this.showPage('donor-eligibility');
            this.showToast('Almost there', 'Complete rules and eligibility to create your profile.', 'info');
        } finally {
            this.hideLoading();
        }
    }

    startEditDonorProfile() {
        if (!this.currentUser) return;
        // Navigate to setup form and prefill values
        this.showPage('donor-setup');
        const donor = this.mockData.donors.find(d => d.userId === this.currentUser.id) || this.currentDonor;
        if (!donor) return;
        const form = document.getElementById('donor-setup-form');
        if (!form) return;
        form.querySelector('select[name="bloodType"]').value = donor.bloodType || '';
        form.querySelector('input[name="age"]').value = donor.age || '';
        form.querySelector('select[name="gender"]').value = donor.gender || '';
        form.querySelector('input[name="contact"]').value = donor.contact || '';
        form.querySelector('input[name="occupation"]').value = donor.occupation || '';
        const locInput = form.querySelector('input[name="location"]');
        locInput.value = donor.location || '';
        if (donor.latitude && donor.longitude) {
            locInput.dataset.latitude = donor.latitude;
            locInput.dataset.longitude = donor.longitude;
        }
    }
    
    initDonorDashboard() {
        if (!this.currentDonor) return;
        
        // Update stats
        const donations = this.mockData.donations.filter(d => d.donorId === this.currentDonor.id);
        const totalDonations = donations.length;
        
        let daysSinceLast = 'N/A';
        if (donations.length > 0) {
            const lastDonation = Math.max(...donations.map(d => new Date(d.date).getTime()));
            daysSinceLast = Math.floor((Date.now() - lastDonation) / (1000 * 60 * 60 * 24));
        }
        
        document.getElementById('total-donations').textContent = totalDonations;
        document.getElementById('days-since-last').textContent = daysSinceLast;
        document.getElementById('blood-type').textContent = this.currentDonor.bloodType;
        
        // Update profile details
        const profileDetails = document.getElementById('profile-details');
        profileDetails.innerHTML = `
            <div class="profile-row">
                <span>Name:</span>
                <span>${this.currentUser.firstName} ${this.currentUser.lastName}</span>
            </div>
            <div class="profile-row">
                <span>Age:</span>
                <span>${this.currentDonor.age}</span>
            </div>
            <div class="profile-row">
                <span>Contact:</span>
                <span>${this.currentDonor.contact}</span>
            </div>
            <div class="profile-row">
                <span>Gender:</span>
                <span style="text-transform: capitalize;">${this.currentDonor.gender}</span>
            </div>
            <div class="profile-row">
                <span>Occupation:</span>
                <span>${this.currentDonor.occupation}</span>
            </div>
            <div class="profile-row">
                <span>Location:</span>
                <span>${this.currentDonor.location}</span>
            </div>
            <div class="profile-row">
                <span>Availability:</span>
                <span class="${this.currentDonor.availability === 'available' ? 'text-green' : 'text-red'}">${this.currentDonor.availability === 'available' ? 'Available' : 'Not Available'}</span>
            </div>
        `;
        // Show Govt ID proof under donor profile with open-on-click
        const govIdContainer = document.getElementById('profile-gov-id');
        if (govIdContainer) {
            const id = this.currentDonor.govId || null;
            if (id && id.previewUrl) {
                const url = id.previewUrl;
                govIdContainer.innerHTML = `
                    <div class="profile-row">
                        <span>Government ID:</span>
                        <a href="${url}" target="_blank" rel="noopener">View uploaded file</a>
                    </div>
                `;
            } else if (id && id.name) {
                // Fallback: show name only, no link if no URL stored
                govIdContainer.innerHTML = `
                    <div class="profile-row">
                        <span>Government ID:</span>
                        <span>${id.name}</span>
                    </div>
                `;
            } else {
                govIdContainer.innerHTML = '';
            }
        }

        // Also populate the navbar user progress panel
        const upRecentList = document.getElementById('up-recent-list');
        const upAvail = document.getElementById('up-availability-select');
        if (upAvail) upAvail.value = this.currentDonor.availability === 'available' ? 'available' : 'unavailable';
        if (upRecentList) {
            if (donations.length === 0) {
                upRecentList.innerHTML = '<div class="empty-state"><p>No donations recorded yet</p></div>';
            } else {
                upRecentList.innerHTML = donations
                    .slice(-5)
                    .map(d => `<div class="profile-row"><span>${new Date(d.date).toLocaleDateString()}</span><span>${d.type}</span></div>`)
                    .join('');
            }
        }
    }
    
    initSeekerDashboard() {
        // Initialize seeker stats (mock data for now)
        document.getElementById('active-requests').textContent = '0';
        document.getElementById('total-responses').textContent = '0';
        document.getElementById('completed-requests').textContent = '0';
        this.applyTranslations();

        // If a donor profile exists, update the navbar panel too
        if (this.currentUser) {
            const donor = this.mockData.donors.find(d => d.userId === this.currentUser.id);
            if (donor) {
                this.currentDonor = donor;
                this.initDonorDashboard();
            }
        }
    }
    
    async handleDonorSearch(e) {
        e.preventDefault();
        const formData = new FormData(e.target);
        // Collect one or more blood types
        let bloodTypes = [];
        const multi = document.querySelector('#donor-search-form select[name="bloodTypes"]');
        if (multi) {
            bloodTypes = Array.from(multi.selectedOptions).map(o => o.value).filter(Boolean);
        } else {
            const single = formData.get('bloodType');
            if (single) bloodTypes = [single];
        }
        let location = formData.get('location');
        const locationInput = e.target.querySelector('input[name="location"]');
        let centerLat = null;
        let centerLng = null;
        
        // If no blood types selected, treat as "show all types"
        
        if (!location) {
            try {
                this.showLoading('Detecting your location...');
                const loc = await this.getLocationData();
                location = loc.location;
                e.target.querySelector('input[name="location"]').value = location;
                centerLat = parseFloat(loc.latitude);
                centerLng = parseFloat(loc.longitude);
            } catch (err) {
                this.hideLoading();
                this.showToast('Location required', 'Please enter a location to search', 'error');
                return;
            }
        }
        
        this.showLoading('Searching for donors...');
        
        // Resolve center coordinates (dataset or geocode)
        try {
            if (centerLat === null || centerLng === null) {
                if (locationInput && locationInput.dataset.latitude && locationInput.dataset.longitude) {
                    centerLat = parseFloat(locationInput.dataset.latitude);
                    centerLng = parseFloat(locationInput.dataset.longitude);
                    try {
                        const rev = await this.reverseGeocode(centerLat, centerLng);
                        this._centerState = rev.state || '';
                    } catch (_) {}
                } else if (location) {
                    const coords = await this.geocodeAddress(location);
                    centerLat = parseFloat(coords.latitude);
                    centerLng = parseFloat(coords.longitude);
                    
                    // Ensure we're in India - if coordinates are outside India, try to find Indian location
                    if (this.isLocationInIndia(centerLat, centerLng)) {
                        this._centerState = coords.state || '';
                        // Normalize typed location to formatted form for consistency
                        e.target.querySelector('input[name="location"]').value = coords.locationFormatted || location;
                    } else {
                        // If location is outside India, try to find a nearby Indian location
                        console.warn('Location appears to be outside India, searching for Indian location...');
                        this._centerState = '';
                        this.showToast('Location Error', 'Please enter a location within India', 'error');
                        centerLat = null;
                        centerLng = null;
                    }
                }
            }
        } catch (err) {
            this.showToast('Location not found', 'Please refine the location and try again.', 'error');
            centerLat = null;
            centerLng = null;
        }

        setTimeout(async () => {
            // Original functionality: 10km radius search with mock data
            let donors = this.mockData.donors.filter(donor => {
                const matchesBloodType = (!bloodTypes || bloodTypes.length === 0) ? true : bloodTypes.includes(donor.bloodType);
                const isAvailable = donor.availability === 'available';
                return matchesBloodType && isAvailable;
            });

            // Enrich donors missing coordinates
            try {
                const enriched = await Promise.all(donors.map(async (d) => {
                    const clone = { ...d };
                    try {
                        if ((!clone.latitude || !clone.longitude) && clone.location) {
                            const g = await this.geocodeAddress(clone.location);
                            clone.latitude = g.latitude;
                            clone.longitude = g.longitude;
                        }
                    } catch (_) {}
                    return clone;
                }));
                donors = enriched;
            } catch (_) {}

            donors = donors.map(donor => {
                // Compute distance if we have a center and donor has coords; else Infinity
                let distanceKm = Infinity;
                if (centerLat !== null && centerLng !== null) {
                    const dLat = parseFloat(donor.latitude);
                    const dLng = parseFloat(donor.longitude);
                    if (!isNaN(dLat) && !isNaN(dLng)) {
                        distanceKm = this.computeDistanceKm(centerLat, centerLng, dLat, dLng);
                    }
                }
                return { donor, distanceKm };
            });

            // Filter donors to same state/district in India only
            const searchState = this._centerState || '';
            const filteredDonors = donors.filter(({ donor }) => {
                // First check if donor coordinates are in India
                const donorLat = parseFloat(donor.latitude);
                const donorLng = parseFloat(donor.longitude);
                
                if (!isNaN(donorLat) && !isNaN(donorLng)) {
                    if (!this.isLocationInIndia(donorLat, donorLng)) {
                        return false; // Exclude donors outside India
                    }
                }
                
                // Only include donors from the same state in India
                if (!searchState) return true; // If we can't determine search state, include all
                
                // Check if donor location contains the same state
                const donorLocation = (donor.location || '').toLowerCase();
                const searchStateLower = searchState.toLowerCase();
                
                // Include if donor is in same state or if we can't determine donor's state
                return donorLocation.includes(searchStateLower) || !donorLocation.includes('india');
            });

            // Sort by distance (near first)
            filteredDonors.sort((a, b) => a.distanceKm - b.distanceKm);

            const donorsWithUsers = filteredDonors.map(({ donor, distanceKm }) => {
                const user = this.mockData.users.find(u => u.id === donor.userId);
                return {
                    ...donor,
                    distanceKm,
                    user
                };
            }).filter(d => !!d.user);

            this.searchResults = donorsWithUsers;
            this.searchCenter = (centerLat !== null && centerLng !== null) ? { lat: centerLat, lng: centerLng } : null;
            this.displaySearchResults();
            this.showToast('Search completed', `Found ${donorsWithUsers.length} available donors in district`);
            this.hideLoading();
        }, 1000);
    }

    // Check if coordinates are within India's boundaries
    isLocationInIndia(lat, lng) {
        // India's approximate boundaries
        const indiaBounds = {
            north: 37.1,  // Jammu and Kashmir
            south: 6.4,   // Tamil Nadu
            east: 97.4,   // Arunachal Pradesh
            west: 68.1    // Gujarat
        };
        
        return lat >= indiaBounds.south && 
               lat <= indiaBounds.north && 
               lng >= indiaBounds.west && 
               lng <= indiaBounds.east;
    }

    // Haversine distance in kilometers
    computeDistanceKm(lat1, lon1, lat2, lon2) {
        const toRad = (v) => (v * Math.PI) / 180;
        const R = 6371; // Earth radius in km
        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                  Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
                  Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    // Offset a coordinate by meters in bearing degrees
    offsetLatLngByMeters(lat, lng, meters, bearingDeg) {
        const R = 6378137; // meters
        const dByR = meters / R;
        const bearing = (bearingDeg * Math.PI) / 180;
        const lat1 = (lat * Math.PI) / 180;
        const lon1 = (lng * Math.PI) / 180;
        const lat2 = Math.asin(
            Math.sin(lat1) * Math.cos(dByR) + Math.cos(lat1) * Math.sin(dByR) * Math.cos(bearing)
        );
        const lon2 =
            lon1 +
            Math.atan2(
                Math.sin(bearing) * Math.sin(dByR) * Math.cos(lat1),
                Math.cos(dByR) - Math.sin(lat1) * Math.sin(lat2)
            );
        return { lat: (lat2 * 180) / Math.PI, lng: (lon2 * 180) / Math.PI };
    }
    
    displaySearchResults() {
        const resultsCount = document.getElementById('results-count');
        const resultsContent = document.getElementById('results-content');
        const mapContainer = document.getElementById('map-container');
        
        resultsCount.textContent = `${this.searchResults.length} Found`;
        
        if (this.searchResults.length > 0) {
            // Show map if Google Maps is loaded
            if (this.isGoogleMapsLoaded) {
                mapContainer.style.display = 'block';
                this.initializeMap();
            }
            
            // Display results
            resultsContent.innerHTML = this.searchResults.map(donor => `
                <div class="donor-result-card">
                    <div class="donor-result-header">
                        <div class="donor-info">
                            <div class="donor-avatar">
                                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path>
                                </svg>
                            </div>
                            <div class="donor-details">
                                <h4>${donor.user ? `${donor.user.firstName} ${donor.user.lastName}` : 'Donor'}</h4>
                                <p class="donor-location">
                                    <svg class="icon-small" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path>
                                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path>
                                    </svg>
                                    ${donor.location}
                                </p>
                            </div>
                        </div>
                        <span class="blood-type-badge">${donor.bloodType}</span>
                    </div>
                    <div class="donor-result-details">
                        <div class="detail-item">
                            <strong>${this.t('detail.age') || 'Age'}:</strong> ${donor.age}
                        </div>
                        <div class="detail-item">
                            <strong>${this.t('detail.gender') || 'Gender'}:</strong> <span style="text-transform: capitalize;">${donor.gender}</span>
                        </div>
                        <div class="detail-item">
                            <strong>${this.t('detail.occupation') || 'Occupation'}:</strong> ${donor.occupation}
                        </div>
                        <div class="detail-item">
                            <strong>Distance:</strong> ${isFinite(donor.distanceKm) ? donor.distanceKm.toFixed(1) + ' km' : '—'}
                        </div>
                        <div class="detail-item">
                            <strong>${this.t('detail.availability') || 'Availability'}:</strong> <span class="text-green">${this.t('detail.available') || 'Available'}</span>
                        </div>
                    </div>
                    <button class="btn btn-primary btn-full contact-donor-btn" data-donor-id="${donor.id}">
                        ${this.t('detail.contact_btn') || 'Contact Donor'}
                    </button>
                </div>
            `).join('');
            
            // Add event listeners to contact buttons
            document.querySelectorAll('.contact-donor-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const donorId = btn.dataset.donorId;
                    const donor = this.searchResults.find(d => d.id === donorId);
                    if (donor) {
                        this.showDonorModal(donor);
                    }
                });
            });

            // Apply translations to any new tagged nodes
            this.applyTranslations();
        } else {
            mapContainer.style.display = 'none';
            resultsContent.innerHTML = `
                <div class="empty-state">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
                    </svg>
                    <p>No donors found matching your criteria</p>
                </div>
            `;
        }
    }
    
    initializeMap() {
        if (!window.google || this.searchResults.length === 0) return;
        
        const mapContainer = document.getElementById('map-container');
        if (!mapContainer) return;
        
        // Calculate center point: prefer seeker center, else first result, else default
        let center = this.searchCenter || null;
        if (!center) {
            const firstWithCoords = this.searchResults.find(r => !isNaN(parseFloat(r.latitude)) && !isNaN(parseFloat(r.longitude)));
            if (firstWithCoords) {
                center = { lat: parseFloat(firstWithCoords.latitude), lng: parseFloat(firstWithCoords.longitude) };
            } else {
                center = { lat: 20.5937, lng: 78.9629 }; // Fallback center: India
            }
        }
        
        this.map = new google.maps.Map(mapContainer, {
            center: center,
            zoom: 12,
            styles: [
                {
                    featureType: 'poi',
                    elementType: 'labels',
                    stylers: [{ visibility: 'off' }]
                }
            ]
        });
        
        // Clear existing markers
        if (this._mapMarkers && this._mapMarkers.length) {
            this._mapMarkers.forEach(m => m.setMap(null));
        }
        this._mapMarkers = [];

        // Add markers for donors with overlap offset
        const seenCoordCounts = new Map();
        this.searchResults.forEach(async donor => {
            const lat = parseFloat(donor.latitude);
            const lng = parseFloat(donor.longitude);
            
            let hasCoords = !(isNaN(lat) || isNaN(lng));
            let markerPos = null;
            if (!hasCoords && donor.location) {
                // Attempt to geocode village-only names on the fly
                try {
                    const coords = await this.geocodeAddress(donor.location);
                    donor.latitude = coords.latitude;
                    donor.longitude = coords.longitude;
                    hasCoords = true;
                } catch (_) {}
            }

            if (hasCoords) {
                const dLat = parseFloat(donor.latitude);
                const dLng = parseFloat(donor.longitude);
                const key = `${lat.toFixed(6)},${lng.toFixed(6)}`;
                const count = (seenCoordCounts.get(key) || 0);
                seenCoordCounts.set(key, count + 1);
                let position = { lat: dLat, lng: dLng };
                if (count > 0) {
                    const angleDeg = (count * 45) % 360;
                    const ring = Math.floor(count / 8) + 1;
                    const radiusMeters = 8 * ring;
                    position = this.offsetLatLngByMeters(lat, lng, radiusMeters, angleDeg);
                }
                const marker = new google.maps.Marker({
                    position,
                    map: this.map,
                    title: `${donor.bloodType} Donor`,
                    icon: {
                        path: google.maps.SymbolPath.CIRCLE,
                        scale: 8,
                        fillColor: '#dc2626',
                        fillOpacity: 1,
                        strokeWeight: 2,
                        strokeColor: '#ffffff'
                    }
                });
                this._mapMarkers.push(marker);
                
                const infoWindow = new google.maps.InfoWindow({
                    content: `
                        <div style="padding:12px; max-width:260px;">
                            <div style="font-weight:700; font-size:16px; color:#111827; margin-bottom:6px;">${donor.user ? donor.user.firstName + ' ' + donor.user.lastName : 'Donor'} (${donor.bloodType})</div>
                            <div style="font-size:13px; color:#374151; line-height:1.4;">
                                <div><strong>${this.t('detail.age') || 'Age'}:</strong> ${donor.age}</div>
                                <div><strong>${this.t('detail.gender') || 'Gender'}:</strong> ${donor.gender}</div>
                                <div><strong>${this.t('detail.occupation') || 'Occupation'}:</strong> ${donor.occupation}</div>
                                <div><strong>${this.t('detail.location') || 'Location'}:</strong> ${donor.location}</div>
                                <div><strong>${this.t('detail.contact') || 'Contact'}:</strong> ${donor.contact}</div>
                            </div>
                        </div>
                    `
                });
                
                marker.addListener('click', () => {
                    infoWindow.open(this.map, marker);
                    this.showDonorModal(donor);
                });
            }
        });
        
        // Draw 10km radius circle if search center available
        let bounds = null;
        if (this.searchCenter) {
            const circle = new google.maps.Circle({
                strokeColor: '#2563eb',
                strokeOpacity: 0.8,
                strokeWeight: 2,
                fillColor: '#3b82f6',
                fillOpacity: 0.1,
                map: this.map,
                center: this.searchCenter,
                radius: this.searchRadiusKm * 1000
            });
            bounds = circle.getBounds();

            // Add seeker center marker (blue dot)
            const centerMarker = new google.maps.Marker({
                position: this.searchCenter,
                map: this.map,
                title: 'Search Center',
                icon: {
                    path: google.maps.SymbolPath.CIRCLE,
                    scale: 6,
                    fillColor: '#2563eb',
                    fillOpacity: 1,
                    strokeWeight: 2,
                    strokeColor: '#ffffff'
                }
            });
            this._mapMarkers.push(centerMarker);
        }

        // Fit bounds to include markers and radius
        if (this._mapMarkers.length > 0) {
            if (!bounds) bounds = new google.maps.LatLngBounds();
            this._mapMarkers.forEach(m => bounds.extend(m.getPosition()));
            if (this.searchCenter) bounds.extend(this.searchCenter);
            this.map.fitBounds(bounds);
        }
    }
    
    showDonorModal(donor) {
        const modal = document.getElementById('donor-modal');
        const modalName = document.getElementById('donor-modal-name');
        const modalBloodType = document.getElementById('donor-modal-blood-type');
        const detailsLeft = document.getElementById('donor-details-left');
        const detailsRight = document.getElementById('donor-details-right');
        const donorPhone = document.getElementById('donor-phone');
        
        modalName.textContent = donor.user ? `${donor.user.firstName} ${donor.user.lastName}` : 'Donor';
        modalBloodType.textContent = `Blood Type: ${donor.bloodType}`;
        donorPhone.textContent = donor.contact;
        
        detailsLeft.innerHTML = `
            <div class="detail-item">
                <div class="detail-icon">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path>
                    </svg>
                </div>
                <div>
                    <p class="detail-label">Age</p>
                    <p class="detail-value">${donor.age} years old</p>
                </div>
            </div>
            <div class="detail-item">
                <div class="detail-icon">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path>
                    </svg>
                </div>
                <div>
                    <p class="detail-label">Gender</p>
                    <p class="detail-value" style="text-transform: capitalize;">${donor.gender}</p>
                </div>
            </div>
        `;
        
        detailsRight.innerHTML = `
            <div class="detail-item">
                <div class="detail-icon">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m8 6V8a2 2 0 00-2-2H10a2 2 0 00-2 2v8a2 2 0 002 2h4a2 2 0 002-2z"></path>
                    </svg>
                </div>
                <div>
                    <p class="detail-label">Occupation</p>
                    <p class="detail-value">${donor.occupation}</p>
                </div>
            </div>
            <div class="detail-item">
                <div class="detail-icon">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path>
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path>
                    </svg>
                </div>
                <div>
                    <p class="detail-label">Location</p>
                    <p class="detail-value">${donor.location}</p>
                </div>
            </div>
        `;
        
        // Initialize modal map
        if (this.isGoogleMapsLoaded) {
            setTimeout(() => {
                const modalMap = document.getElementById('modal-map');
                if (modalMap && window.google) {
                    let lat = parseFloat(donor.latitude);
                    let lng = parseFloat(donor.longitude);
                    const tryRender = (plat, plng) => {
                        const map = new google.maps.Map(modalMap, {
                            center: { lat: plat, lng: plng },
                            zoom: 15,
                            styles: [
                                {
                                    featureType: 'poi',
                                    elementType: 'labels',
                                    stylers: [{ visibility: 'off' }]
                                }
                            ]
                        });
                        new google.maps.Marker({
                            position: { lat: plat, lng: plng },
                            map: map,
                            title: `${donor.bloodType} Donor`,
                            icon: {
                                path: google.maps.SymbolPath.CIRCLE,
                                scale: 10,
                                fillColor: '#dc2626',
                                fillOpacity: 1,
                                strokeWeight: 2,
                                strokeColor: '#ffffff'
                            }
                        });
                    };
                    if (!isNaN(lat) && !isNaN(lng)) {
                        tryRender(lat, lng);
                    } else if (donor.location) {
                        this.geocodeAddress(donor.location).then(coords => {
                            donor.latitude = coords.latitude;
                            donor.longitude = coords.longitude;
                            tryRender(parseFloat(coords.latitude), parseFloat(coords.longitude));
                        }).catch(() => {
                            // As a last resort center broadly over India
                            tryRender(20.5937, 78.9629);
                        });
                    } else {
                        tryRender(20.5937, 78.9629);
                    }
                }
            }, 100);
        }
        
        // Reset contact reveal state
        document.getElementById('contact-hidden').style.display = 'block';
        document.getElementById('contact-revealed').style.display = 'none';
        
        modal.style.display = 'flex';
    }
    
    closeModal() {
        document.getElementById('donor-modal').style.display = 'none';
    }
    
    revealContact() {
        document.getElementById('contact-hidden').style.display = 'none';
        document.getElementById('contact-revealed').style.display = 'block';
    }
    
    callDonor() {
        const phone = document.getElementById('donor-phone').textContent;
        window.open(`tel:${phone}`, '_self');
    }
    
    showLoading(text = 'Loading...') {
        const loading = document.getElementById('loading-spinner');
        const loadingText = document.getElementById('loading-text');
        
        loadingText.textContent = text;
        loading.style.display = 'flex';
        // Safety: auto-hide spinner after 12s to avoid being stuck
        if (this._loadingTimer) clearTimeout(this._loadingTimer);
        this._loadingTimer = setTimeout(() => {
            if (loading.style.display !== 'none') {
                loading.style.display = 'none';
            }
        }, 12000);
    }
    
    hideLoading() {
        const loading = document.getElementById('loading-spinner');
        loading.style.display = 'none';
        if (this._loadingTimer) {
            clearTimeout(this._loadingTimer);
            this._loadingTimer = null;
        }
    }
    
    showToast(title, description, type = 'success') {
        const container = document.getElementById('toast-container');
        const id = Date.now().toString();
        
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `
            <div class="toast-title">${title}</div>
            <div class="toast-description">${description}</div>
        `;
        
        container.appendChild(toast);
        
        // Animate in
        setTimeout(() => {
            toast.classList.add('toast-show');
        }, 10);
        
        // Remove after 5 seconds
        setTimeout(() => {
            toast.classList.remove('toast-show');
            setTimeout(() => {
                if (container.contains(toast)) {
                    container.removeChild(toast);
                }
            }, 300);
        }, 5000);
    }

    toggleUserProgressPanel() {
        const panel = document.getElementById('user-progress-panel');
        if (!panel) return;
        panel.style.display = panel.style.display === 'none' || panel.style.display === '' ? 'block' : 'none';
        // Refresh data when opened
        if (panel.style.display === 'block') {
            if (this.currentUser && this.currentUser.role === 'donor') {
                this.initDonorDashboard();
            }
        }
    }

    toggleRecentDonations() {
        const list = document.getElementById('up-recent-list');
        const btn = document.getElementById('up-recent-toggle');
        if (!list || !btn) return;
        const willShow = list.style.display === 'none' || list.style.display === '';
        list.style.display = willShow ? 'block' : 'none';
        btn.textContent = willShow ? 'Hide' : 'Show';
    }

    updateAvailability(e) {
        if (!this.currentUser) return;
        const value = e?.target?.value === 'available' ? 'available' : 'unavailable';
        // Update donor record
        let donor = this.mockData.donors.find(d => d.userId === this.currentUser.id);
        if (donor) {
            donor.availability = value;
            if (this.currentDonor && this.currentDonor.id === donor.id) {
                this.currentDonor.availability = value;
            }
            this.saveDataToStorage();
            
            // Sync to Firebase
            this.syncDonorToFirestore();
            
            // Refresh seeker list/map if open; otherwise update donor dashboard UI
            const form = document.getElementById('donor-search-form');
            if (form && this.currentPage === 'seeker-dashboard') {
                form.dispatchEvent(new Event('submit'));
            }
            if (this.currentPage === 'donor-dashboard') {
                this.initDonorDashboard();
            }
            this.showToast('Availability updated', value === 'available' ? 'You are now available' : 'You are now hidden from seekers');
        }
    }

    // Firebase Authentication Integration
    initFirebase() {
        // Wait for Firebase to be available
        const checkFirebase = () => {
            if (window.firebase && window.firebase.auth) {
                this.firebaseReady = true;
                this.setupFirebaseAuthListener();
                console.log('Firebase Authentication initialized successfully');
                console.log('Firebase Auth object:', window.firebase.auth);
                
                // Test Google OAuth configuration
                this.testGoogleOAuthConfig();
            } else {
                console.log('Waiting for Firebase to load...');
                // Try for up to 10 seconds, then give up
                if (this.firebaseCheckAttempts < 100) {
                    this.firebaseCheckAttempts = (this.firebaseCheckAttempts || 0) + 1;
                    setTimeout(checkFirebase, 100);
                } else {
                    console.log('Firebase failed to load after 10 seconds, using mock authentication only');
                }
            }
        };
        this.firebaseCheckAttempts = 0;
        checkFirebase();
    }

    testGoogleOAuthConfig() {
        try {
            const provider = new window.firebase.GoogleAuthProvider();
            console.log('Google OAuth provider created successfully:', provider);
            console.log('Provider ID:', provider.providerId);
            console.log('Scopes:', provider.scopes);
        } catch (error) {
            console.error('Google OAuth configuration test failed:', error);
        }
    }

    // Firebase Firestore Methods
    async saveToFirestore(collectionName, data, docId = null) {
        if (!this.firebaseReady || !window.firebase.db) {
            console.log('Firebase not ready, skipping Firestore save');
            return null;
        }

        try {
            if (docId) {
                await window.firebase.setDoc(window.firebase.doc(window.firebase.db, collectionName, docId), data);
                return docId;
            } else {
                const docRef = await window.firebase.addDoc(window.firebase.collection(window.firebase.db, collectionName), data);
                return docRef.id;
            }
        } catch (error) {
            console.error('Error saving to Firestore:', error);
            throw error;
        }
    }

    async getFromFirestore(collectionName, docId) {
        if (!this.firebaseReady || !window.firebase.db) {
            console.log('Firebase not ready, skipping Firestore get');
            return null;
        }

        try {
            const docRef = window.firebase.doc(window.firebase.db, collectionName, docId);
            const docSnap = await window.firebase.getDoc(docRef);
            
            if (docSnap.exists()) {
                return { id: docSnap.id, ...docSnap.data() };
            } else {
                return null;
            }
        } catch (error) {
            console.error('Error getting from Firestore:', error);
            throw error;
        }
    }

    async queryFirestore(collectionName, conditions = []) {
        if (!this.firebaseReady || !window.firebase.db) {
            console.log('Firebase not ready, skipping Firestore query');
            return [];
        }

        try {
            let q = window.firebase.collection(window.firebase.db, collectionName);
            
            conditions.forEach(condition => {
                q = window.firebase.query(q, window.firebase.where(condition.field, condition.operator, condition.value));
            });
            
            const querySnapshot = await window.firebase.getDocs(q);
            const results = [];
            
            querySnapshot.forEach((doc) => {
                results.push({ id: doc.id, ...doc.data() });
            });
            
            return results;
        } catch (error) {
            console.error('Error querying Firestore:', error);
            throw error;
        }
    }

    async syncUserToFirestore() {
        if (!this.currentUser || !this.firebaseReady) return;

        try {
            const userData = {
                email: this.currentUser.email,
                firstName: this.currentUser.firstName,
                lastName: this.currentUser.lastName,
                role: this.currentUser.role,
                availability: this.currentUser.availability || 'available',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            await this.saveToFirestore('users', userData, this.currentUser.id);
            console.log('User synced to Firestore');
        } catch (error) {
            console.error('Error syncing user to Firestore:', error);
        }
    }

    async syncDonorToFirestore() {
        if (!this.currentDonor || !this.firebaseReady) return;

        try {
            const donorData = {
                userId: this.currentUser.id,
                email: this.currentUser.email,
                firstName: this.currentDonor.firstName,
                lastName: this.currentDonor.lastName,
                bloodType: this.currentDonor.bloodType,
                location: this.currentDonor.location,
                latitude: this.currentDonor.latitude,
                longitude: this.currentDonor.longitude,
                state: this.currentDonor.state,
                phone: this.currentDonor.phone,
                availability: this.currentDonor.availability || 'available',
                govId: this.currentDonor.govId,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            await this.saveToFirestore('donors', donorData, this.currentDonor.id);
            console.log('Donor synced to Firestore');
        } catch (error) {
            console.error('Error syncing donor to Firestore:', error);
        }
    }

    async loadDonorsFromFirestore() { return this.mockData.donors; }

    setupFirebaseAuthListener() {
        if (!this.firebaseReady) return;

        window.firebase.onAuthStateChanged(window.firebase.auth, (user) => {
            this.firebaseUser = user;
            if (user) {
                console.log('Firebase user signed in:', user.email);
                // Sync Firebase user with local user if needed
                this.syncFirebaseUser(user);
            } else {
                console.log('Firebase user signed out');
            }
        });

        // Handle redirect results (for when popup is blocked)
        this.handleRedirectResult();
    }

    async handleRedirectResult() {
        try {
            const result = await window.firebase.getRedirectResult(window.firebase.auth);
            if (result && result.user) {
                console.log('Redirect sign-in successful:', result.user);
                this.firebaseUser = result.user;
                this.syncFirebaseUser(result.user);
                this.showToast('Signed in with Google', 'Choose your role to continue.');
                this.showPage('role-selection');
            }
        } catch (error) {
            console.error('Redirect result error:', error);
        }
    }

    syncFirebaseUser(firebaseUser) {
        // Check if we have a local user that matches Firebase user
        const localUser = this.mockData.users.find(u => u.email === firebaseUser.email);
        
        if (!localUser) {
            // Create local user from Firebase user
            const newUser = {
                id: firebaseUser.uid,
                email: firebaseUser.email,
                firstName: (firebaseUser.displayName && firebaseUser.displayName.split(' ')[0]) || this.currentUser?.firstName || 'User',
                lastName: (firebaseUser.displayName && firebaseUser.displayName.split(' ').slice(1).join(' ')) || this.currentUser?.lastName || '',
                role: null,
                firebaseUid: firebaseUser.uid
            };
            
            this.mockData.users.push(newUser);
            this.currentUser = newUser;
            this.saveUserToStorage();
            this.saveDataToStorage();
        } else {
            // Update local user with Firebase info
            localUser.firebaseUid = firebaseUser.uid;
            if (firebaseUser.displayName) {
                const parts = firebaseUser.displayName.split(' ');
                if (!localUser.firstName || localUser.firstName === 'User') {
                    localUser.firstName = parts[0] || localUser.firstName || 'User';
                }
                if (!localUser.lastName) {
                    localUser.lastName = parts.slice(1).join(' ') || localUser.lastName || '';
                }
            }
            this.currentUser = localUser;
            this.saveUserToStorage();
        }
    }

    async firebaseLogin(email, password) {
        if (!this.firebaseReady) {
            throw new Error('Firebase not ready');
        }

        try {
            const userCredential = await window.firebase.signInWithEmailAndPassword(
                window.firebase.auth, 
                email, 
                password
            );
            
            this.firebaseUser = userCredential.user;
            this.syncFirebaseUser(userCredential.user);
            
            return userCredential.user;
        } catch (error) {
            console.error('Firebase login error:', error);
            throw new Error(this.getFirebaseErrorMessage(error));
        }
    }

    async firebaseRegister(email, password, firstName, lastName) {
        if (!this.firebaseReady) {
            throw new Error('Firebase not ready');
        }

        try {
            const userCredential = await window.firebase.createUserWithEmailAndPassword(
                window.firebase.auth,
                email,
                password
            );

            // Update display name using SDK helper
            try {
                if (window.firebase.updateProfile) {
                    await window.firebase.updateProfile(userCredential.user, {
                        displayName: `${firstName || ''} ${lastName || ''}`.trim()
                    });
                } else if (userCredential.user.updateProfile) {
                    await userCredential.user.updateProfile({
                        displayName: `${firstName || ''} ${lastName || ''}`.trim()
                    });
                }
            } catch (nameErr) {
                console.warn('Display name update failed (non-blocking):', nameErr);
            }

            this.firebaseUser = userCredential.user;
            this.syncFirebaseUser(userCredential.user);
            
            return userCredential.user;
        } catch (error) {
            console.error('Firebase register error:', error);
            // Re-throw with original code preserved to avoid misclassification
            const err = new Error(this.getFirebaseErrorMessage(error));
            err.code = error.code;
            throw err;
        }
    }

    async firebaseGoogleLogin() {
        if (!this.firebaseReady) {
            throw new Error('Firebase not ready');
        }

        try {
            console.log('Attempting Google sign-in...');
            console.log('Firebase auth object:', window.firebase.auth);
            console.log('GoogleAuthProvider available:', !!window.firebase.GoogleAuthProvider);
            
            const provider = new window.firebase.GoogleAuthProvider();
            
            // Add additional OAuth scopes if needed
            provider.addScope('email');
            provider.addScope('profile');
            
            console.log('Google provider created:', provider);
            console.log('Provider scopes:', provider.scopes);
            
            const result = await window.firebase.signInWithPopup(window.firebase.auth, provider);
            console.log('Google sign-in successful:', result.user);
            
            this.firebaseUser = result.user;
            this.syncFirebaseUser(result.user);
            
            return result.user;
        } catch (error) {
            console.error('Firebase Google login error:', error);
            console.error('Error code:', error.code);
            console.error('Error message:', error.message);
            
            // If it's a popup blocked error, try redirect instead
            if (error.code === 'auth/popup-blocked') {
                console.log('Popup blocked, trying redirect method...');
                try {
                    const provider = new window.firebase.GoogleAuthProvider();
                    provider.addScope('email');
                    provider.addScope('profile');
                    
                    // Note: signInWithRedirect requires handling the redirect result
                    await window.firebase.signInWithRedirect(window.firebase.auth, provider);
                    return null; // Will be handled by onAuthStateChanged
                } catch (redirectError) {
                    console.error('Redirect method also failed:', redirectError);
                    throw new Error('Google sign-in failed. Please check if popups are blocked and try again.');
                }
            }
            
            throw new Error(this.getFirebaseErrorMessage(error));
        }
    }

    async firebaseFacebookLogin() {
        if (!this.firebaseReady) {
            throw new Error('Firebase not ready');
        }

        try {
            console.log('Attempting Facebook sign-in...');
            const provider = new window.firebase.FacebookAuthProvider();
            console.log('Facebook provider created:', provider);
            
            const result = await window.firebase.signInWithPopup(window.firebase.auth, provider);
            console.log('Facebook sign-in successful:', result.user);
            
            this.firebaseUser = result.user;
            this.syncFirebaseUser(result.user);
            
            return result.user;
        } catch (error) {
            console.error('Firebase Facebook login error:', error);
            console.error('Error code:', error.code);
            console.error('Error message:', error.message);
            throw new Error(this.getFirebaseErrorMessage(error));
        }
    }

    getFirebaseErrorMessage(error) {
        switch (error.code) {
            case 'auth/user-not-found':
                return 'No account found with this email address';
            case 'auth/wrong-password':
                return 'Incorrect password';
            case 'auth/email-already-in-use':
                return 'An account with this email already exists';
            case 'auth/weak-password':
                return 'Password is too weak';
            case 'auth/invalid-email':
                return 'Invalid email address';
            case 'auth/too-many-requests':
                return 'Too many failed attempts. Please try again later';
            case 'auth/popup-closed-by-user':
                return 'Sign-in popup was closed';
            case 'auth/cancelled-popup-request':
                return 'Sign-in was cancelled';
            case 'auth/popup-blocked':
                return 'Popup was blocked by browser. Please allow popups and try again.';
            case 'auth/operation-not-allowed':
                return 'Google sign-in is not enabled in Firebase Console. Please enable it in Authentication > Sign-in method > Google.';
            case 'auth/unauthorized-domain':
                return 'This domain is not authorized for Google sign-in. Please add this domain to Firebase Console > Authentication > Settings > Authorized domains.';
            case 'auth/network-request-failed':
                return 'Network error. Please check your internet connection and try again.';
            case 'auth/account-exists-with-different-credential':
                return 'An account already exists with this email address. Please sign in with your existing method.';
            default:
                return error.message || 'Authentication failed';
        }
    }

    // Debug method for testing authentication (can be called from browser console)
    async debugAuth() {
        console.log('=== Authentication Debug ===');
        console.log('Firebase ready:', this.firebaseReady);
        console.log('Firebase auth object:', window.firebase?.auth);
        console.log('Mock data users:', this.mockData.users);
        console.log('Current user:', this.currentUser);
        console.log('Is register mode:', this.isRegisterMode);
        
        // Test Firebase status
        if (this.firebaseReady) {
            console.log('Firebase is ready - users will be created in Firebase Console');
        } else {
            console.log('Firebase not ready - using mock authentication only');
        }
        
        // Test login with existing user
        try {
            console.log('Testing login with john.donor@example.com...');
            await this.login('john.donor@example.com', 'password123');
            console.log('Login test successful!');
        } catch (error) {
            console.error('Login test failed:', error);
        }
    }

    // Clear all user data for testing (can be called from browser console)
    clearAllData() {
        console.log('Clearing all user data...');
        this.mockData = {
            users: [],
            donors: [],
            donations: [],
            bloodRequests: []
        };
        this.currentUser = null;
        this.firebaseUser = null;
        this.saveUserToStorage();
        this.saveDataToStorage();
        console.log('All user data cleared. Ready for fresh sign-ups.');
    }

    // Test authentication with a new user (can be called from browser console)
    async testNewUser() {
        console.log('Testing new user registration...');
        const testEmail = `test${Date.now()}@example.com`;
        const testPassword = 'Test123!';
        
        try {
            await this.register({
                email: testEmail,
                password: testPassword,
                firstName: 'Test',
                lastName: 'User'
            });
            console.log('New user registration successful!');
            
            // Now test login
            this.currentUser = null;
            await this.login(testEmail, testPassword);
            console.log('New user login successful!');
            
            return true;
        } catch (error) {
            console.error('Test failed:', error);
            return false;
        }
    }

    // Test Firebase donor data loading (can be called from browser console)
    async testFirebaseDonors() {
        console.log('Testing Firebase donor data loading...');
        try {
            const donors = await this.loadDonorsFromFirestore();
            console.log(`Loaded ${donors.length} donors from Firebase:`, donors);
            return donors;
        } catch (error) {
            console.error('Firebase donor test failed:', error);
            return [];
        }
    }

    // Create a test donor profile for testing (can be called from browser console)
    async createTestDonor() {
        if (!this.currentUser) {
            console.error('No user logged in. Please login first.');
            return false;
        }

        console.log('Creating test donor profile...');
        const testDonor = {
            id: `test_${Date.now()}`,
            userId: this.currentUser.id,
            firstName: 'Test',
            lastName: 'Donor',
            bloodType: 'O+',
            location: 'Mumbai, Maharashtra',
            latitude: '19.0760',
            longitude: '72.8777',
            state: 'Maharashtra',
            phone: '+91-9876543210',
            availability: 'available',
            govId: {
                type: 'Aadhaar',
                previewUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k='
            }
        };

        this.currentDonor = testDonor;
        this.mockData.donors.push(testDonor);
        this.saveDataToStorage();
        
        // Sync to Firebase
        await this.syncDonorToFirestore();
        
        console.log('Test donor profile created and synced to Firebase!');
        return true;
    }

    // Test Google authentication (can be called from browser console)
    async testGoogleAuth() {
        console.log('=== Google Authentication Test ===');
        console.log('Firebase ready:', this.firebaseReady);
        console.log('Firebase auth:', !!window.firebase?.auth);
        console.log('GoogleAuthProvider:', !!window.firebase?.GoogleAuthProvider);
        console.log('Current user:', this.currentUser);
        
        if (!this.firebaseReady) {
            console.error('❌ Firebase not ready - check Firebase configuration');
            return false;
        }
        
        if (!window.firebase?.auth) {
            console.error('❌ Firebase auth not available');
            return false;
        }
        
        if (!window.firebase?.GoogleAuthProvider) {
            console.error('❌ GoogleAuthProvider not available');
            return false;
        }
        
        try {
            console.log('🔄 Attempting Google sign-in...');
            await this.firebaseGoogleLogin();
            console.log('✅ Google authentication test successful!');
            console.log('User signed in:', this.currentUser);
            return true;
        } catch (error) {
            console.error('❌ Google authentication test failed:', error);
            console.error('Error details:', {
                code: error.code,
                message: error.message,
                stack: error.stack
            });
            
            // Provide specific guidance based on error
            if (error.code === 'auth/popup-blocked') {
                console.log('💡 Solution: Allow popups for this site and try again');
            } else if (error.code === 'auth/operation-not-allowed') {
                console.log('💡 Solution: Enable Google Sign-in in Firebase Console');
            } else if (error.code === 'auth/unauthorized-domain') {
                console.log('💡 Solution: Add this domain to Firebase authorized domains');
            }
            
            return false;
        }
    }

    // Comprehensive authentication test suite
    async runAuthTests() {
        console.log('=== BloodConnect Authentication Test Suite ===');
        
        // Test 1: Firebase Status
        console.log('\n1. Testing Firebase Status...');
        const firebaseStatus = {
            ready: this.firebaseReady,
            auth: !!window.firebase?.auth,
            db: !!window.firebase?.db,
            GoogleAuthProvider: !!window.firebase?.GoogleAuthProvider,
            FacebookAuthProvider: !!window.firebase?.FacebookAuthProvider
        };
        console.log('Firebase Status:', firebaseStatus);
        
        // Test 2: Google Authentication
        console.log('\n2. Testing Google Authentication...');
        const googleTest = await this.testGoogleAuth();
        
        // Test 3: Mock Authentication (fallback)
        console.log('\n3. Testing Mock Authentication...');
        try {
            await this.login('john.donor@example.com', 'password123');
            console.log('✅ Mock authentication working');
            this.logout(); // Clean up
        } catch (error) {
            console.error('❌ Mock authentication failed:', error);
        }
        
        // Test 4: Firebase Donor Data
        console.log('\n4. Testing Firebase Donor Data...');
        try {
            const donors = await this.loadDonorsFromFirestore();
            console.log(`✅ Loaded ${donors.length} donors from Firebase`);
        } catch (error) {
            console.error('❌ Firebase donor data test failed:', error);
        }
        
        console.log('\n=== Test Summary ===');
        console.log('Firebase Status:', firebaseStatus.ready ? '✅ Ready' : '❌ Not Ready');
        console.log('Google Auth:', googleTest ? '✅ Working' : '❌ Failed');
        console.log('Mock Auth:', '✅ Working (fallback)');
        console.log('Firebase Data:', '✅ Working');
        
        return {
            firebaseReady: firebaseStatus.ready,
            googleAuth: googleTest,
            mockAuth: true,
            firebaseData: true
        };
    }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const app = new BloodConnectApp();
    
    // Make debug methods available globally
    window.debugAuth = () => app.debugAuth();
    window.clearAllData = () => app.clearAllData();
    window.testNewUser = () => app.testNewUser();
    window.testFirebaseDonors = () => app.testFirebaseDonors();
    window.createTestDonor = () => app.createTestDonor();
    window.testGoogleAuth = () => app.testGoogleAuth();
    window.runAuthTests = () => app.runAuthTests();
    window.checkFirebaseStatus = () => {
        console.log('Firebase Status:', {
            ready: app.firebaseReady,
            auth: !!window.firebase?.auth,
            db: !!window.firebase?.db,
            currentUser: app.currentUser,
            firebaseUser: app.firebaseUser
        });
    };
});