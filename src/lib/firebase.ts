import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult } from 'firebase/auth';
import { getFirestore, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Create Google Auth Provider with necessary Google Drive scopes
export function getGoogleAuthProvider() {
  const provider = new GoogleAuthProvider();
  // Request metadata read-only and files read-only permissions for Google Drive
  provider.addScope('https://www.googleapis.com/auth/drive.readonly');
  provider.addScope('https://www.googleapis.com/auth/drive.metadata.readonly');
  provider.addScope('https://www.googleapis.com/auth/userinfo.profile');
  provider.addScope('https://www.googleapis.com/auth/userinfo.email');
  
  // Suggest offline access to try to retrieve a refresh token if possible
  provider.setCustomParameters({
    access_type: 'offline',
    prompt: 'consent'
  });
  
  return provider;
}

// Save user profile metadata to Firestore reels_users collection
export async function saveUserProfileToFirestore(uid: string, profile: { email: string; name: string; picture?: string }) {
  try {
    const userRef = doc(db, 'reels_users', uid);
    await setDoc(userRef, {
      uid,
      email: profile.email,
      name: profile.name,
      picture: profile.picture || '',
      updatedAt: serverTimestamp()
    }, { merge: true });
    console.log('Saved user profile to Firestore database successfully.');
  } catch (err) {
    console.error('Failed to save user profile to Firestore:', err);
  }
}
