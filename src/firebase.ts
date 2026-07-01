import { initializeApp } from "firebase/app";
import { initializeFirestore, getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyAkdQQja6B6rU1VMJkb9bj7ZHOcOZXT_Pk",
  authDomain: "gen-lang-client-0720002890.firebaseapp.com",
  projectId: "gen-lang-client-0720002890",
  storageBucket: "gen-lang-client-0720002890.firebasestorage.app",
  messagingSenderId: "246362160205",
  appId: "1:246362160205:web:597374f1d0a5aeef87f004"
};

// Initialize Firebase with Custom Database ID
const app = initializeApp(firebaseConfig);
export const db = initializeFirestore(app, {}, "ai-studio-1a43725f-fa38-4280-a2a5-3d39ba4eb2ab");
export const auth = getAuth(app);
