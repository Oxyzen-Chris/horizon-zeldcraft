/**
 * Firebase client — configuration Realtime Database pour le chat multi-joueurs.
 *
 * Variables d'environnement requises (dans web/.env.local et Vercel) :
 *   NEXT_PUBLIC_FIREBASE_API_KEY
 *   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
 *   NEXT_PUBLIC_FIREBASE_DATABASE_URL
 *   NEXT_PUBLIC_FIREBASE_PROJECT_ID
 *   NEXT_PUBLIC_FIREBASE_APP_ID
 *
 * Si NEXT_PUBLIC_FIREBASE_API_KEY n'est pas défini, le module retourne null et
 * l'UI de chat affiche un message explicatif au lieu de crasher.
 */
import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { getDatabase, Database } from 'firebase/database';

let app: FirebaseApp | null = null;
let db: Database | null = null;

export function isFirebaseConfigured(): boolean {
  return !!process.env.NEXT_PUBLIC_FIREBASE_API_KEY
      && !!process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL;
}

export function getFirebaseDb(): Database | null {
  if (!isFirebaseConfigured()) return null;
  if (db) return db;
  if (getApps().length === 0) {
    app = initializeApp({
      apiKey:      process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
      authDomain:  process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL!,
      projectId:   process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      appId:       process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    });
  } else {
    app = getApps()[0];
  }
  db = getDatabase(app);
  return db;
}
