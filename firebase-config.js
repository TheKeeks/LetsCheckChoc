// Initialize Firebase
var firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_AUTH_DOMAIN",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_STORAGE_BUCKET",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Reference Firebase services
window._fbUserId = firebase.auth().currentUser ? firebase.auth().currentUser.uid : null;
var fbAuth = firebase.auth();
var fbFirestore = firebase.firestore();
var fbStorage = firebase.storage();

// You can use fbAuth, fbFirestore, fbStorage in your application