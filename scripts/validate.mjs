#!/usr/bin/env node
/**
 * Contrôles de publication du userscript.
 *
 * Un userscript n'a ni build ni tests unitaires : ce qui casse en pratique, c'est
 * l'en-tête ==UserScript== (une URL de mise à jour erronée bloque silencieusement
 * tout le parc installé) et la dérive entre @version et le CHANGELOG. C'est donc
 * ce que l'on vérifie.
 *
 *     node scripts/validate.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const racine = join(dirname(fileURLToPath(import.meta.url)), '..');
const FICHIER = 'vsa-cra-helper.user.js';
const DEPOT = 'erim32/addon-vsactivity-cra';
const BRANCHE = 'main';

const erreurs = [];
const echec = (m) => erreurs.push(m);

const source = readFileSync(join(racine, FICHIER), 'utf8');

// ─── En-tête ==UserScript== ───────────────────────────────────────────────────

const bloc = source.match(/\/\/ ==UserScript==\r?\n([\s\S]*?)\/\/ ==\/UserScript==/);
if (!bloc) {
    echec(`${FICHIER} : bloc ==UserScript== introuvable ou mal fermé.`);
} else {
    if (!source.startsWith('// ==UserScript==')) {
        echec(`${FICHIER} : le bloc de métadonnées doit ouvrir le fichier (aucun caractère avant, BOM compris).`);
    }

    const meta = new Map();
    for (const ligne of bloc[1].split(/\r?\n/)) {
        const m = ligne.match(/^\/\/\s*@(\S+)\s+(.*?)\s*$/);
        if (m) {
            const [, cle, valeur] = m;
            if (!meta.has(cle)) meta.set(cle, []);
            meta.get(cle).push(valeur);
        }
    }

    const requis = [
        'name', 'namespace', 'version', 'author', 'description', 'license',
        'homepageURL', 'supportURL', 'downloadURL', 'updateURL',
        'match', 'run-at', 'grant',
    ];
    for (const cle of requis) {
        if (!meta.has(cle)) echec(`En-tête : @${cle} manquant.`);
    }

    const premier = (cle) => meta.get(cle)?.[0] ?? '';

    const version = premier('version');
    if (version && !/^\d+\.\d+\.\d+$/.test(version)) {
        echec(`En-tête : @version « ${version} » n'est pas au format SemVer x.y.z.`);
    }

    if (meta.has('license') && premier('license') !== 'MIT') {
        echec(`En-tête : @license vaut « ${premier('license')} » alors que le dépôt est sous MIT.`);
    }

    const brut = `https://raw.githubusercontent.com/${DEPOT}/${BRANCHE}/${FICHIER}`;
    for (const cle of ['downloadURL', 'updateURL']) {
        if (meta.has(cle) && premier(cle) !== brut) {
            echec(`En-tête : @${cle} devrait valoir\n    ${brut}\n  et non\n    ${premier(cle)}`);
        }
    }

    const page = `https://github.com/${DEPOT}`;
    if (meta.has('homepageURL') && premier('homepageURL') !== page) {
        echec(`En-tête : @homepageURL devrait valoir ${page}.`);
    }
    if (meta.has('supportURL') && premier('supportURL') !== `${page}/issues`) {
        echec(`En-tête : @supportURL devrait valoir ${page}/issues.`);
    }

    if (meta.has('grant') && !meta.get('grant').includes('none')) {
        echec('En-tête : le script est conçu pour @grant none (accès direct au contexte de la page).');
    }

    if (!meta.has('match') || meta.get('match').length === 0) {
        echec('En-tête : au moins un @match est nécessaire.');
    } else {
        for (const m of meta.get('match')) {
            if (!m.startsWith('https://')) {
                echec(`En-tête : @match « ${m} » devrait être en https.`);
            }
        }
    }

    // ─── Cohérence avec le CHANGELOG ──────────────────────────────────────────

    if (version) {
        const changelog = readFileSync(join(racine, 'CHANGELOG.md'), 'utf8');
        if (!new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\]`, 'm').test(changelog)) {
            echec(`CHANGELOG.md : aucune section « ## [${version}] » pour la @version déclarée.`);
        }
    }
}

// ─── Hygiène ──────────────────────────────────────────────────────────────────

if (/^﻿/.test(source)) {
    echec(`${FICHIER} : BOM UTF-8 en tête — il empêcherait la détection du bloc de métadonnées.`);
}
if (source.includes('\r\n')) {
    echec(`${FICHIER} : fins de ligne CRLF détectées, LF attendu (voir .gitattributes).`);
}
for (const motif of [/\bdebugger\b/, /console\.log\s*\(/]) {
    const m = source.match(motif);
    if (m) echec(`${FICHIER} : « ${m[0]} » ne devrait pas subsister dans une version publiée.`);
}

// ─── Verdict ──────────────────────────────────────────────────────────────────

if (erreurs.length > 0) {
    console.error(`\n✖ ${erreurs.length} problème(s) :\n`);
    for (const e of erreurs) console.error(`  · ${e}`);
    console.error('');
    process.exit(1);
}

console.log('✔ En-tête, version et hygiène du userscript conformes.');
