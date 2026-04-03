import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, collection, doc } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';

// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyC1jW_Nk7Yteb4ieVnRfVtnEYWLhfmaFSY",
  authDomain: "minirent-97965.firebaseapp.com",
  projectId: "minirent-97965",
  storageBucket: "minirent-97965.firebasestorage.app",
  messagingSenderId: "61756153883",
  appId: "1:61756153883:web:3c47a523673b85aa8858be",
  measurementId: "G-20FQ3MZGYN"
};

// Initialize Firebase only if it hasn't been initialized already
const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();

// Initialize services
export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);

// Collection references
export const tenantsCollection = collection(db, 'tenants');
export const propertiesCollection = collection(db, 'properties');
export const paymentsCollection = collection(db, 'payments');
export const complaintsCollection = collection(db, 'complaints');
export const unmatchedPaymentsCollection = collection(db, 'unmatchedPayments');

// Helper function to get tenant document by phone
export const getTenantByPhone = (phone: string) => {
  return doc(db, 'tenants', phone);
};

export default app;