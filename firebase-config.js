// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBWuLMPKGS91HSOzmQALinQl3w5FwkIdIs",
  authDomain: "letscheckchoc.firebaseapp.com",
  projectId: "letscheckchoc",
  storageBucket: "letscheckchoc.firebasestorage.app",
  messagingSenderId: "801516961544",
  appId: "1:801516961544:web:c28584674e5be4643e36bd",
  measurementId: "G-JFYS74CC6D"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Set up global service references used by app.js
var fbAuth      = firebase.auth();
var fbFirestore = firebase.firestore();
var fbStorage   = firebase.storage();

// Track authenticated user ID globally
fbAuth.onAuthStateChanged(function(user) {
  window._fbUserId = user ? user.uid : null;
});