// ════════════════════════════════════════════════
// firebase-config.js
// Firebase initialization and anonymous auth
//
// SETUP: Replace the placeholder values below with
// your actual Firebase project configuration from:
//   Firebase Console → Project Settings → Your apps
// ════════════════════════════════════════════════

const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId:             "YOUR_APP_ID"
};

// Initialize Firebase (compat SDK)
firebase.initializeApp(firebaseConfig);

const fbAuth      = firebase.auth();
const fbFirestore = firebase.firestore();
const fbStorage   = firebase.storage();

// Silent anonymous sign-in — no login screen needed
window._fbUserId = null;
fbAuth.signInAnonymously().catch(err => {
  console.warn('Firebase anonymous sign-in failed:', err.message);
  // Surface failure in upload form if already in the DOM
  const statusEl = document.getElementById('fu-status');
  if (statusEl) {
    statusEl.textContent = 'Firebase authentication unavailable — photo upload is disabled.';
    statusEl.className = 'fu-status fu-status-error';
  }
  const submitBtn = document.getElementById('fu-submit-btn');
  if (submitBtn) submitBtn.disabled = true;
});

fbAuth.onAuthStateChanged(user => {
  window._fbUserId = user ? user.uid : null;
});
