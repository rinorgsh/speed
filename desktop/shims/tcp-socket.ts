/**
 * Substitut de `react-native-tcp-socket` pour le bureau.
 *
 * Branché à la place du module natif au moment du bundle (voir build.mjs) :
 * `src/printer/printer.ts` n'est PAS modifié — il continue d'appeler
 * `TcpSocket.createConnection(...)` sans savoir sur quoi il tourne.
 *
 * L'interface n'a pas le droit d'ouvrir une socket elle-même : elle transmet le
 * flux au processus Node, qui le relaie sur le port 9100. On reproduit donc ici
 * la forme de l'API attendue (connexion → write → callback → destroy) au-dessus
 * d'un simple aller-retour.
 */

type Listener = (...args: any[]) => void;

interface Options {
    host: string;
    port: number;
}

declare global {
    interface Window {
        speedDesktop: {
            printerSend: (host: string, port: number, base64: string) => Promise<{ ok: boolean; error?: string }>;
            [key: string]: any;
        };
    }
}

function toBase64(data: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < data.length; i++) binary += String.fromCharCode(data[i]);
    return btoa(binary);
}

class DesktopSocket {
    private listeners: Record<string, Listener[]> = {};
    private timeoutId: ReturnType<typeof setTimeout> | null = null;
    private destroyed = false;

    constructor(private options: Options, onConnect?: () => void) {
        // La connexion réelle n'a lieu qu'à l'écriture : on prévient l'appelant
        // tout de suite pour qu'il enchaîne sur `write`, comme le ferait le
        // module natif.
        if (onConnect) setTimeout(() => { if (!this.destroyed) onConnect(); }, 0);
    }

    on(event: string, listener: Listener): this {
        (this.listeners[event] ??= []).push(listener);
        return this;
    }

    private emit(event: string, ...args: any[]): void {
        for (const listener of this.listeners[event] ?? []) listener(...args);
    }

    setTimeout(ms: number, onTimeout: () => void): this {
        this.timeoutId = setTimeout(() => { if (!this.destroyed) onTimeout(); }, ms);
        return this;
    }

    write(data: Uint8Array, _encoding?: unknown, callback?: () => void): void {
        void window.speedDesktop
            .printerSend(this.options.host, this.options.port, toBase64(data))
            .then((result) => {
                if (this.destroyed) return;
                if (result.ok) callback?.();
                else this.emit('error', new Error(result.error ?? 'Impression impossible'));
            })
            .catch((e: any) => {
                if (!this.destroyed) this.emit('error', new Error(e?.message ?? String(e)));
            });
    }

    destroy(): void {
        this.destroyed = true;
        if (this.timeoutId) clearTimeout(this.timeoutId);
        this.listeners = {};
    }
}

export default {
    createConnection(options: Options, onConnect?: () => void): DesktopSocket {
        return new DesktopSocket(options, onConnect);
    },
};
