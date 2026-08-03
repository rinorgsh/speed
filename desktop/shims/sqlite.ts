/**
 * Substitut d'`expo-sqlite` pour le bureau.
 *
 * Reproduit la surface exacte utilisée par `src/db/database.ts` — qui n'est pas
 * modifié : openDatabaseAsync, execAsync, runAsync, getAllAsync, getFirstAsync
 * et withExclusiveTransactionAsync. Les requêtes partent au processus Node, où
 * better-sqlite3 les exécute (voir lib/db.js).
 */

type Params = any[];

interface Bridge {
    open: (name: string) => Promise<void>;
    exec: (txId: number | null, sql: string) => Promise<void>;
    run: (txId: number | null, sql: string, params: Params) => Promise<{ changes: number; lastInsertRowId: number }>;
    all: (txId: number | null, sql: string, params: Params) => Promise<any[]>;
    first: (txId: number | null, sql: string, params: Params) => Promise<any>;
    begin: () => Promise<number>;
    end: (txId: number, commit: boolean) => Promise<void>;
}

const bridge = (): Bridge => (window as any).speedDesktop.db;

/** Poignée de base de données. `txId` non nul = requêtes de la transaction. */
class Handle {
    constructor(private txId: number | null = null) {}

    execAsync(sql: string): Promise<void> {
        return bridge().exec(this.txId, sql);
    }

    runAsync(sql: string, ...params: Params) {
        return bridge().run(this.txId, sql, params);
    }

    getAllAsync<T = any>(sql: string, ...params: Params): Promise<T[]> {
        return bridge().all(this.txId, sql, params) as Promise<T[]>;
    }

    getFirstAsync<T = any>(sql: string, ...params: Params): Promise<T | null> {
        return bridge().first(this.txId, sql, params) as Promise<T | null>;
    }

    /**
     * Transaction exclusive. Toute requête émise ailleurs pendant ce bloc est
     * mise en attente côté Node — c'est la garantie que le mobile obtient du
     * moteur natif, et sans laquelle deux synchros simultanées peuvent laisser
     * le cache vide.
     */
    async withExclusiveTransactionAsync(task: (txn: Handle) => Promise<void>): Promise<void> {
        const txId = await bridge().begin();
        try {
            await task(new Handle(txId));
            await bridge().end(txId, true);
        } catch (e) {
            await bridge().end(txId, false);
            throw e;
        }
    }
}

export type SQLiteDatabase = Handle;

export async function openDatabaseAsync(name: string): Promise<Handle> {
    await bridge().open(name);
    return new Handle();
}

export default { openDatabaseAsync };
