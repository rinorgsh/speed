import { create } from 'zustand';
import * as db from '../db/database';
import { nl } from './nl';
import { en } from './en';

/**
 * Multilingue FR / NL / EN de l'application.
 *
 * La CLÉ est le texte français : `t('Choisir un serveur')`. Il n'y a donc aucun
 * dictionnaire français à maintenir, aucune clé ne peut manquer en français, et
 * un écran pas encore traduit reste parfaitement lisible.
 *
 * Choix volontaire : la langue NE vient PAS des réglages du téléphone. On lit
 * la langue de l'établissement (fournie par le bootstrap) et on autorise un
 * choix par appareil. Deux raisons : la langue de travail est une décision de
 * l'établissement, et cela évite `expo-localization` — un module natif qui
 * imposerait un rebuild EAS là où tout le reste passe en OTA.
 */

export type Locale = 'fr' | 'nl' | 'en';

export const LOCALES: { value: Locale; label: string }[] = [
    { value: 'fr', label: 'Français' },
    { value: 'nl', label: 'Nederlands' },
    { value: 'en', label: 'English' },
];

const DICTIONARIES: Record<Locale, Record<string, string>> = {
    fr: {}, // le français est la clé elle-même
    nl,
    en,
};

const PREF_KEY = 'app_locale';

export function isLocale(value: unknown): value is Locale {
    return value === 'fr' || value === 'nl' || value === 'en';
}

interface LocaleState {
    locale: Locale;
    /** true si l'appareil a un choix explicite (sinon on suit l'établissement). */
    overridden: boolean;
    load: () => Promise<void>;
    /** Langue de l'établissement, appliquée tant que l'appareil n'a rien choisi. */
    applyEstablishment: (locale: string | null | undefined) => void;
    setLocale: (locale: Locale) => Promise<void>;
    resetToEstablishment: () => Promise<void>;
}

export const useLocale = create<LocaleState>((set, get) => ({
    locale: 'fr',
    overridden: false,

    load: async () => {
        const saved = await db.getPref(PREF_KEY);
        if (isLocale(saved)) set({ locale: saved, overridden: true });
    },

    applyEstablishment: (locale) => {
        if (get().overridden) return; // un choix explicite prime toujours
        if (isLocale(locale)) set({ locale });
    },

    setLocale: async (locale) => {
        set({ locale, overridden: true });
        await db.setPref(PREF_KEY, locale);
    },

    resetToEstablishment: async () => {
        set({ overridden: false });
        await db.setPref(PREF_KEY, '');
    },
}));

/**
 * Traduit une clé (= le texte français). Interpolation avec `:nom` :
 *   t('Reste :amount à régler', { amount: '12,50 €' })
 */
export function t(key: string, replacements?: Record<string, string | number>): string {
    const dictionary = DICTIONARIES[useLocale.getState().locale] ?? {};
    let line = dictionary[key] ?? key;

    if (replacements) {
        for (const [name, value] of Object.entries(replacements)) {
            line = line.split(`:${name}`).join(String(value));
        }
    }

    return line;
}

/**
 * Traduit dans une langue IMPOSÉE, indépendamment de celle de l'appareil.
 *
 * Sert au ticket client : il doit sortir dans la langue de la CLIENTÈLE
 * (réglage `receipt_locale`), pas dans celle du serveur qui encaisse. Un
 * serveur peut travailler en néerlandais et rendre un ticket en français.
 */
export function tIn(locale: string | null | undefined, key: string): string {
    const code = isLocale(locale) ? locale : 'fr';

    return DICTIONARIES[code]?.[key] ?? key;
}

/**
 * Version « hook » : à utiliser dans un composant pour qu'il se redessine
 * automatiquement au changement de langue.
 */
export function useT(): (key: string, replacements?: Record<string, string | number>) => string {
    const locale = useLocale((s) => s.locale);

    return (key, replacements) => {
        const dictionary = DICTIONARIES[locale] ?? {};
        let line = dictionary[key] ?? key;
        if (replacements) {
            for (const [name, value] of Object.entries(replacements)) {
                line = line.split(`:${name}`).join(String(value));
            }
        }

        return line;
    };
}
