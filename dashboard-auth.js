/**
 * dashboard-auth.js
 * Mixta Africa Projects Dashboard — Google Sign-In Gate
 *
 * SECURITY MODEL (three gates, all must pass):
 *   Gate 1 — Domain:     email must end with @mixtafrica.com
 *   Gate 2 — Allowlist:  email must be in ALLOWED (hardcoded) OR Firebase mgmt_users
 *   Gate 3 — Firebase:   allowlist is authoritative in Firebase for admin-added users
 *
 * Unauthorised @mixtafrica.com users see an explicit "Access Denied" screen
 * with a one-click "Request Access" button that emails o.olasunkanmi@mixtafrica.com.
 *
 * Admin panel additions are written to Firebase and take effect immediately
 * on ALL browsers — no localStorage dependency.
 */

(function () {
  'use strict';

  // ── HARDCODED ALLOWLIST (base set) ────────────────────────────────────────
  // Values: "Both" | "Crossings" | "Annexe"
  // Firebase mgmt_users overrides/extends this at runtime.
  const ALLOWED = {
    // Both projects
    "a.arokodare@mixtafrica.com":             "Both",
    "a.cameron-cole@mixtafrica.com":          "Both",
    "a.omotayo@mixtafrica.com":               "Both",
    "a.uwuigbe@mixtafrica.com":               "Both",
    "c.ajie@mixtafrica.com":                  "Both",
    "c.uwadiale@mixtafrica.com":              "Both",
    "dcs_nigeria@mixtafrica.com":             "Both",
    "deji.alli@mixtafrica.com":               "Both",
    "e.ezeh@mixtafrica.com":                  "Both",
    "h.kacou@mixtafrica.com":                 "Both",
    "ipd_nigeria@mixtafrica.com":             "Both",
    "j.olowe@mixtafrica.com":                 "Both",
    "k.haastrup@mixtafrica.com":              "Both",
    "mcc@mixtafrica.com":                     "Both",
    "mn_costingandprocurement@mixtafrica.com":"Both",
    "n.anaeto@mixtafrica.com":                "Both",
    "o.ajala@mixtafrica.com":                 "Both",
    "o.ekpikie@mixtafrica.com":               "Both",
    "o.olasunkanmi@mixtafrica.com":           "Both",
    "o.shoyoye@mixtafrica.com":               "Both",
    "o.tona-obafemi@mixtafrica.com":          "Both",
    "pmo_nigeria@mixtafrica.com":             "Both",
    "r.idaeho@mixtafrica.com":                "Both",
    "r.jolaiya@mixtafrica.com":               "Both",
    "s.edadagbon@mixtafrica.com":             "Both",
    "s.hughes@mixtafrica.com":                "Both",
    "t.adebule@mixtafrica.com":               "Both",
    "t.adeniyi@mixtafrica.com":               "Both",
    "t.banjo@mixtafrica.com":                 "Both",
    "t.ibidokun@mixtafrica.com":              "Both",
    "u.ojembe@mixtafrica.com":                "Both",
    "w.salami@mixtafrica.com":                "Both",
    "m.apuh@mixtafrica.com":                  "Both",
    // Lakowe Crossings only
    "b.ajayi@mixtafrica.com":                 "Crossings",
    "o.isabu@mixtafrica.com":                 "Crossings",
    "o.james@mixtafrica.com":                 "Crossings",
    // Lakowe Annexe only
    "o.ogunewu@mixtafrica.com":               "Annexe",
  };

  const REQUIRED_DOMAIN = 'mixtafrica.com';
  const ADMIN_EMAIL     = 'o.olasunkanmi@mixtafrica.com';
  const APPS_SCRIPT_URL = window.APPS_SCRIPT_URL || '';

  // ── STATE ─────────────────────────────────────────────────────────────────
  let _auth        = null;
  let _db          = null;   // Firebase DB reference
  let _ready       = false;
  let _access      = null;   // "Both"|"Crossings"|"Annexe"|null
  let _pendingUser = null;   // user object waiting for Firebase allowlist check

  // ── IDLE TIMEOUT CONFIG ───────────────────────────────────────────────────
  const IDLE_MINUTES        = 10;
  const WARNING_BEFORE_SECS = 30;
  const IDLE_MS             = IDLE_MINUTES * 60 * 1000;
  const WARNING_MS          = IDLE_MS - (WARNING_BEFORE_SECS * 1000);

  let _idleTimer   = null;
  let _warnTimer   = null;
  let _warnEl      = null;
  let _countdownId = null;

  // ── CSS ───────────────────────────────────────────────────────────────────
  (function injectCSS() {
    const s = document.createElement('style');
    s.id = 'auth-gate-style';
    s.textContent = `
      body.auth-locked > *:not(#auth-gate-overlay) {
        display: none !important; visibility: hidden !important;
        pointer-events: none !important;
      }
      body.auth-locked #auth-gate-overlay { display: flex !important; }

      #auth-gate-overlay {
        display: none; position: fixed; inset: 0; z-index: 2147483647;
        background: linear-gradient(135deg, #f0f4f0 0%, #f8f0f0 100%);
        align-items: center; justify-content: center;
        font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      }
      .ag-card {
        background: #fff; border-radius: 20px; padding: 44px 40px 36px;
        width: 100%; max-width: 420px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.10), 0 24px 48px rgba(0,0,0,0.06);
        text-align: center;
      }
      .ag-logo {
        width: 68px; height: 68px; border-radius: 14px; object-fit: contain;
        margin: 0 auto 18px; display: block; background: #f5f5f5;
      }
      .ag-card h1 { font-size: 21px; font-weight: 800; color: #1a1a1a; letter-spacing: -0.03em; margin-bottom: 6px; }
      .ag-card h1 span { color: #D32F2F; }
      .ag-subtitle { font-size: 13px; color: #888; margin-bottom: 30px; line-height: 1.5; }

      .ag-google-btn {
        display: flex; align-items: center; justify-content: center; gap: 12px;
        width: 100%; padding: 13px 20px; background: #fff; color: #3c4043;
        border: 1.5px solid #dadce0; border-radius: 10px;
        font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit;
        box-shadow: 0 1px 3px rgba(0,0,0,0.08); margin-bottom: 12px;
        transition: all 0.18s;
      }
      .ag-google-btn:hover  { background: #f8f9fa; border-color: #bbb; box-shadow: 0 2px 8px rgba(0,0,0,0.12); }
      .ag-google-btn:active { transform: scale(0.99); }
      .ag-google-btn:disabled { opacity: 0.55; cursor: default; transform: none; }

      .ag-hint  { font-size: 11.5px; color: #bbb; margin-bottom: 18px; letter-spacing: 0.01em; }
      .ag-msg   { min-height: 18px; font-size: 12px; font-weight: 600; color: #c62828; padding: 0 4px; line-height: 1.5; }
      .ag-msg.info { color: #555; font-weight: 500; }

      /* ── Access Denied block ── */
      .ag-denied {
        background: #fff5f5; border: 1px solid #ffcdd2; border-radius: 12px;
        padding: 18px 18px 14px; font-size: 13px; color: #b71c1c;
        line-height: 1.6; margin-top: 16px; text-align: left;
      }
      .ag-denied strong { display: block; margin-bottom: 6px; font-size: 14px; font-weight: 800; }
      .ag-denied .ag-denied-email { font-size: 12px; color: #555; margin-bottom: 14px; word-break: break-all; }

      /* Request Access button */
      .ag-request-btn {
        display: flex; align-items: center; justify-content: center; gap: 8px;
        width: 100%; padding: 11px 16px; margin-top: 4px;
        background: #1b5e20; color: #fff;
        border: none; border-radius: 8px;
        font-size: 13px; font-weight: 700; cursor: pointer;
        font-family: inherit; transition: background 0.18s;
      }
      .ag-request-btn:hover    { background: #145214; }
      .ag-request-btn:disabled { opacity: 0.6; cursor: default; }
      .ag-request-btn.sent     { background: #0d47a1; cursor: default; }

      /* Wrong domain block */
      .ag-wrong-domain {
        background: #fff8e1; border: 1px solid #ffe082; border-radius: 12px;
        padding: 14px 16px; font-size: 12.5px; color: #e65100;
        line-height: 1.6; margin-top: 16px; text-align: left;
      }
      .ag-wrong-domain strong { display: block; margin-bottom: 4px; font-size: 13px; }

      /* Spinner */
      .ag-spin {
        display: inline-block; width: 16px; height: 16px;
        border: 2px solid #dadce0; border-top-color: #4285f4;
        border-radius: 50%; animation: agSpin 0.7s linear infinite;
      }
      @keyframes agSpin { to { transform: rotate(360deg); } }

      /* Checking access state */
      .ag-checking {
        display: flex; align-items: center; gap: 10px; justify-content: center;
        font-size: 13px; color: #666; margin-top: 12px; padding: 10px;
      }

      /* Idle warning banner */
      #ag-idle-warning {
        position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
        z-index: 2147483646; background: #1a1a1a; color: #fff;
        border-radius: 12px; padding: 14px 22px; font-family: 'DM Sans', -apple-system, sans-serif;
        font-size: 13px; font-weight: 600; box-shadow: 0 8px 32px rgba(0,0,0,0.28);
        display: flex; align-items: center; gap: 14px;
        white-space: nowrap; animation: agWarnSlide 0.25s cubic-bezier(0.34,1.56,0.64,1);
        max-width: calc(100vw - 40px);
      }
      @keyframes agWarnSlide {
        from { opacity:0; transform: translateX(-50%) translateY(12px); }
        to   { opacity:1; transform: translateX(-50%) translateY(0); }
      }
      #ag-idle-warning .ag-warn-icon  { font-size: 16px; flex-shrink: 0; }
      #ag-idle-warning .ag-warn-text  { flex: 1; }
      #ag-idle-warning .ag-warn-secs  {
        background: rgba(255,255,255,0.15); border-radius: 6px; padding: 2px 8px;
        font-size: 12px; min-width: 36px; text-align: center; font-variant-numeric: tabular-nums;
      }
      #ag-idle-warning .ag-warn-stay  {
        background: #2e7d32; color: #fff; border: none; border-radius: 7px;
        padding: 6px 14px; font-size: 12px; font-weight: 700;
        cursor: pointer; font-family: inherit; flex-shrink: 0; transition: background 0.15s;
      }
      #ag-idle-warning .ag-warn-stay:hover { background: #1b5e20; }

      /* Nav badge */
      .ag-nav-badge {
        display: inline-flex; align-items: center; gap: 6px;
        font-size: 11px; font-weight: 600; color: #fff;
        background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.22);
        border-radius: 100px; padding: 3px 10px 3px 7px; white-space: nowrap;
      }
      .ag-nav-badge::before {
        content: ''; width: 7px; height: 7px; border-radius: 50%;
        background: #4ade80; flex-shrink: 0;
      }
    `;
    document.head.appendChild(s);
  })();

  // ── Lock body immediately (synchronous) ───────────────────────────────────
  document.body.classList.add('auth-locked');

  // ── Overlay HTML ──────────────────────────────────────────────────────────
  function injectOverlay() {
    const GOOGLE_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>`;

    const el = document.createElement('div');
    el.id = 'auth-gate-overlay';
    el.innerHTML = `
      <div class="ag-card">
        <img src="Mixta Africa.jpg" alt="Mixta Africa" class="ag-logo" onerror="this.style.display='none'">
        <h1>Projects <span>Tracker</span></h1>
        <p class="ag-subtitle">Mixta Africa — Live Performance Dashboard</p>
        <button class="ag-google-btn" id="ag-btn" onclick="_authGate.signIn()">
          ${GOOGLE_SVG}
          <span id="ag-btn-label">Sign in with Google</span>
        </button>
        <p class="ag-hint">Use your @mixtafrica.com company email</p>
        <p class="ag-msg" id="ag-msg"></p>
      </div>
    `;
    document.body.insertBefore(el, document.body.firstChild);
  }

  // ── UNLOCK ────────────────────────────────────────────────────────────────
  function unlock(user, access) {
    _access = access;
    document.body.classList.remove('auth-locked');
    const overlay = document.getElementById('auth-gate-overlay');
    if (overlay) overlay.style.display = 'none';
    injectNavBadge(user, access);
    restrictProjects(access);
    startIdleTracking();
    if (typeof window.onAuthGateReady === 'function') {
      window.onAuthGateReady();
      window.onAuthGateReady = null;
    }
    if (typeof window.onAuthGateSignedIn === 'function') {
      window.onAuthGateSignedIn(user, access);
    }
  }

  // ── DENY — show access denied + request access button ────────────────────
  function deny(user, reason) {
    const email = user ? (user.email || '') : (typeof user === 'string' ? user : '');
    if (_auth) _auth.signOut().catch(() => {});
    setBtnReady();
    setMsg('', true);

    const card = document.querySelector('.ag-card');
    if (!card) return;
    const old = document.getElementById('ag-denied-block');
    if (old) old.remove();

    const block = document.createElement('div');
    block.id = 'ag-denied-block';

    if (reason === 'domain') {
      block.className = 'ag-wrong-domain';
      block.innerHTML = `
        <strong>Wrong account</strong>
        <b>${esc(email)}</b> is not a Mixta Africa email.<br>
        Please sign in with your <b>@mixtafrica.com</b> company email.`;
    } else {
      // Authorised domain but not on the allowlist
      block.className = 'ag-denied';
      block.innerHTML = `
        <strong>Access Not Granted</strong>
        <div class="ag-denied-email">${esc(email)}</div>
        Your account is not authorised for this dashboard.
        You can request access from the dashboard administrator.
        <button class="ag-request-btn" id="ag-request-btn" onclick="_authGate.requestAccess('${esc(email)}')">
          ✉ Request Access
        </button>`;
    }
    card.appendChild(block);
  }

  // ── REQUEST ACCESS ────────────────────────────────────────────────────────
  function requestAccess(email) {
    const btn = document.getElementById('ag-request-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending request…'; }

    const now = new Date().toLocaleString('en-NG', { dateStyle:'full', timeStyle:'short' });

    // Write to Firebase so admin panel Access tab shows this request immediately
    if (_db) {
      const key = email.replace(/\./g,'_').replace(/@/g,'_at_');
      _db.ref('access_requests/' + key).set({ email, time: Date.now(), status: 'pending' }).catch(()=>{});
    }

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:560px;padding:24px;background:#f9f9f9;border-radius:8px;">
        <h2 style="color:#1b5e20;margin-bottom:4px;">Dashboard Access Request</h2>
        <p style="color:#555;font-size:13px;margin-bottom:20px;">Mixta Africa Projects Tracker</p>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <tr><td style="padding:8px 12px;background:#fff;border:1px solid #eee;font-weight:700;width:120px;">Requester</td>
              <td style="padding:8px 12px;background:#fff;border:1px solid #eee;">${esc(email)}</td></tr>
          <tr><td style="padding:8px 12px;background:#f5f5f5;border:1px solid #eee;font-weight:700;">Time</td>
              <td style="padding:8px 12px;background:#f5f5f5;border:1px solid #eee;">${esc(now)}</td></tr>
          <tr><td style="padding:8px 12px;background:#fff;border:1px solid #eee;font-weight:700;">Action</td>
              <td style="padding:8px 12px;background:#fff;border:1px solid #eee;">
                Open Projects Tracker → Admin Panel → 🔐 Access tab → Approve this request.
              </td></tr>
        </table>
        <p style="font-size:11px;color:#aaa;margin-top:20px;">Auto-generated by Mixta Africa Projects Tracker</p>
      </div>`;

    // Send via GAS if available, otherwise fall back to mailto
    const gasUrl = APPS_SCRIPT_URL;
    if (gasUrl && gasUrl.length > 10) {
      fetch(gasUrl, {
        method: 'POST',
        body: JSON.stringify({
          action:   'sendEmail',
          token:    window.SCRIPT_TOKEN || 'MixtaMail2026',
          to:       [ADMIN_EMAIL],
          subject:  'Dashboard Access Request — ' + email,
          html:     html,
          reply_to: email,
        }),
      })
      .then(r => r.json())
      .then(res => {
        if (btn) {
          btn.className = 'ag-request-btn sent';
          btn.textContent = res.success
            ? '✓ Request sent! You will be notified when access is granted.'
            : '✉ Sent (check your email for confirmation)';
        }
      })
      .catch(() => _fallbackMailto(email, btn));
    } else {
      _fallbackMailto(email, btn);
    }
  }

  function _fallbackMailto(email, btn) {
    const subject = encodeURIComponent('Dashboard Access Request — ' + email);
    const body    = encodeURIComponent(
      'Hi,\n\nI would like to request access to the Mixta Africa Projects Tracker Dashboard.\n\nEmail: ' + email + '\n\nPlease add me to the approved list.\n\nThank you.'
    );
    window.open('mailto:' + ADMIN_EMAIL + '?subject=' + subject + '&body=' + body);
    if (btn) {
      btn.className = 'ag-request-btn sent';
      btn.textContent = '✓ Email opened — send it to request access.';
    }
  }

  // ── AUTH STATE HANDLER ────────────────────────────────────────────────────
  function onAuthState(user) {
    if (!user) { setBtnReady(); return; }

    const email  = (user.email || '').toLowerCase().trim();
    const domain = email.split('@')[1] || '';

    // Gate 1: must be @mixtafrica.com — hard block, no request access
    if (domain !== REQUIRED_DOMAIN) {
      deny(user, 'domain');
      return;
    }

    // Gate 2: check hardcoded allowlist first (fast, no network)
    if (ALLOWED[email]) {
      unlock(user, ALLOWED[email]);
      return;
    }

    // Gate 3: check Firebase mgmt_users (admin-added users)
    // Show a "Checking access…" state while we wait
    setMsg('Checking access…', true);
    setBtnLoading();

    if (_db) {
      const fbKey = email.replace(/\./g, '_');
      _db.ref('mgmt_users/' + fbKey).once('value')
        .then(snap => {
          const data = snap.val();
          if (data && data.project) {
            // Found in Firebase — grant access
            ALLOWED[email] = data.project; // cache in memory for this session
            unlock(user, data.project);
          } else {
            // Not in Firebase either — deny with request access button
            deny(user, 'notallowed');
          }
        })
        .catch(() => {
          // Firebase read failed — deny conservatively
          deny(user, 'notallowed');
        });
    } else {
      // DB not ready yet — retry once after a short wait
      setTimeout(() => {
        if (_db) {
          const fbKey = email.replace(/\./g, '_');
          _db.ref('mgmt_users/' + fbKey).once('value')
            .then(snap => {
              const data = snap.val();
              if (data && data.project) {
                ALLOWED[email] = data.project;
                unlock(user, data.project);
              } else {
                deny(user, 'notallowed');
              }
            })
            .catch(() => deny(user, 'notallowed'));
        } else {
          deny(user, 'notallowed');
        }
      }, 2000);
    }
  }

  // ── SIGN IN ───────────────────────────────────────────────────────────────
  function signIn() {
    if (!_ready) { setMsg('Loading… please wait.', true); return; }
    setBtnLoading();
    setMsg('Opening Google sign-in…', true);
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account', hd: REQUIRED_DOMAIN });
    _auth.signInWithPopup(provider).catch(err => {
      setBtnReady();
      if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') {
        setMsg('Sign-in cancelled.', true);
      } else {
        setMsg('Error: ' + err.message, false);
      }
    });
  }

  // ── SIGN OUT ──────────────────────────────────────────────────────────────
  function signOut(reason) {
    stopIdleTracking();
    if (_auth) _auth.signOut().catch(() => {});
    _access = null;
    document.body.classList.add('auth-locked');
    const overlay = document.getElementById('auth-gate-overlay');
    if (overlay) overlay.style.display = 'flex';
    const denied = document.getElementById('ag-denied-block');
    if (denied) denied.remove();
    setBtnReady();
    if (reason === 'idle') {
      setMsg('You were signed out after ' + IDLE_MINUTES + ' minutes of inactivity.', true);
    } else {
      setMsg('', true);
    }
    const badge = document.getElementById('ag-nav-badge');
    if (badge) badge.remove();
  }

  // ── FIREBASE INIT ─────────────────────────────────────────────────────────
  const FIREBASE_CFG = {
    apiKey:            "AIzaSyC7SI9u4iRLVl3BMSX3WTDt1QCRnwwA5lk",
    authDomain:        "mixta-projects-dashboard.firebaseapp.com",
    databaseURL:       "https://mixta-projects-dashboard-default-rtdb.firebaseio.com",
    projectId:         "mixta-projects-dashboard",
    storageBucket:     "mixta-projects-dashboard.firebasestorage.app",
    messagingSenderId: "386861034797",
    appId:             "1:386861034797:web:04f7cbcc6ee2154c52b7a4"
  };

  function initAuth(attempts) {
    if (typeof firebase === 'undefined') {
      if (attempts < 50) setTimeout(() => initAuth(attempts + 1), 200);
      else setMsg('Firebase SDK failed to load. Check your internet connection and refresh.', false);
      return;
    }
    if (!firebase.apps || firebase.apps.length === 0) {
      try { firebase.initializeApp(FIREBASE_CFG); }
      catch (e) { if (!e.message || !e.message.includes('already')) { setMsg('Firebase init failed: ' + e.message, false); return; } }
    }
    _auth = firebase.auth();
    _db   = firebase.database();
    _ready = true;
    _auth.onAuthStateChanged(onAuthState);
  }

  // ── UI HELPERS ────────────────────────────────────────────────────────────
  function setMsg(text, isInfo) {
    const el = document.getElementById('ag-msg');
    if (!el) return;
    el.textContent = text;
    el.className = 'ag-msg' + (isInfo ? ' info' : '');
  }
  function setBtnLoading() {
    const btn = document.getElementById('ag-btn');
    const lbl = document.getElementById('ag-btn-label');
    if (btn) btn.disabled = true;
    if (lbl) lbl.innerHTML = '<span class="ag-spin"></span>';
  }
  function setBtnReady() {
    const btn = document.getElementById('ag-btn');
    const lbl = document.getElementById('ag-btn-label');
    if (btn) btn.disabled = false;
    if (lbl) lbl.textContent = 'Sign in with Google';
  }
  function injectNavBadge(user, access) {
    const old = document.getElementById('ag-nav-badge');
    if (old) old.remove();
    ['auth-user-badge','auth-login-btn','auth-logout-btn'].forEach(id => {
      const el = document.getElementById(id); if (el) el.style.display = 'none';
    });
    const name  = user.displayName ? user.displayName.split(' ')[0] : (user.email || '').split('@')[0];
    const label = access === 'Both' ? 'All Projects' : 'Lakowe ' + access;
    const wrap  = document.createElement('div');
    wrap.id = 'ag-nav-badge';
    wrap.style.cssText = 'display:flex;align-items:center;gap:8px;';
    wrap.innerHTML = `
      <span class="ag-nav-badge" title="${esc(user.email)}">${esc(name)} · ${esc(label)}</span>
      <button onclick="_authGate.signOut()"
        style="font-size:11px;font-weight:700;padding:5px 10px;border-radius:6px;
               border:1px solid rgba(255,255,255,0.2);background:rgba(211,47,47,0.15);
               color:#fff;cursor:pointer;font-family:inherit;transition:background 0.15s;"
        onmouseover="this.style.background='rgba(211,47,47,0.35)'"
        onmouseout="this.style.background='rgba(211,47,47,0.15)'">Sign out</button>`;
    const navRight = document.querySelector('.nav-right');
    if (navRight) navRight.insertBefore(wrap, navRight.firstChild);
  }
  function restrictProjects(access) {
    if (access === 'Crossings') {
      const el = document.querySelector('.landing-btn.btn-annex');
      const nb = document.getElementById('btn-nav-annex');
      if (el) el.style.display = 'none'; if (nb) nb.style.display = 'none';
    } else if (access === 'Annexe') {
      const el = document.querySelector('.landing-btn.btn-cx');
      const nb = document.getElementById('btn-nav-cx');
      if (el) el.style.display = 'none'; if (nb) nb.style.display = 'none';
    }
  }
  function esc(s) {
    return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── IDLE TIMEOUT ─────────────────────────────────────────────────────────
  const ACTIVITY_EVENTS = ['mousemove','mousedown','keydown','touchstart','touchmove','click','scroll','wheel'];
  function resetIdleTimer() {
    if (!_access) return;
    clearTimeout(_idleTimer); clearTimeout(_warnTimer); clearInterval(_countdownId);
    hideIdleWarning();
    _warnTimer = setTimeout(showIdleWarning, WARNING_MS);
    _idleTimer = setTimeout(() => { hideIdleWarning(); signOut('idle'); }, IDLE_MS);
  }
  function startIdleTracking() {
    resetIdleTimer();
    ACTIVITY_EVENTS.forEach(ev => document.addEventListener(ev, resetIdleTimer, { passive: true }));
  }
  function stopIdleTracking() {
    clearTimeout(_idleTimer); clearTimeout(_warnTimer); clearInterval(_countdownId);
    hideIdleWarning();
    ACTIVITY_EVENTS.forEach(ev => document.removeEventListener(ev, resetIdleTimer));
  }
  function showIdleWarning() {
    if (_warnEl) return;
    let secsLeft = WARNING_BEFORE_SECS;
    _warnEl = document.createElement('div');
    _warnEl.id = 'ag-idle-warning';
    _warnEl.innerHTML = `
      <span class="ag-warn-icon">⏱</span>
      <span class="ag-warn-text">You'll be signed out due to inactivity in</span>
      <span class="ag-warn-secs" id="ag-warn-secs">${secsLeft}s</span>
      <button class="ag-warn-stay" onclick="_authGate.staySignedIn()">Stay signed in</button>`;
    document.body.appendChild(_warnEl);
    _countdownId = setInterval(() => {
      secsLeft--;
      const el = document.getElementById('ag-warn-secs');
      if (el) el.textContent = secsLeft + 's';
      if (secsLeft <= 0) clearInterval(_countdownId);
    }, 1000);
  }
  function hideIdleWarning() {
    clearInterval(_countdownId);
    if (_warnEl) { _warnEl.remove(); _warnEl = null; }
  }
  function staySignedIn() { resetIdleTimer(); }

  // ── RUNTIME ALLOWLIST EXTENSION (called by admin panel) ──────────────────
  // Writes to Firebase — works across ALL browsers immediately.
  window._extendAllowlist = function(email, access) {
    const key = (email || '').toLowerCase().trim().replace(/\./g, '_');
    if (!key) return;
    // Patch in-memory for current session
    ALLOWED[email.toLowerCase().trim()] = access || 'Both';
    // Firebase is the source of truth — already written by mgmtAddUser()
    // This function is kept for backward compatibility.
  };
  window._removeFromAllowlist = function(email) {
    const key = (email || '').toLowerCase().trim();
    if (!key) return;
    delete ALLOWED[key];
    // Firebase deletion already handled by mgmtDeleteUser()
  };

  // ── PUBLIC API ────────────────────────────────────────────────────────────
  window._authGate = { signIn, signOut, getAccess: () => _access, staySignedIn, requestAccess };
  window.authGate  = window._authGate;
  window.staySignedIn = staySignedIn;

  // ── BOOT ──────────────────────────────────────────────────────────────────
  function boot() { injectOverlay(); initAuth(0); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
