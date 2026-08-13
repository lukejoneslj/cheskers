/** Lazy Firebase bootstrap.
 *
 * The whole SDK is dynamically imported so that a player who never opens the
 * lobby never downloads it. Config comes from Vite env vars; a Firebase web
 * config is not a secret (it identifies the project, it does not authorise
 * anything — that is what the database rules are for), but keeping it in env
 * means the same build can point at a staging project.
 */

import type { FirebaseApp } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import type { Database } from 'firebase/database';

export interface FirebaseBundle {
  app: FirebaseApp;
  auth: Auth;
  db: Database;
  uid: string;
}

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

/** True when the build has enough config to attempt a connection. */
export function isConfigured(): boolean {
  return Boolean(config.apiKey && config.databaseURL && config.projectId);
}

let pending: Promise<FirebaseBundle> | null = null;

/** The uid of whoever is signed in *right now*.
 *
 * `connect()` caches the uid it saw when the connection was first opened, but
 * signing in to an existing account replaces the anonymous user and changes
 * the uid. Anything that writes to the database has to use this rather than
 * the cached value, or its writes will be rejected as somebody else's.
 */
export async function currentUid(): Promise<string> {
  const bundle = await connect();
  return bundle.auth.currentUser?.uid ?? bundle.uid;
}

export function connect(): Promise<FirebaseBundle> {
  if (!isConfigured()) {
    return Promise.reject(new Error('Firebase is not configured'));
  }
  pending ??= (async () => {
    const [{ initializeApp }, authMod, dbMod] = await Promise.all([
      import('firebase/app'),
      import('firebase/auth'),
      import('firebase/database'),
    ]);

    const app = initializeApp({
      apiKey: config.apiKey!,
      authDomain: config.authDomain ?? `${config.projectId!}.firebaseapp.com`,
      databaseURL: config.databaseURL!,
      projectId: config.projectId!,
      ...(config.appId ? { appId: config.appId } : {}),
    });

    const auth = authMod.getAuth(app);
    // Persisting the anonymous session is what lets a player refresh, or come
    // back after a dropped connection, and still be recognised as the same
    // seat rather than being treated as a spectator.
    await authMod.setPersistence(auth, authMod.browserLocalPersistence);
    const credential = auth.currentUser
      ? { user: auth.currentUser }
      : await authMod.signInAnonymously(auth);

    return {
      app,
      auth,
      db: dbMod.getDatabase(app),
      uid: credential.user.uid,
    };
  })();
  return pending;
}
