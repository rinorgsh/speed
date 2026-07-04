import { create } from 'zustand';
import { configureApi, registerDevice } from '../api/client';
import * as db from '../db/database';
import { clearCredentials, clearProfile, loadCredentials, loadProfile, saveCredentials, saveProfile } from './secure';
import type { PosSession, User } from '../types';

/**
 * État d'authentification de l'appareil et de la session de travail.
 * - enrolled : l'appareil possède un token (sinon écran d'enrôlement).
 * - server : serveur identifié par PIN pour la session de travail courante.
 * - session : session de caisse ouverte (null = aucune vente possible).
 */
interface AuthState {
    initialized: boolean;
    enrolled: boolean;
    apiUrl: string | null;
    profileId: number | null;
    profileName: string | null;
    server: User | null;
    session: PosSession | null;

    init: () => Promise<void>;
    enroll: (apiUrl: string, deviceName: string, enrollmentSecret: string) => Promise<void>;
    resetDevice: () => Promise<void>;
    setProfile: (id: number, name: string) => Promise<void>;
    clearActiveProfile: () => Promise<void>;
    setServer: (user: User | null) => void;
    refreshSession: () => Promise<void>;
    setSession: (session: PosSession | null) => void;
}

export const useAuth = create<AuthState>((set, get) => ({
    initialized: false,
    enrolled: false,
    apiUrl: null,
    profileId: null,
    profileName: null,
    server: null,
    session: null,

    init: async () => {
        await db.openDb();
        const creds = await loadCredentials();
        if (creds) {
            configureApi(creds.apiUrl, creds.token);
            const profile = await loadProfile();
            const session = await db.getCurrentSession();
            set({
                enrolled: true,
                apiUrl: creds.apiUrl,
                profileId: profile?.id ?? null,
                profileName: profile?.name ?? null,
                session,
                initialized: true,
            });
        } else {
            set({ enrolled: false, initialized: true });
        }
    },

    enroll: async (apiUrl, deviceName, enrollmentSecret) => {
        const { token } = await registerDevice(apiUrl, deviceName, enrollmentSecret);
        await saveCredentials(token, apiUrl, deviceName);
        configureApi(apiUrl, token);
        set({ enrolled: true, apiUrl });
    },

    // Efface l'enrôlement (token + URL + profil) -> retour à l'écran d'enrôlement.
    resetDevice: async () => {
        await clearCredentials();
        set({ enrolled: false, apiUrl: null, profileId: null, profileName: null, server: null, session: null });
    },

    // Choix d'un profil (Restaurant / Event) -> mémorisé et actif.
    setProfile: async (id, name) => {
        await saveProfile(id, name);
        set({ profileId: id, profileName: name });
    },

    // Retour au choix de profil (ne touche pas à l'enrôlement). On efface aussi la
    // session en mémoire : chaque profil a la sienne (rechargée au choix du profil).
    clearActiveProfile: async () => {
        await clearProfile();
        set({ profileId: null, profileName: null, server: null, session: null });
    },

    setServer: (user) => set({ server: user }),

    refreshSession: async () => {
        const session = await db.getCurrentSession();
        set({ session });
    },

    setSession: (session) => set({ session }),
}));
