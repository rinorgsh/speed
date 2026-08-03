/**
 * Point d'entrée de l'interface bureau.
 *
 * Il monte le MÊME composant `App` que le mobile — pas une variante, pas une
 * copie. Tout ce qui suit (écrans, panier, TVA, impression, synchro) vient de
 * `src/`, et les quatre modules natifs sont remplacés au moment du bundle
 * (voir build.mjs).
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppRegistry } from 'react-native';
import App from '../../App';

AppRegistry.registerComponent('Speed', () => App);

const container = document.getElementById('root')!;

// react-native-web sait s'attacher lui-même, mais on passe par createRoot pour
// rester sur l'API React 19 et garder la main sur le conteneur.
createRoot(container).render(React.createElement(App));
