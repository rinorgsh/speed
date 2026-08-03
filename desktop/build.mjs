/**
 * Construction du bundle de l'interface bureau.
 *
 * Principe : `src/` n'est JAMAIS modifié. Les quatre modules natifs du mobile
 * sont remplacés ici, au moment du bundle, par les substituts de `shims/`.
 * L'application mobile en production n'est donc pas exposée au moindre risque —
 * son build ne connaît même pas l'existence de ce fichier.
 */
import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const shim = (file) => path.join(here, 'shims', file);

/**
 * Résolution des variantes de plateforme, comme le fait Metro côté mobile.
 *
 * Les bibliothèques de l'écosystème React Native livrent leurs implémentations
 * web à côté des natives : `SafeAreaView.js` et `SafeAreaView.web.js`. Metro
 * choisit la bonne selon la cible ; esbuild, lui, ne connaît pas cette
 * convention. Sans ce greffon, le bundle embarque les fichiers natifs, qui
 * importent des modules internes de React Native inexistants sur le web.
 */
const platformExtensions = {
    name: 'platform-extensions',
    setup(build) {
        build.onResolve({ filter: /^\.{1,2}\// }, (args) => {
            const base = path.resolve(args.resolveDir, args.path);

            // « ./Truc » -> « ./Truc.web.tsx » et variantes.
            for (const ext of ['.web.tsx', '.web.ts', '.web.jsx', '.web.js']) {
                if (fs.existsSync(base + ext)) return { path: base + ext };
            }

            // « ./Truc.js » -> « ./Truc.web.js ».
            const known = ['.js', '.jsx', '.ts', '.tsx'];
            const ext = known.find((e) => base.endsWith(e));
            if (ext) {
                const web = base.slice(0, -ext.length) + '.web' + ext;
                if (fs.existsSync(web)) return { path: web };
            }

            return null; // résolution normale
        });
    },
};

const watch = process.argv.includes('--watch');

const options = {
    entryPoints: [path.join(here, 'renderer/app.tsx')],
    outfile: path.join(here, 'renderer/bundle.js'),
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'chrome120',
    jsx: 'automatic',
    minify: !watch,
    sourcemap: watch ? 'inline' : false,
    logLevel: 'info',
    plugins: [platformExtensions],
    loader: {
        '.png': 'dataurl',
        '.jpg': 'dataurl',
        '.ttf': 'dataurl',
    },
    // Les écrans testent __DEV__ ; react-native-web lit NODE_ENV.
    define: {
        __DEV__: String(watch),
        'process.env.NODE_ENV': watch ? '"development"' : '"production"',
        global: 'globalThis',
    },
    alias: {
        // Le cœur : les primitives d'interface passent par react-native-web.
        'react-native': 'react-native-web',
        // Les quatre modules natifs, remplacés par leurs équivalents bureau.
        'react-native-tcp-socket': shim('tcp-socket.ts'),
        'expo-sqlite': shim('sqlite.ts'),
        'expo-secure-store': shim('secure-store.ts'),
        'expo-updates': shim('updates.ts'),
        'expo-status-bar': shim('status-bar.tsx'),
        // Même jeu d'icônes, rendu en DOM au lieu de SVG natif.
        'lucide-react-native': shim('icons.ts'),
    },
};

if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    console.log('Surveillance du bundle active.');
} else {
    await esbuild.build(options);
}
