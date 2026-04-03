// scripts/add-userId.ts
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, updateDoc, writeBatch } from 'firebase/firestore';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyC1jW_Nk7Yteb4ieVnRfVtnEYWLhfmaFSY",
  authDomain: "minirent-97965.firebaseapp.com",
  projectId: "minirent-97965",
  storageBucket: "minirent-97965.firebasestorage.app",
  messagingSenderId: "61756153883",
  appId: "1:61756153883:web:3c47a523673b85aa8858be",
  measurementId: "G-20FQ3MZGYN"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

async function addUserIdToExistingDocs() {
  try {
    // Replace with your actual email and password
    console.log('Signing in...');
    const userCredential = await signInWithEmailAndPassword(
      auth, 
      "your-email@example.com",  // CHANGE THIS
      "your-password"            // CHANGE THIS
    );
    const userId = userCredential.user.uid;
    console.log(`✅ Signed in as: ${userId}`);

    const collections = ['properties', 'tenants', 'payments', 'unmatchedPayments'];
    
    for (const collectionName of collections) {
      console.log(`\n📁 Processing ${collectionName}...`);
      const snapshot = await getDocs(collection(db, collectionName));
      
      if (snapshot.empty) {
        console.log(`⚠️ No documents found in ${collectionName}`);
        continue;
      }
      
      console.log(`📄 Found ${snapshot.size} documents`);
      
      let batch = writeBatch(db);
      let count = 0;
      
      for (const docSnapshot of snapshot.docs) {
        const docRef = doc(db, collectionName, docSnapshot.id);
        batch.update(docRef, { userId: userId });
        count++;
        
        if (count % 500 === 0) {
          await batch.commit();
          console.log(`✅ Committed ${count} updates for ${collectionName}`);
          batch = writeBatch(db);
        }
      }
      
      if (count % 500 !== 0) {
        await batch.commit();
      }
      
      console.log(`✅ Updated ${count} documents in ${collectionName}`);
    }
    
    console.log('\n🎉 Migration completed successfully!');
    console.log(`All documents now have userId: ${userId}`);
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
  }
}

addUserIdToExistingDocs();