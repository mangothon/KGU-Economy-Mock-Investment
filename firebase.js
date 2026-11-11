import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getFirestore, doc, getDoc, getDocs, setDoc, updateDoc, onSnapshot, collection, writeBatch
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from './config.js';

export const configured = !String(firebaseConfig.apiKey || '').startsWith('여기');
export const app = configured ? initializeApp(firebaseConfig) : null;
export const db = configured ? getFirestore(app) : null;
export { doc, getDoc, getDocs, setDoc, updateDoc, onSnapshot, collection, writeBatch };
