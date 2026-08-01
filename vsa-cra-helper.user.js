// ==UserScript==
// @name         VSA CRA — ordre des lignes, description auto, drag & drop
// @namespace    https://github.com/erim32/addon-vsactivity-cra
// @version      1.0.0
// @author       Rémi M
// @description  Ordonne les lignes d'imputation selon un modèle, dérive la description du libellé de mission, réordonne au glisser-déposer, exporte et importe le CRA en CSV, masque ou colore les lignes et verrouille les cellules. Règle d'extraction configurable.
// @license      MIT
// @homepageURL  https://github.com/erim32/addon-vsactivity-cra
// @supportURL   https://github.com/erim32/addon-vsactivity-cra/issues
// @downloadURL  https://raw.githubusercontent.com/erim32/addon-vsactivity-cra/main/vsa-cra-helper.user.js
// @updateURL    https://raw.githubusercontent.com/erim32/addon-vsactivity-cra/main/vsa-cra-helper.user.js
// @match        https://*.vsactivity.com/o_services/timesheetspivot/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/*
 * Aide à la saisie pour la feuille de temps (CRA) de VSA / VSActivity.
 * Aucune donnée n'est transmise à l'extérieur : tout reste dans le navigateur
 * (localStorage) et dans les fichiers CSV que vous téléchargez vous-même.
 *
 *
 * INSTALLATION SUR UNE AUTRE INSTANCE
 * ───────────────────────────────────
 * Le @match ci-dessus couvre les tenants *.vsactivity.com. Pour une installation
 * sur un domaine propre, ajoutez une ligne dans le bloc de métadonnées :
 *     // @match        https://cra.example.com/o_services/timesheetspivot/*
 *
 *
 * PREMIER USAGE
 * ─────────────
 *  1. Ouvrez un mois déjà saisi, cliquez sur « ⠿ Lignes CRA » en bas à droite.
 *  2. Vérifiez l'aperçu de la règle d'extraction : la clé affichée doit identifier
 *     vos projets de façon lisible. Sinon, ajustez le motif (voir CLÉ ci-dessous).
 *  3. Rangez vos lignes au glisser-déposer, puis « Capturer l'ordre actuel ».
 *  4. Sur un mois vide, « Appliquer au mois » recrée vos lignes dans cet ordre.
 *
 *
 * CONCEPTION
 * ──────────
 *  · @grant none  Le script tourne dans le contexte de la page : accès direct à jQuery,
 *                 addLine(), initInputForTotal(), setModification(). Avec un @grant GM_*,
 *                 Tampermonkey isolerait le contexte et il faudrait passer par unsafeWindow.
 *
 *  · CLÉ         Une ligne est identifiée par une PARTIE de son libellé de mission,
 *                extraite par une règle configurable (motif + gabarit).
 *                Par défaut : le contenu de la première parenthèse.
 *
 *                  "REF-00123 [du 01/03/26 au 30/09/26 (PROJET-ALPHA)
 *                   - Assistance technique] : Intitulé mission >>> 12/30"
 *                                              └─────┬──────┘
 *                                          clé = PROJET-ALPHA
 *
 *                Beaucoup d'instances suffixent le libellé d'un compteur du type
 *                ">>> 12/30" (jours consommés / vendus) qui change à chaque imputation :
 *                le libellé entier ne peut donc pas servir de clé. L'order_id non plus,
 *                car il est réattribué au renouvellement d'une mission.
 *
 *  · ORDRE       VSA ne persiste aucun ordre utilisateur (il rend les lignes par order_id
 *                croissant). C'est donc ce script qui possède l'ordre, en local.
 *                Déplacer les <tr> est sans effet sur l'enregistrement : le payload est
 *                indexé par line[<ID>], jamais par position.
 *
 *  · RE-RENDER   Le DOM de la grille est intégralement remplacé au changement de mois et
 *                après chaque enregistrement. Ré-accrochage via attachSubmitAction()
 *                (rappelée par tous les chemins de re-render) + MutationObserver.
 */

(function () {
    'use strict';

    // ─────────────────────────────────────────────────────────────────────────
    //  Constantes & état
    // ─────────────────────────────────────────────────────────────────────────

    const NS = 'vsaCraHelper';
    const MODEL_KEY = NS + '.model.v2';
    const SETTINGS_KEY = NS + '.settings.v2';

    /**
     * Règle d'extraction, appliquée au libellé complet de la mission.
     *   motif   : expression régulière (source, sans délimiteurs)
     *   cle     : gabarit du fragment identifiant  ($0 = tout, $1 = 1er groupe, …)
     *   descr   : gabarit de la description à écrire
     * Par défaut : contenu de la première parenthèse, utilisé à la fois comme clé
     * et comme description.
     */
    const REGLE_DEFAUT = {
        motif: '\\(([^)]*)\\)',
        drapeaux: '',
        cle: '$1',
        descr: '$1',
    };

    const DEFAUTS = {
        autoOrdre: true,    // réordonner au chargement (n'écrit aucune donnée)
        autoDescr: true,    // remplir les descriptions VIDES au chargement
        // Format CSV, utilisé à l'export comme à l'import.
        // Défauts adaptés à Excel en français ; la décimale est forcée différente du
        // séparateur (voir sepCsv / decCsv), une même valeur rendant le fichier illisible.
        csvSep: ';',        // ';' | ',' | '\t' | '|'
        csvDecimal: ',',    // ',' | '.'

        // Valeurs à considérer comme « description vide », donc écrasables en mode
        // automatique — séparées par des virgules. Selon le paramétrage de l'instance,
        // VSA peut préremplir ce champ avec un gabarit : indiquez-le ici pour qu'il ne
        // soit pas pris pour une saisie manuelle. Laisser vide = seule '' compte.
        descrVides: '[]',

        // Temps de repos après chaque changement déclenchant un appel AJAX (choix du
        // tiers, choix de la mission). À augmenter sur une instance lente si la création
        // automatique de lignes échoue de façon intermittente.
        delaiMs: 250,

        // Verrouillage de cellules. Implémenté par readOnly et NON par disabled :
        // jQuery.serialize() omet les champs désactivés, ce qui ferait disparaître les
        // jours concernés du POST — et donc potentiellement effacerait des temps déjà
        // saisis. readOnly empêche la frappe tout en gardant le champ dans le payload.
        bloquerWeekend: false,  // samedis et dimanches en lecture seule
        bloquerPasse: false,    // jours antérieurs à aujourd'hui en lecture seule

        // Remplace « 2,5 jours » par un tableau : ce mois-ci / planifiés / vendus.
        suiviLigne: true,

        // Raccourcis clavier sur une cellule de jour : A=0, Z=0,25, E=0,5, R=0,75, T=1.
        raccourcisSaisie: true,

        // Après un raccourci, passer à la cellule saisissable suivante.
        avanceAuto: true,

        // Attribue à chaque ligne une couleur de fond déduite de son couple
        // tiers + projet, tant qu'aucune couleur n'a été choisie manuellement.
        couleursAuto: true,

        // Apparence par projet : { [cle]: { masque: true, couleur: '#rrggbb' } }
        // La couleur enregistrée est celle choisie par l'utilisateur ; la teinte
        // réellement appliquée en est dérivée au rendu (voir normaliserTeinte).
        apparence: {},

        regle: { ...REGLE_DEFAUT },
    };

    let reglages = charger(SETTINGS_KEY, DEFAUTS);

    // Migration du réglage booléen « format international », remplacé par le couple
    // séparateur / décimale. Sans cela, un utilisateur qui l'avait activé repasserait
    // silencieusement au format français.
    if (typeof reglages.csvIntl === 'boolean') {
        if (reglages.csvIntl) { reglages.csvSep = ','; reglages.csvDecimal = '.'; }
        delete reglages.csvIntl;
        ecrire(SETTINGS_KEY, reglages);
    }
    let modele = charger(MODEL_KEY, []);   // [{ cle, brut, titre, tiers, viaMission }]
    let muet = false;                    // neutralise l'observer pendant nos mutations
    let amorcage = false;
    const tbodiesTries = new WeakSet();

    const $ = window.jQuery;

    // ─────────────────────────────────────────────────────────────────────────
    //  Persistance
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Copie profonde des valeurs par défaut. Volontairement en JSON plutôt qu'en
     * structuredClone : ce dernier manque aux navigateurs antérieurs à 2022 et à certains
     * environnements verrouillés, et il était appelé jusque dans le catch de charger() —
     * son absence empêchait donc le script de démarrer, avant tout garde-fou.
     * Les données concernées sont du JSON pur (booléens, chaînes, nombres, objets plats).
     */
    // Déclaration de fonction (et non const) : charger() est appelée plus haut dans le
    // fichier, une const serait dans sa zone morte temporelle.
    function copie(v) { return JSON.parse(JSON.stringify(v)); }

    function charger(cle, defaut) {
        try {
            const brut = localStorage.getItem(cle);
            if (!brut) return copie(defaut);
            const lu = JSON.parse(brut);
            if (Array.isArray(defaut)) return Array.isArray(lu) ? lu : copie(defaut);
            // Les réglages absents (version antérieure) reprennent la valeur par défaut.
            return {
                ...copie(defaut),
                ...lu,
                regle: { ...REGLE_DEFAUT, ...(lu.regle || {}) },
                apparence: { ...(lu.apparence || {}) },
            };
        } catch (e) {
            avertir('lecture du stockage impossible', e);
            return copie(defaut);
        }
    }

    function ecrire(cle, valeur) {
        try { localStorage.setItem(cle, JSON.stringify(valeur)); }
        catch (e) { avertir('écriture dans le stockage impossible', e); }
    }

    const sauverModele = () => ecrire(MODEL_KEY, modele);
    const sauverReglages = () => ecrire(SETTINGS_KEY, reglages);
    const pause = ms => new Promise(r => setTimeout(r, ms));

    // ─────────────────────────────────────────────────────────────────────────
    //  Règle d'extraction
    // ─────────────────────────────────────────────────────────────────────────

    let _regexCache = null, _regexSrc = null;

    /** Compile la règle courante. Retourne null si le motif est invalide. */
    function regex() {
        const { motif, drapeaux } = reglages.regle;
        // Cle de cache non ambigue et 100% ASCII (pas de separateur invisible).
        const src = JSON.stringify([motif, drapeaux]);
        if (src !== _regexSrc) {
            _regexSrc = src;
            try { _regexCache = new RegExp(motif, (drapeaux || '').replace(/[gy]/g, '')); }
            catch { _regexCache = null; }
        }
        return _regexCache;
    }

    /** Remplace $0, $1… par les groupes capturés. */
    function rendreGabarit(gabarit, m) {
        return String(gabarit || '').replace(/\$(\d+)/g, (_, i) => m[+i] ?? '');
    }

    /**
     * Applique la règle à un libellé.
     * @returns {{cle:string, brut:string, descr:string, trouve:boolean}}
     *   trouve=false → le motif n'a rien matché : la clé de repli est le libellé entier
     *   (cas des activités internes sans mission, ex. « Formation »), et aucune
     *   description n'est proposée — on n'invente pas de valeur.
     */
    function extraire(titre) {
        const t = (titre || '').replace(/\s+/g, ' ').trim();
        const re = regex();
        const m = re ? re.exec(t) : null;
        if (!m) return { cle: normCle(t), brut: t, descr: '', trouve: false };
        const brut = rendreGabarit(reglages.regle.cle, m).trim();
        return {
            cle: normCle(brut),
            brut,
            descr: rendreGabarit(reglages.regle.descr, m).trim(),
            trouve: true,
        };
    }

    /**
     * Normalisation de comparaison. Le libellé affiché et la description écrite restent
     * verbatim ; seule la clé de correspondance est normalisée.
     * Les espaces autour des tirets sont supprimés car les libellés saisis à la main
     * mélangent couramment les deux formes (« ABC-DEF » et « ABC - DEF ») au sein
     * d'une même liste de missions.
     */
    function normCle(s) {
        return (s || '')
            .replace(/\s+/g, ' ')
            .replace(/\s*-\s*/g, '-')
            .trim()
            .toLowerCase();
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Accès DOM
    // ─────────────────────────────────────────────────────────────────────────

    const tbody = () => document.querySelector('#grid_thead_table_crapivot > tbody');
    const lignes = () => { const b = tbody(); return b ? [...b.querySelectorAll(':scope > tr[id^="line_"]')] : []; };
    const idDe = tr => tr.id.slice(5);

    const selTiers = L => document.querySelector(`select[name="line[${L}][tiers_code]"]`);
    const selOrdre = L => document.querySelector(`select[name="line[${L}][order_id]"]`);
    const roOrdre = L => document.querySelector(`input[name="line[${L}][order_id]"]`);
    // ⚠ la description DOIT être adressée par name : son id (description_<tiers_code>) est
    //    dupliqué entre toutes les lignes partageant le même client.
    const champDescr = L => document.querySelector(`input[name="line[${L}][description]"]`);

    const idEcran = () => document.getElementById('timesheet_id')?.value || '';
    const nomModule = () => document.querySelector('#timesheet input[name="name"]')?.value || 'UITimesheetPivot';

    const texteOption = o => (o?.textContent || '').replace(/\s+/g, ' ').trim();

    /** Libellé complet de la mission d'une ligne (ou du tiers si activité interne). */
    function titreDe(L) {
        const s = selOrdre(L);
        if (s && s.value !== 'none') {
            const o = s.options[s.selectedIndex];
            if (o) return texteOption(o);
        }
        const ro = roOrdre(L);
        if (ro) return (ro.getAttribute('title') || ro.value || '').replace(/\s+/g, ' ').trim();

        const ts = selTiers(L);
        if (ts) {
            const o = ts.options[ts.selectedIndex];
            if (o) return texteOption(o);
        }
        return '';
    }

    const tiersDe = L => selTiers(L)?.value || '';
    const aMission = L => !!(selOrdre(L) || roOrdre(L));
    const cleDe = L => extraire(titreDe(L)).cle;

    // ─────────────────────────────────────────────────────────────────────────
    //  Modèle
    // ─────────────────────────────────────────────────────────────────────────

    function entreeDepuisLigne(L) {
        const titre = titreDe(L);
        const ex = extraire(titre);
        if (!ex.cle) return null;
        return { cle: ex.cle, brut: ex.brut, titre, tiers: tiersDe(L), viaMission: aMission(L) };
    }

    /** Photographie l'ordre courant de la feuille et en fait le modèle. */
    function capturerModele() {
        const capture = [];
        for (const tr of lignes()) {
            const e = entreeDepuisLigne(idDe(tr));
            if (e && !capture.some(x => x.cle === e.cle)) capture.push(e);
        }
        modele = capture;
        sauverModele();
        return modele;
    }

    /** Index { clé → ligne } des lignes présentes dans la feuille. */
    function indexLignes() {
        const idx = new Map();
        for (const tr of lignes()) {
            const L = idDe(tr);
            const c = cleDe(L);
            if (c && !idx.has(c)) idx.set(c, { L, tr });
        }
        return idx;
    }

    const resoudre = (entree, idx) => idx.get(entree.cle) || null;

    /** Libellé lisible d'une entrée, pour le panneau et les messages. */
    const etiquette = e => e.brut || e.cle;

    // ─────────────────────────────────────────────────────────────────────────
    //  1) Ordonner les lignes
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Réordonne les <tr> pour suivre le modèle. N'écrit aucune donnée métier.
     * Les lignes hors modèle sont conservées, à la suite, dans leur ordre courant.
     */
    function appliquerOrdre() {
        const b = tbody();
        if (!b || !modele.length) return 0;

        const rangs = lignes();
        if (rangs.length < 2) return 0;

        const idx = indexLignes();
        const ordonnees = [];
        const vus = new Set();

        for (const e of modele) {
            const hit = resoudre(e, idx);
            if (hit && !vus.has(hit.tr)) { ordonnees.push(hit.tr); vus.add(hit.tr); }
        }
        for (const tr of rangs) if (!vus.has(tr)) ordonnees.push(tr);

        if (ordonnees.every((tr, i) => tr === rangs[i])) return 0;   // déjà en ordre

        // Les lignes d'activité sont réinsérées après l'élément qui précède la première
        // d'entre elles : en-têtes, ligne « Télétravail » et ligne de totaux restent en place.
        const ancre = rangs[0].previousElementSibling;

        avecMuet(() => {
            let prec = null;
            for (const tr of ordonnees) {
                if (prec) prec.after(tr);
                else if (ancre) ancre.after(tr);
                else b.prepend(tr);
                prec = tr;
            }
        });

        return ordonnees.length;
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  2) Description dérivée du libellé
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Une description est « vide » si elle est réellement vide, ou si elle correspond à
     * l'un des gabarits déclarés dans le réglage descrVides. Ces valeurs-là sont
     * écrasables automatiquement ; tout le reste est considéré comme une saisie manuelle
     * et n'est jamais touché sans action explicite.
     */
    function descrVide(v) {
        const s = (v || '').trim();
        if (s === '') return true;
        return String(reglages.descrVides || '')
            .split(',')
            .map(x => x.trim())
            .filter(Boolean)
            .includes(s);
    }

    /**
     * @param {boolean} forcer true = écrase toute description ; false = ne remplit que les vides
     * @returns {number} champs modifiés
     */
    function appliquerDescriptions(forcer) {
        let n = 0;
        for (const tr of lignes()) {
            if (ecrireDescription(idDe(tr), forcer)) n++;
        }
        if (n) marquerModifie();
        return n;
    }

    function ecrireDescription(L, forcer) {
        const champ = champDescr(L);
        if (!champ || champ.disabled) return false;

        const ex = extraire(titreDe(L));
        if (!ex.trouve || !ex.descr) return false;          // pas de match → on n'invente rien
        if (champ.value === ex.descr) return false;
        if (!forcer && !descrVide(champ.value)) return false; // saisie manuelle : intouchable

        champ.value = ex.descr;
        champ.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Apparence : masquage et couleur de ligne
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Clé d'apparence : tiers + projet.
     * Le code tiers (et non son libellé) parce qu'il est stable et indépendant de la
     * langue ; le projet parce que deux clients peuvent avoir un projet homonyme.
     * @param {{tiers?:string, cle?:string}} e  entrée de modèle ou issue d'une ligne
     */
    const cleApparence = e => (e?.tiers || '') + '|' + (e?.cle || '');

    /** Lecture avec repli sur l'ancienne clé (projet seul), pour ne rien perdre. */
    function appDe(e) {
        const a = reglages.apparence || {};
        return a[cleApparence(e)] || a[e?.cle] || {};
    }

    /**
     * @param {boolean} rafraichir  false pendant le glissement du sélecteur de couleur :
     *   reconstruire la liste détruirait l'<input type="color"> en cours d'utilisation,
     *   ce qui orpheline la boîte de dialogue native et fige la couleur sur une valeur
     *   intermédiaire. On ne rafraîchit qu'à la validation.
     */
    function majApparence(e, patch, rafraichir = true) {
        if (!reglages.apparence) reglages.apparence = {};
        const k = cleApparence(e);
        const a = { ...appDe(e), ...patch };
        if (!a.masque) delete a.masque;
        if (!a.couleur) delete a.couleur;
        if (Object.keys(a).length) reglages.apparence[k] = a;
        else delete reglages.apparence[k];
        delete reglages.apparence[e?.cle];       // purge de l'ancienne clé une fois migrée
        sauverReglages();
        appliquerApparence();
        if (rafraichir) rafraichirPanneau();
    }

    /** Le thème sombre de VSA est signalé sur <html data-vs-theme>. */
    function themeSombre() {
        const t = document.documentElement.getAttribute('data-vs-theme')
            || document.documentElement.getAttribute('data-vs-appearance');
        if (t) return t.toLowerCase() === 'dark';
        return !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    }

    // ── conversions couleur

    function hexVersRgb(hex) {
        const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
        if (!m) return null;
        const n = parseInt(m[1], 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }

    function rgbVersHsl(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const l = (max + min) / 2;
        if (max === min) return [0, 0, l];
        const d = max - min;
        const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        let h;
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        else if (max === g) h = ((b - r) / d + 2) / 6;
        else h = ((r - g) / d + 4) / 6;
        return [h, s, l];
    }

    function hslVersHex(h, s, l) {
        const f = n => {
            const k = (n + h * 12) % 12;
            const a = s * Math.min(l, 1 - l);
            const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
            return Math.round(v * 255).toString(16).padStart(2, '0');
        };
        return '#' + f(0) + f(8) + f(4);
    }

    /**
     * Transforme une couleur choisie librement en teinte de fond sûre.
     *
     * Principe : seule la TEINTE du choix est conservée. Saturation et clarté sont
     * imposées, de sorte qu'aucun choix — noir, fluo, saturé — ne puisse produire un
     * fond illisible. La teinte reste donc le seul degré de liberté offert.
     *
     * Les valeurs viennent d'une mesure de contraste WCAG, pas d'un réglage à vue.
     * Critère retenu : ne jamais faire pire que le fond le plus sombre que VSA utilise
     * lui-même (le gris #DDDDDD des week-ends). Contrastes au pire des 24 teintes :
     *
     *                              #333 (texte)   #787878   #9a9da6 (mentions 8px)
     *   VSA, fond normal #FBFBFB       12,6          4,27       2,62
     *   VSA, week-end    #DDDDDD        9,9          3,25       2,00   ← plancher
     *   Teinte L=90 % S≤42 %            9,2          3,24       1,99   ← retenu
     *
     * Le texte principal reste très au-dessus de AAA (7:1). Les mentions en #9a9da6
     * n'atteignaient déjà pas AA dans le design d'origine : la teinte ne les dégrade
     * pas davantage que ne le fait VSA sur ses propres cellules de week-end.
     * Les champs de saisie ont leur propre fond blanc, leur contenu n'est pas concerné.
     *
     * Enfin, la couleur ne s'applique qu'aux jours ordinaires : les fonds sémantiques
     * de VSA (week-end, férié, congé) sont déclarés !important et l'emportent seuls.
     */
    function normaliserTeinte(hex, sombre = themeSombre()) {
        const rgb = hexVersRgb(hex);
        if (!rgb) return null;
        const [h, s] = rgbVersHsl(...rgb);
        return sombre
            ? hslVersHex(h, Math.min(s, 0.38), 0.23)
            : hslVersHex(h, Math.min(s, 0.42), 0.90);
    }

    /** Palette proposée : teintes distinctes, déjà conformes aux règles ci-dessus. */
    const PALETTE = ['#4dab91', '#5b8def', '#b07cd6', '#e0954a', '#d16a6a', '#4aa3b5', '#8a9a5b', '#9a9da6'];

    /** Douze teintes réparties, décalées de 15° pour éviter les rouges et verts purs. */
    const TEINTES_AUTO = [15, 45, 75, 105, 135, 165, 195, 225, 255, 285, 315, 345];

    /** FNV-1a 32 bits : court, sans dépendance, et surtout déterministe d'une session
     *  à l'autre — un projet garde la même couleur indéfiniment. */
    function hash32(s) {
        let h = 0x811c9dc5;
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 0x01000193) >>> 0;
        }
        return h >>> 0;
    }

    /**
     * Couleur par défaut d'une ligne, dérivée de la combinaison tiers + projet.
     * Deux lignes du même projet chez deux clients différents obtiennent donc deux
     * couleurs distinctes, et la couleur ne bouge pas d'un mois sur l'autre.
     * La valeur renvoyée est une couleur « brute » : elle passe ensuite par
     * normaliserTeinte, comme un choix manuel.
     */
    function couleurAuto(e) {
        const k = cleApparence(e);
        if (k === '|') return null;                       // ligne non identifiable
        const h = TEINTES_AUTO[hash32(k) % TEINTES_AUTO.length];
        return hslVersHex(h / 360, 0.6, 0.5);
    }

    /** Couleur effective : choix explicite, sinon couleur automatique si activée. */
    function couleurEffective(e) {
        const a = appDe(e);
        if (a.couleur) return a.couleur;
        return reglages.couleursAuto ? couleurAuto(e) : null;
    }

    /**
     * Pose la teinte sur l'élément de ligne lui-même — le <tr id="line_…"> de
     * #grid_thead_table_crapivot — et non sur chaque cellule.
     *
     * Le fond d'un <tr> n'est visible que là où les cellules sont transparentes : or
     * VSA donne aux jours ordinaires un fond opaque #FBFBFB (règle .classic_day), qui
     * masquerait entièrement la ligne. On neutralise donc le fond des cellules.
     *
     * Cette neutralisation est sans effet sur les cellules à fond signifiant — week-end,
     * férié, congé — dont la règle VSA est déclarée !important et l'emporte sur un style
     * en ligne. Leur signalétique est donc préservée sans traitement particulier.
     */
    function peindreLigne(tr, teinte) {
        tr.style.backgroundColor = teinte || '';
        for (const td of tr.querySelectorAll(':scope > td')) {
            // '' rend la main à la feuille de style de VSA ; 'transparent' laisse voir le <tr>.
            td.style.backgroundColor = teinte ? 'transparent' : '';
        }
    }

    /** Aperçu immédiat sur la grille pendant le glissement, sans rien enregistrer. */
    function apercuCouleur(e, brute) {
        const teinte = normaliserTeinte(brute);
        const cible = cleApparence(e);
        for (const tr of lignes()) {
            const le = entreeDepuisLigne(idDe(tr));
            if (!le || cleApparence(le) !== cible) continue;
            peindreLigne(tr, teinte);
        }
    }

    function appliquerApparence() {
        const sombre = themeSombre();
        for (const tr of lignes()) {
            const e = entreeDepuisLigne(idDe(tr)) || {};
            const a = appDe(e);

            tr.style.display = a.masque ? 'none' : '';
            tr.dataset.craMasque = a.masque ? '1' : '';

            const brute = couleurEffective(e);
            peindreLigne(tr, brute ? normaliserTeinte(brute, sombre) : null);
        }
    }

    function toutAfficher() {
        for (const k of Object.keys(reglages.apparence || {})) {
            if (reglages.apparence[k].masque) delete reglages.apparence[k].masque;
            if (!Object.keys(reglages.apparence[k]).length) delete reglages.apparence[k];
        }
        sauverReglages();
        appliquerApparence();
        rafraichirPanneau();
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Suivi de consommation par ligne
    // ─────────────────────────────────────────────────────────────────────────
    //
    //  Remplace « 2,5 jours » par un tableau compact à l'emplacement de
    //  #total_line_unit_<L> :
    //
    //      Ce mois-ci        2,5 jours
    //      Jours planifiés    15
    //      Jours vendus       30
    //
    //  · « Ce mois-ci » réutilise les ÉLÉMENTS existants (#total_line_ et
    //    #total_line_unit_), simplement déplacés dans le tableau. Leur identité est
    //    préservée, donc les mises à jour live de VSA continuent de les atteindre.
    //  · « Jours planifiés » et « Jours vendus » sont recopiés depuis #backlog_<L>,
    //    qui appartient à VSA : on ne le modifie pas, on l'observe.

    const decodeNbsp = s => String(s || '').replace(/&nbsp;/gi, ' ');
    const normLibelle = s => decodeNbsp(s).replace(/\s+/g, ' ').trim().toLowerCase();

    function nombreDepuisTexte(t) {
        const m = /(-?[\d  ]+(?:[.,]\d+)?)/.exec(String(t || '').replace(/ /g, ' '));
        if (!m) return null;
        const n = parseFloat(m[1].replace(/[\s ]/g, '').replace(',', '.'));
        return isNaN(n) ? null : n;
    }

    /** Libellé « Total des jours : », lu dans les traductions exposées par la page. */
    const libelleVendu = () => normLibelle(window.txt_total_days || 'Total des jours :')
        .replace(/[:\s]+$/, '');

    /** Jours vendus. Le paragraphe n'a pas d'id : on le retrouve par son libellé. */
    function venduDe(L) {
        const bl = document.getElementById('backlog_' + L);
        const lab = libelleVendu();
        if (bl && lab) {
            for (const p of bl.querySelectorAll('p')) {
                const t = normLibelle(p.textContent);
                if (t.startsWith(lab)) {
                    const n = nombreDepuisTexte(t.slice(lab.length));
                    if (n !== null) return n;
                }
            }
        }
        // Repli : compteur « >>> réalisé/vendu » présent en fin de libellé de mission.
        const m = /(?:>>>)\s*[\d.,]+\s*\/\s*([\d.,]+)\s*$/.exec(titreDe(L));
        return m ? nombreDepuisTexte(m[1]) : null;
    }

    function planifieDe(L) {
        const e = document.getElementById('days_used_' + L);
        return e ? nombreDepuisTexte(e.textContent) : null;
    }

    const nombreAffiche = n => (n === null || n === undefined)
        ? '—'
        : String(arrondi(n)).replace('.', ',');

    function injecterSuivi() {
        if (!reglages.suiviLigne) { retirerSuivi(); return; }

        for (const tr of lignes()) {
            const L = idDe(tr);
            const total = document.getElementById('total_line_' + L);
            if (!total) continue;

            let tbl = document.getElementById('cra-suivi-' + L);
            if (!tbl) {
                const p = total.closest('p');
                const unite = document.getElementById('total_line_unit_' + L);
                if (!p || !p.parentNode) continue;

                tbl = document.createElement('table');
                tbl.className = 'cra-suivi';
                tbl.id = 'cra-suivi-' + L;
                tbl.innerHTML =
                    '<tbody>'
                    + '<tr><th>Ce mois-ci</th><td class="v mois"></td><td class="p"></td></tr>'
                    + '<tr><th>Jours planifiés</th><td class="v plan"></td><td class="p pct"></td></tr>'
                    + '<tr><th>Jours vendus</th><td class="v vendu"></td><td class="p"></td></tr>'
                    + '</tbody>';

                // Déplacement (et non copie) : VSA continue d'écrire dans ces éléments.
                const cel = tbl.querySelector('td.mois');
                cel.appendChild(total);
                if (unite) { cel.appendChild(document.createTextNode(' ')); cel.appendChild(unite); }

                p.parentNode.insertBefore(tbl, p);
                p.remove();                       // ne contenait que les deux éléments déplacés
                observerBacklog(L);
            }
            syncSuivi(L);
        }
    }

    /**
     * Part consommée : planifiés / vendus. Une décimale au plus, le zéro final étant
     * retiré (50 %, 7,5 %, 68,8 %). Espace insécable exclue au profit d'un espace
     * ordinaire + white-space:nowrap, pour ne pas réintroduire de caractère invisible.
     */
    function pourcentAffiche(plan, vendu) {
        if (plan === null || !vendu) return '';      // couvre aussi vendu = 0
        const p = Math.round((plan / vendu) * 1000) / 10;
        return String(p).replace('.', ',') + ' %';
    }

    function syncSuivi(L) {
        const tbl = document.getElementById('cra-suivi-' + L);
        if (!tbl) return;
        const plan = planifieDe(L), vendu = venduDe(L);
        tbl.querySelector('td.plan').textContent = nombreAffiche(plan);
        tbl.querySelector('td.vendu').textContent = nombreAffiche(vendu);
        tbl.querySelector('td.pct').textContent = pourcentAffiche(plan, vendu);
        // Repère visuel discret lorsque le vendu est dépassé.
        tbl.classList.toggle('depasse', plan !== null && vendu !== null && plan > vendu);
    }

    /** #backlog_<L> est reconstruit par setBacklog() à chaque changement de mission,
     *  et son days_used est réécrit à chaque saisie : on se contente de l'observer. */
    function observerBacklog(L) {
        const bl = document.getElementById('backlog_' + L);
        if (!bl || bl.dataset.craObs) return;
        bl.dataset.craObs = '1';
        new MutationObserver(() => syncSuivi(L))
            .observe(bl, { childList: true, subtree: true, characterData: true });
    }

    /** Retour à l'affichage d'origine : on remet les éléments déplacés dans un <p>. */
    function retirerSuivi() {
        for (const tbl of document.querySelectorAll('table.cra-suivi')) {
            const L = tbl.id.replace('cra-suivi-', '');
            const total = document.getElementById('total_line_' + L);
            const unite = document.getElementById('total_line_unit_' + L);
            const p = document.createElement('p');
            p.style.cssText = 'text-align:left;font-size:13px;margin-left:3px;';
            if (total) p.appendChild(total);
            if (unite) { p.appendChild(document.createTextNode(' ')); p.appendChild(unite); }
            tbl.parentNode.insertBefore(p, tbl);
            tbl.remove();
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Verrouillage des cellules (week-end / passé)
    // ─────────────────────────────────────────────────────────────────────────

    /** Nature d'un jour, lue sur les classes du <td> — plus fiable que days_exclusion,
     *  déclaré deux fois avec des valeurs contradictoires dans la page. */
    function tdDuJour(jour) {
        const c = document.querySelector(`input[id^="input_day_"][id$="_[[${jour}]]"]`);
        return c ? c.closest('td') : null;
    }

    function estWeekend(jour) {
        const td = tdDuJour(jour);
        if (td) return td.classList.contains('saturday') || td.classList.contains('sunday');
        const y = window.current_year, m = window.current_month;
        if (!y || !m) return false;
        return [0, 6].includes(new Date(y, m - 1, jour).getDay());
    }

    function estPasse(jour) {
        const y = window.current_year, m = window.current_month;
        if (!y || !m) return false;
        const d = new Date(y, m - 1, jour);
        const auj = new Date();
        auj.setHours(0, 0, 0, 0);
        return d < auj;
    }

    /**
     * Applique / retire le verrou. On n'utilise jamais `disabled` (cf. DEFAUTS) et on ne
     * touche pas aux cellules que VSA a lui-même désactivées (hors période de mission).
     * Le marqueur data-craLock garantit qu'on ne déverrouille que ce qu'on a verrouillé.
     */
    function appliquerVerrous() {
        const jours = joursDuMois();
        const verrous = new Map(jours.map(j => [j, (reglages.bloquerWeekend && estWeekend(j))
            || (reglages.bloquerPasse && estPasse(j))]));

        for (const tr of lignes()) {
            const L = idDe(tr);
            for (const j of jours) {
                for (const pref of ['input_day_', 'input_hour_']) {
                    const el = document.getElementById(`${pref}((${L}))_[[${j}]]`);
                    if (!el || el.disabled) continue;   // désactivé par VSA : on laisse

                    const doitVerrouiller = verrous.get(j);
                    if (doitVerrouiller) {
                        if (el.tagName === 'INPUT') el.readOnly = true;
                        el.dataset.craLock = '1';
                        el.title = 'Saisie verrouillée par l\'assistant CRA';
                        el.style.cursor = 'not-allowed';
                        el.style.opacity = '0.55';
                    } else if (el.dataset.craLock) {
                        if (el.tagName === 'INPUT') el.readOnly = false;
                        delete el.dataset.craLock;
                        el.title = '';
                        el.style.cursor = '';
                        el.style.opacity = '';
                    }
                }
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Raccourcis de saisie
    // ─────────────────────────────────────────────────────────────────────────
    //
    //  Sur une cellule de jour ayant le focus, une touche unique pose une valeur.
    //  A Z E R T sont les cinq premières touches de la rangée du haut en AZERTY :
    //  la main gauche couvre toute l'échelle sans se déplacer.

    const RACCOURCIS = { a: 0, z: 0.25, e: 0.5, r: 0.75, t: 1 };

    /** Cellule de saisie d'un jour de la grille CRA ? */
    function estCelluleJour(el) {
        if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'SELECT')) return false;
        if (!/^input_(day|hour)_\(\(/.test(el.id || '')) return false;
        return !!el.closest('#grid_thead_table_crapivot');
    }

    /**
     * Écrit une valeur exprimée EN JOURS dans la cellule ciblée.
     * Si la ligne est affichée en heures, la cellule visible attend des heures :
     * on convertit avec le barème du jour de la semaine (getHoursDay de VSA), afin
     * que « T » signifie toujours « une journée complète ».
     */
    function poserValeurJour(el, jours) {
        let v = jours;
        if (el.id.startsWith('input_hour_')) {
            let nb = 0;
            try { nb = typeof window.getHoursDay === 'function' ? window.getHoursDay(el) : 0; } catch { nb = 0; }
            if (nb) v = arrondi(jours * nb);
        }

        if (el.tagName === 'SELECT') {
            // Variante « saisie par liste » : la valeur doit exister parmi les options.
            const opt = [...el.options].find(o => parseFloat(String(o.value).replace(',', '.')) === v);
            if (!opt) return false;
            el.value = opt.value;
        } else {
            el.value = String(v).replace('.', ',');
        }

        el.dispatchEvent(new Event('change', { bubbles: true }));
        marquerModifie();
        return true;
    }

    /** Cellule réellement saisissable pour (ligne, jour) : visible, active, non verrouillée. */
    function celluleSaisissable(L, jour) {
        for (const p of ['input_day_', 'input_hour_']) {
            const el = document.getElementById(`${p}((${L}))_[[${jour}]]`);
            if (!el) continue;
            if (el.style.display === 'none') continue;   // l'autre unité de la paire
            if (el.disabled) continue;                   // hors période de mission (VSA)
            if (estVerrouillee(el)) continue;            // week-end / passé
            return el;
        }
        return null;
    }

    /**
     * Cellule suivante dans l'ordre de lecture : le reste du mois sur la ligne courante,
     * puis les lignes suivantes depuis leur premier jour. Les lignes masquées et les
     * cellules non saisissables sont ignorées, pour ne jamais déposer le focus dans un
     * champ où la frappe suivante n'aurait aucun effet.
     * @returns {HTMLElement|null} null sur la toute dernière cellule
     */
    function celluleSuivante(el) {
        const m = /^input_(?:day|hour)_\(\((.+)\)\)_\[\[(\d+)\]\]$/.exec(el.id || '');
        if (!m) return null;
        const [, L, jStr] = m;
        const jour = parseInt(jStr, 10);
        const jours = joursDuMois();
        const rangs = lignes().filter(tr => tr.style.display !== 'none');
        const i = rangs.findIndex(tr => idDe(tr) === L);
        if (i < 0) return null;

        for (const j of jours) {
            if (j > jour) { const c = celluleSaisissable(L, j); if (c) return c; }
        }
        for (let k = i + 1; k < rangs.length; k++) {
            const L2 = idDe(rangs[k]);
            for (const j of jours) { const c = celluleSaisissable(L2, j); if (c) return c; }
        }
        return null;
    }

    /** Place le focus et sélectionne : la frappe suivante remplace au lieu de compléter. */
    function focaliser(el) {
        if (!el) return;
        try { el.focus(); el.select?.(); } catch { /* les <select> n'ont pas select() */ }
    }

    function installerRaccourcis() {
        if (document.body.dataset.craRaccourcis) return;
        document.body.dataset.craRaccourcis = '1';

        document.addEventListener('keydown', e => {
            if (!reglages.raccourcisSaisie) return;
            // Les combinaisons avec Ctrl/Alt/Meta appartiennent au navigateur :
            // Ctrl+A doit continuer de tout sélectionner, Ctrl+Z d'annuler, etc.
            if (e.ctrlKey || e.altKey || e.metaKey) return;

            const jours = RACCOURCIS[String(e.key || '').toLowerCase()];
            if (jours === undefined) return;

            const el = e.target;
            if (!estCelluleJour(el)) return;

            // Verrouillée : on absorbe quand même la touche, pour ne pas laisser
            // la lettre s'inscrire dans un champ censé être en lecture seule.
            e.preventDefault();
            if (estVerrouillee(el)) return;

            if (!poserValeurJour(el, jours)) return;

            // Avancement : seulement après une valeur effectivement posée. En bout de
            // grille, celluleSuivante() renvoie null et le focus reste sur place.
            const suivante = reglages.avanceAuto ? celluleSuivante(el) : null;
            focaliser(suivante || el);
        }, true);
    }

    /** Un <select> ne connaît pas readOnly : on bloque l'interaction à la source. */
    function installerGardeSelect() {
        if (document.body.dataset.craGardeSelect) return;
        document.body.dataset.craGardeSelect = '1';
        for (const evt of ['mousedown', 'keydown']) {
            document.addEventListener(evt, e => {
                const el = e.target;
                if (el?.tagName === 'SELECT' && el.dataset?.craLock) e.preventDefault();
            }, true);
        }
    }

    const estVerrouillee = el => !!(el && (el.disabled || el.readOnly || el.dataset?.craLock));

    // ─────────────────────────────────────────────────────────────────────────
    //  3) Glisser-déposer
    // ─────────────────────────────────────────────────────────────────────────

    function injecterPoignees() {
        for (const tr of lignes()) {
            const td = tr.querySelector(':scope > td');
            if (!td || td.querySelector('.cra-grip')) continue;
            if (getComputedStyle(td).position === 'static') td.style.position = 'relative';
            td.style.paddingLeft = '14px';

            const g = document.createElement('span');
            g.className = 'cra-grip';
            g.title = 'Glisser pour réordonner cette ligne';
            g.textContent = '⠿';
            td.prepend(g);
        }
    }

    function initTri() {
        const b = tbody();
        if (!b || tbodiesTries.has(b)) return;
        if (!$?.fn?.sortable) { avertir('jQuery UI sortable indisponible'); return; }

        $(b).sortable({
            items: '> tr[id^="line_"]',
            handle: '.cra-grip',
            axis: 'y',
            tolerance: 'pointer',
            cursor: 'grabbing',
            // Sans cela les <td> du helper s'effondrent pendant le glisser.
            helper: (e, ui) => { ui.children().each(function () { $(this).width($(this).width()); }); return ui; },
            start: () => { muet = true; },
            stop: () => { muet = false; },
            update: () => { memoriserOrdre(); notifier('Ordre enregistré'); },
        });
        tbodiesTries.add(b);
    }

    /** Après un glisser-déposer : l'ordre affiché devient l'ordre du modèle. */
    function memoriserOrdre() {
        const nouveau = [];
        for (const tr of lignes()) {
            const e = entreeDepuisLigne(idDe(tr));
            if (!e) continue;
            const ancienne = modele.find(x => x.cle === e.cle);
            nouveau.push(ancienne ? { ...ancienne, ...e } : e);
        }
        // Les entrées du modèle absentes de ce mois sont conservées, à la fin.
        for (const e of modele) if (!nouveau.some(n => n.cle === e.cle)) nouveau.push(e);

        modele = nouveau;
        sauverModele();
        rafraichirPanneau();
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Création des lignes manquantes
    // ─────────────────────────────────────────────────────────────────────────

    function attendre(predicat, { timeout = 20000, pas = 120 } = {}) {
        return new Promise((resolve, reject) => {
            const t0 = Date.now();
            (function boucle() {
                let r;
                try { r = predicat(); } catch (e) { return reject(e); }
                if (r) return resolve(r);
                if (Date.now() - t0 > timeout) return reject(new Error('délai dépassé'));
                setTimeout(boucle, pas);
            })();
        });
    }

    /**
     * Appelle addLine() de VSA et attend l'apparition de la ligne.
     * On délègue à VSA plutôt que de rejouer sa requête : plus robuste aux évolutions,
     * et le diff des ids avant/après donne l'id créé de façon déterministe.
     */
    function ajouterLigne() {
        if (!tbody()) return Promise.reject(new Error('grille absente'));
        if (typeof window.addLine !== 'function') return Promise.reject(new Error('addLine() indisponible'));

        const avant = new Set(lignes().map(idDe));
        window.addLine(nomModule(), idEcran());

        return attendre(() => {
            const neufs = lignes().map(idDe).filter(id => !avant.has(id));
            return neufs.length ? neufs[0] : null;
        });
    }

    /** Cherche, dans un <select> de missions, l'option dont la clé extraite correspond. */
    function optionPourCle(sel, cle) {
        if (!sel) return null;
        return [...sel.options].find(o => o.value && o.value !== 'none' && extraire(texteOption(o)).cle === cle) || null;
    }

    /** Renseigne tiers + mission + description sur une ligne fraîchement créée. */
    async function configurerLigne(L, entree) {
        // ── tiers (indispensable : c'est lui qui déclenche le chargement des missions)
        const ts = selTiers(L);
        if (!ts) throw new Error('sélecteur d\'activité introuvable');
        if (entree.tiers && ts.value !== entree.tiers) {
            if (![...ts.options].some(o => o.value === entree.tiers)) {
                throw new Error(`activité « ${entree.tiers} » absente de la liste`);
            }
            ts.value = entree.tiers;
            ts.dispatchEvent(new Event('change', { bubbles: true }));   // → getBdc() (AJAX)
        }

        // ── activité interne sans mission : le tiers suffit
        if (!entree.viaMission) {
            await pause(reglages.delaiMs);
            if (cleDe(L) !== entree.cle) {
                throw new Error('l\'activité choisie ne correspond pas à la clé attendue');
            }
            return;
        }

        // ── mission : le <select> est reconstruit par getBdc(), donc toujours le re-interroger
        let sel, opt;
        try {
            const trouve = await attendre(() => {
                const s = selOrdre(L);
                const o = optionPourCle(s, entree.cle);
                return o ? { s, o } : null;
            }, { timeout: 20000 });
            sel = trouve.s; opt = trouve.o;
        } catch {
            // getBdc() retire du select les missions déjà prises par une autre ligne.
            throw new Error('mission introuvable (déjà utilisée sur une autre ligne, hors période, ou libellé modifié)');
        }

        sel.value = opt.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));      // → updateLineInfo() (AJAX)

        // On laisse updateLineInfo() retomber : il peut désactiver des jours hors période.
        // Utile aussi avant la ligne suivante, dont getBdc() lira les missions déjà prises.
        await pause(reglages.delaiMs);
        ecrireDescription(L, true);
    }

    /** Crée les lignes du modèle absentes du mois, en séquence, puis ordonne et complète. */
    async function appliquerModele() {
        if (!modele.length) { alerte('Aucun modèle enregistré. Range tes lignes puis « Capturer l\'ordre actuel ».'); return; }
        if (!tbody()) { alerte('Grille introuvable — recharge la page.'); return; }

        const idx = indexLignes();
        const manquants = modele.filter(e => !resoudre(e, idx));
        const echecs = [];
        let crees = 0;

        // addLine() appelle hideLoader() à chaque succès : sans ce rappel périodique,
        // la progression disparaîtrait dès la première ligne créée.
        let message = 'Application du modèle…';
        loader(message);
        const battement = setInterval(() => loader(message), 300);

        try {
            for (const e of manquants) {
                message = `Création de « ${etiquette(e)} »… (${crees + echecs.length + 1}/${manquants.length})`;
                loader(message);
                try {
                    const L = await ajouterLigne();
                    await configurerLigne(L, e);
                    crees++;
                } catch (err) {
                    echecs.push({ label: etiquette(e), raison: err.message || String(err) });
                    avertir('création impossible', e, err);
                }
            }

            appliquerOrdre();
            injecterPoignees();
            const nd = appliquerDescriptions(true);
            if (crees) marquerModifie();

            let msg = `${crees} ligne(s) créée(s), ${nd} description(s) mise(s) à jour.`;
            if (crees) msg += '\n\n⚠ Rien n\'est encore enregistré : clique sur « Enregistrer » dans VSA.';
            if (echecs.length) msg += '\n\nNon traitées :\n' + echecs.map(f => `  · ${f.label} — ${f.raison}`).join('\n');
            alerte(msg);
        } finally {
            clearInterval(battement);
            loaderOff();
            rafraichirPanneau();
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Export CSV
    // ─────────────────────────────────────────────────────────────────────────

    // Deux caractères plutôt qu'un : « Ma » et « Me » lèvent l'ambiguïté entre mardi et
    // mercredi, que l'initiale seule ne permettait pas de distinguer.
    const JOURS_COURTS = ['Di', 'Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa'];   // indexé par Date#getDay()
    const arrondi = n => Math.round(n * 1000) / 1000;           // même précision que VSA

    /** Jours réellement présents dans le mois affiché (28→31 selon le mois). */
    function joursDuMois() {
        const j = [];
        for (let d = 1; d <= 31; d++) if (document.getElementById('total_day_' + d)) j.push(d);
        if (j.length) return j;
        const y = window.current_year, m = window.current_month;
        const nb = (y && m) ? new Date(y, m, 0).getDate() : 31;
        return Array.from({ length: nb }, (_, i) => i + 1);
    }

    function jourCourt(d) {
        const y = window.current_year, m = window.current_month;
        return (y && m) ? JOURS_COURTS[new Date(y, m - 1, d).getDay()] : '';
    }

    /**
     * Valeur d'une cellule, TOUJOURS en jours.
     * On lit input_day même pour une ligne affichée en heures : VSA maintient la
     * synchronisation dans les deux sens — une saisie en heures réécrit l'équivalent
     * en jours dans input_day (service.js ~l.2415) avant de propager les totaux.
     * C'est ce qui rend l'export homogène et sommable quel que soit le mode de saisie.
     */
    function valeurJour(L, d) {
        const el = document.getElementById(`input_day_((${L}))_[[${d}]]`);
        if (!el) return 0;
        const v = parseFloat(String(el.value).replace(',', '.'));
        return isNaN(v) ? 0 : v;
    }

    function clientDe(L) {
        const s = selTiers(L);
        const o = s && s.options[s.selectedIndex];
        return o ? texteOption(o) : '';
    }

    const descriptionDe = L => (champDescr(L)?.value || '').trim();

    // ── fabrication du CSV

    const SEPS = [';', ',', '\t', '|'];

    /** Séparateur de champs, validé. */
    function sepCsv() {
        const s = reglages.csvSep;
        return SEPS.includes(s) ? s : ';';
    }

    /**
     * Séparateur décimal. Il ne peut jamais coïncider avec le séparateur de champs :
     * « 1,5 » dans un fichier séparé par des virgules obligerait à guillemeter chaque
     * nombre, ce que beaucoup de tableurs relisent mal. On bascule donc d'office.
     */
    function decCsv() {
        const d = reglages.csvDecimal === '.' ? '.' : ',';
        return d === sepCsv() ? (d === ',' ? '.' : ',') : d;
    }

    function nombreCsv(n) {
        const s = String(arrondi(n));
        return decCsv() === ',' ? s.replace('.', ',') : s;
    }

    /** Échappement RFC 4180. */
    function champCsv(v, sep) {
        const s = String(v ?? '');
        return (/["\r\n]/.test(s) || s.includes(sep)) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }

    // U+FEFF. Construit par code plutôt qu'écrit en littéral : un caractère invisible
    // dans le source ne survit pas toujours à un copier-coller ou à une conversion
    // d'encodage, et son absence casse silencieusement les accents à l'ouverture Excel.
    const BOM = String.fromCharCode(0xFEFF);

    /** @param {Array<Array<string|number>>} tableau */
    function versCsv(tableau) {
        const sep = sepCsv();
        return BOM + tableau.map(l => l.map(c => champCsv(c, sep)).join(sep)).join('\r\n') + '\r\n';
    }

    function telecharger(nom, contenu) {
        const url = URL.createObjectURL(new Blob([contenu], { type: 'text/csv;charset=utf-8' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = nom;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    /**
     * Retire les marques diacritiques combinantes (U+0300–U+036F) laissées par NFD.
     * Filtrage par code plutôt que par classe regex, pour la même raison que le BOM :
     * pas de caractère non-ASCII invisible dans le source.
     */
    function sansAccents(s) {
        return s.normalize('NFD').split('')
            .filter(c => { const n = c.charCodeAt(0); return n < 0x300 || n > 0x36F; })
            .join('');
    }

    function nomFichier(suffixe) {
        const y = window.current_year || new Date().getFullYear();
        const m = String(window.current_month || new Date().getMonth() + 1).padStart(2, '0');
        const sel = document.getElementById('id_user_id');
        const qui = sel?.options?.[sel.selectedIndex]?.textContent?.trim() || '';
        const slug = sansAccents(qui).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
        return `CRA_${y}-${m}_${suffixe}${slug ? '_' + slug : ''}.csv`;
    }

    /** Recoupe nos totaux avec ceux de VSA : une divergence trahit une erreur de lecture. */
    function controlerCoherence(jours, totalJour, grandTotal) {
        const lire = id => {
            const e = document.getElementById(id);
            return e ? parseFloat(e.textContent.replace(',', '.')) : NaN;
        };
        const ecarts = [];
        jours.forEach((d, i) => {
            const vsa = lire('total_day_' + d);
            if (!isNaN(vsa) && Math.abs(vsa - totalJour[i]) > 0.005) {
                ecarts.push(`jour ${d} : VSA ${vsa} vs export ${arrondi(totalJour[i])}`);
            }
        });
        const vsaTotal = lire('total_total');
        if (!isNaN(vsaTotal) && Math.abs(vsaTotal - grandTotal) > 0.005) {
            ecarts.push(`total mois : VSA ${vsaTotal} vs export ${grandTotal}`);
        }
        if (ecarts.length) avertir('écart avec les totaux affichés par VSA —', ecarts);
        return ecarts;
    }

    /**
     * Export détaillé.
     * Lignes   : une par activité — Client, Description
     * Colonnes : un jour du mois chacune, puis Total du mois
     * Pied     : Total par jour, et total général au croisement
     */
    function exporterDetail() {
        const rangs = lignes();
        if (!rangs.length) { alerte('Aucune ligne à exporter.'); return; }

        const jours = joursDuMois();
        const totalJour = new Array(jours.length).fill(0);
        const corps = [];
        let grandTotal = 0;

        for (const tr of rangs) {
            const L = idDe(tr);
            const vals = jours.map(d => valeurJour(L, d));
            const total = arrondi(vals.reduce((a, b) => a + b, 0));
            vals.forEach((v, i) => { totalJour[i] += v; });
            grandTotal += total;
            corps.push([clientDe(L), descriptionDe(L), ...vals.map(nombreCsv), nombreCsv(total)]);
        }
        grandTotal = arrondi(grandTotal);

        controlerCoherence(jours, totalJour, grandTotal);

        // En-tête sur deux lignes : numéros de jour, puis abréviations.
        // Cela s'écarte de RFC 4180 (une seule ligne d'en-tête) au profit de la lisibilité
        // en tableur. L'analyseur d'import repère les lignes d'en-tête par leur contenu,
        // il accepte donc aussi bien ce format que l'ancien sur une seule ligne.
        const enteteJours = ['', '', ...jours.map(String), 'Total'];
        const enteteNoms = ['Client', 'Description', ...jours.map(jourCourt), ''];
        const pied = ['Total par jour', '', ...totalJour.map(v => nombreCsv(arrondi(v))), nombreCsv(grandTotal)];

        telecharger(nomFichier('detail'), versCsv([enteteJours, enteteNoms, ...corps, pied]));
        notifier(`Export détaillé : ${corps.length} ligne(s), ${nombreCsv(grandTotal)} j`);
    }

    /**
     * Export par projet : total consommé sur le mois, regroupé par clé extraite du libellé.
     * Le regroupement additionne, au cas où deux lignes porteraient le même projet.
     */
    function exporterProjets() {
        const rangs = lignes();
        if (!rangs.length) { alerte('Aucune ligne à exporter.'); return; }

        const jours = joursDuMois();
        const groupes = new Map();

        for (const tr of rangs) {
            const L = idDe(tr);
            const titre = titreDe(L);
            const ex = extraire(titre);
            const cle = ex.cle || '(sans projet)';

            const g = groupes.get(cle) || {
                projet: ex.brut || titre || '(sans projet)',
                client: clientDe(L),
                total: 0,
                saisis: 0,
            };
            for (const d of jours) {
                const v = valeurJour(L, d);
                g.total += v;
                if (v > 0) g.saisis++;
            }
            groupes.set(cle, g);
        }

        const liste = [...groupes.values()]
            .sort((a, b) => b.total - a.total || a.projet.localeCompare(b.projet, 'fr'));

        const total = arrondi(liste.reduce((s, g) => s + g.total, 0));
        const saisis = liste.reduce((s, g) => s + g.saisis, 0);

        telecharger(nomFichier('projets'), versCsv([
            ['Projet', 'Client', 'Total (jours)', 'Jours saisis'],
            ...liste.map(g => [g.projet, g.client, nombreCsv(arrondi(g.total)), String(g.saisis)]),
            ['Total', '', nombreCsv(total), String(saisis)],
        ]));
        notifier(`Export par projet : ${liste.length} projet(s), ${nombreCsv(total)} j`);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Import CSV
    // ─────────────────────────────────────────────────────────────────────────
    //
    //  ⚠ C'est la seule fonction du script qui écrit des temps, et elle le fait en masse.
    //  Elle est donc en DEUX temps, sans exception possible :
    //     1. analyse du fichier → aperçu détaillé des changements (rien n'est écrit)
    //     2. clic explicite sur « Appliquer » → écriture
    //  Même après écriture, rien n'est enregistré côté serveur tant que l'utilisateur
    //  n'a pas cliqué sur « Enregistrer » dans VSA : recharger la page annule tout.
    //
    //  Le fichier attendu est celui produit par « CSV détail par jour » : l'aller-retour
    //  export → tableur → import fonctionne tel quel.

    /** Retire le BOM en tete. Teste par code plutot que par regex litterale :
     *  pas de caractere invisible dans le source (cf. la constante BOM cote export). */
    const sansBom = s => (String(s).charCodeAt(0) === 0xFEFF ? String(s).slice(1) : String(s));

    /** Analyseur CSV conforme RFC 4180 (guillemets, séparateurs et sauts de ligne échappés). */
    function lireCsv(texte, sep) {
        const t = sansBom(texte);
        const lignesCsv = [];
        let champ = '', ligne = [], dansGuillemets = false;

        for (let i = 0; i < t.length; i++) {
            const c = t[i];
            if (dansGuillemets) {
                if (c === '"') {
                    if (t[i + 1] === '"') { champ += '"'; i++; }
                    else dansGuillemets = false;
                } else champ += c;
                continue;
            }
            if (c === '"') { dansGuillemets = true; continue; }
            if (c === sep) { ligne.push(champ); champ = ''; continue; }
            if (c === '\r') continue;
            if (c === '\n') { ligne.push(champ); lignesCsv.push(ligne); ligne = []; champ = ''; continue; }
            champ += c;
        }
        if (champ !== '' || ligne.length) { ligne.push(champ); lignesCsv.push(ligne); }
        return lignesCsv.filter(l => l.some(c => c.trim() !== ''));
    }

    /**
     * Séparateur du fichier reçu. On privilégie celui réglé par l'utilisateur, mais on
     * renifle si ce choix ne découpe visiblement rien : un fichier venu d'ailleurs ne
     * respecte pas forcément le réglage local, et échouer là-dessus serait pénible.
     */
    function sepImport(texte) {
        const tetes = sansBom(texte).split(/\r?\n/).slice(0, 4).join('\n');
        const score = s => tetes.split(s).length - 1;
        const choisi = sepCsv();
        if (score(choisi) >= 3) return choisi;
        return SEPS.reduce((a, b) => (score(b) > score(a) ? b : a), choisi);
    }

    /** Accepte les deux séparateurs décimaux, quel que soit le réglage d'export. */
    const nombreDepuisCsv = v => {
        const s = String(v ?? '').trim().replace(/\s/g, '').replace(',', '.');
        if (s === '') return 0;
        if (!/^-?\d*\.?\d+$/.test(s)) return null;
        const n = parseFloat(s);
        return isNaN(n) ? null : n;
    };

    /**
     * Analyse un CSV et prépare le plan d'écriture, SANS rien modifier.
     * @returns {{plan:Array, erreurs:string[], inconnus:string[], verrouillees:number, totalApres:Map}}
     */
    function analyserImport(texte) {
        const erreurs = [], inconnus = [], plan = [];
        let verrouillees = 0;

        const table = lireCsv(texte, sepImport(texte));
        if (table.length < 2) { erreurs.push('Fichier vide ou sans ligne de données.'); return { plan, erreurs, inconnus, verrouillees }; }

        const sansAcc = s => sansAccents(s).toLowerCase();

        // ── Repérage des lignes d'en-tête par leur CONTENU, et non par leur position.
        // L'export courant en compte deux (numéros de jour, puis abréviations) ; les
        // versions antérieures n'en avaient qu'une. Chercher plutôt que présumer rend
        // l'import compatible avec les deux, et tolérant à une ligne de titre ajoutée
        // à la main dans un tableur.
        const FENETRE = Math.min(6, table.length);
        const joursDeLigne = rang => {
            const cols = [];
            rang.forEach((c, i) => {
                const m = /^\s*(\d{1,2})\s*(?:\(|$|\s)/.exec(String(c).trim());
                const j = m ? parseInt(m[1], 10) : NaN;
                if (j >= 1 && j <= 31) cols.push({ col: i, jour: j });
            });
            return cols;
        };

        let ligneJours = -1, colsJour = [];
        for (let r = 0; r < FENETRE; r++) {
            const cols = joursDeLigne(table[r]);
            if (cols.length > colsJour.length) { colsJour = cols; ligneJours = r; }
        }
        if (colsJour.length < 2) {
            erreurs.push('Aucune ligne d\'en-tête contenant des numéros de jour n\'a été trouvée.');
            return { plan, erreurs, inconnus, verrouillees };
        }

        let ligneNoms = -1, colId = -1;
        for (let r = 0; r < FENETRE && colId < 0; r++) {
            const rang = table[r].map(c => sansAcc(String(c).trim()));
            let c = rang.indexOf('projet');
            if (c < 0) c = rang.indexOf('description');
            if (c >= 0) { colId = c; ligneNoms = r; }
        }
        if (colId < 0) {
            erreurs.push('Aucune colonne « Projet » ou « Description » dans l\'en-tête.');
            return { plan, erreurs, inconnus, verrouillees };
        }

        const premiereDonnee = Math.max(ligneJours, ligneNoms) + 1;

        const joursValides = new Set(joursDuMois());
        const horsMois = colsJour.filter(c => !joursValides.has(c.jour)).map(c => c.jour);
        if (horsMois.length) erreurs.push(`Jours absents du mois affiché, ignorés : ${horsMois.join(', ')}.`);

        const idx = indexLignes();

        for (let r = premiereDonnee; r < table.length; r++) {
            const rang = table[r];
            const brut = (rang[colId] || '').trim();
            if (!brut) continue;
            // Lignes de totaux : ignorées, qu'elles viennent de notre export ou d'une
            // formule ajoutée dans un tableur. Elles sont facultatives à l'import.
            // « tota » est le préfixe commun à total / totale / totaux / total par jour.
            if (/^tota(?:l|ux)/.test(sansAcc(brut))) continue;

            const cle = normCle(brut);
            const cible = idx.get(cle);
            if (!cible) { inconnus.push(brut); continue; }

            for (const { col, jour } of colsJour) {
                if (!joursValides.has(jour)) continue;
                // Colonne absente de CETTE ligne (ligne plus courte que l'en-tête) :
                // aucune information, donc on ne touche à rien. À distinguer d'une
                // cellule présente mais vide, qui vaut bien zéro. Sans cette garde, une
                // ligne tronquée — cas fréquent après édition en tableur — effacerait
                // les derniers jours du mois.
                if (col >= rang.length) continue;
                const val = nombreDepuisCsv(rang[col]);
                if (val === null) { erreurs.push(`Ligne ${r + 1}, jour ${jour} : « ${rang[col]} » n'est pas un nombre.`); continue; }
                if (val < 0) { erreurs.push(`Ligne ${r + 1}, jour ${jour} : valeur négative refusée.`); continue; }

                const el = document.getElementById(`input_day_((${cible.L}))_[[${jour}]]`);
                if (!el) continue;
                if (estVerrouillee(el)) { verrouillees++; continue; }

                const avant = arrondi(valeurJour(cible.L, jour));
                const apres = arrondi(val);
                if (avant !== apres) plan.push({ cle, brut, L: cible.L, jour, avant, apres });
            }
        }

        // Totaux par jour après application, pour signaler les journées > 1.
        const totalApres = new Map();
        for (const j of joursValides) {
            let t = 0;
            for (const tr of lignes()) {
                const L = idDe(tr);
                const chg = plan.find(p => p.L === L && p.jour === j);
                t += chg ? chg.apres : valeurJour(L, j);
            }
            totalApres.set(j, arrondi(t));
        }

        return { plan, erreurs, inconnus: [...new Set(inconnus)], verrouillees, totalApres };
    }

    /** Écrit le plan préparé. Rien d'autre n'est touché. */
    function appliquerImport(plan) {
        let n = 0;
        for (const p of plan) {
            const el = document.getElementById(`input_day_((${p.L}))_[[${p.jour}]]`);
            if (!el || estVerrouillee(el)) continue;
            el.value = String(p.apres).replace('.', ',');
            el.dispatchEvent(new Event('change', { bubbles: true }));   // totaux VSA à jour
            n++;
        }
        if (n) marquerModifie();
        return n;
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Intégration VSA
    // ─────────────────────────────────────────────────────────────────────────

    function marquerModifie() { if (typeof window.setModification === 'function') window.setModification(true); }
    function loader(t) { try { window.showLoader?.(document.body, t); } catch { } }
    function loaderOff() { try { window.hideLoader?.(document.body); } catch { } }
    function alerte(m) { window.alert(m); }
    function avertir(...a) { console.warn('[CRA]', ...a); }
    function avecMuet(fn) { muet = true; try { return fn(); } finally { setTimeout(() => { muet = false; }, 0); } }

    // ─────────────────────────────────────────────────────────────────────────
    //  Interface
    // ─────────────────────────────────────────────────────────────────────────

    const CSS = `
    .cra-grip{position:absolute;left:1px;top:8px;cursor:grab;color:#9a9da6;font-size:13px;
              line-height:1;user-select:none;letter-spacing:-1px}
    .cra-grip:hover{color:#333}
    .cra-grip:active{cursor:grabbing}
    #cra-fab{position:fixed;right:18px;bottom:18px;z-index:99998;background:#4dab91;color:#fff;
             border:0;border-radius:22px;padding:9px 15px;font:600 12px/1 system-ui,sans-serif;
             cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.28)}
    #cra-fab:hover{background:#3f9a81}
    #cra-panel{position:fixed;right:18px;bottom:62px;z-index:99999;width:370px;max-height:76vh;
               display:none;flex-direction:column;background:#fff;color:#222;border:1px solid #c5c5c5;
               border-radius:8px;box-shadow:0 6px 26px rgba(0,0,0,.22);font:12px/1.45 system-ui,sans-serif}
    #cra-panel.open{display:flex}
    #cra-panel h3{margin:0;padding:11px 13px;font-size:13px;border-bottom:1px solid #e6e6e6;
                  background:#f7f7f7;border-radius:8px 8px 0 0}
    #cra-panel .cra-body{overflow:auto;padding:9px 13px;flex:1}
    #cra-panel .cra-foot{border-top:1px solid #e6e6e6;padding:9px 13px;display:flex;flex-wrap:wrap;gap:6px}
    #cra-list{list-style:none;margin:0;padding:0}
    #cra-list li{display:flex;align-items:center;gap:7px;padding:5px 6px;border:1px solid #e6e6e6;
                 border-radius:5px;margin-bottom:5px;background:#fafafa}
    #cra-list li .g{cursor:grab;color:#9a9da6;letter-spacing:-1px}
    #cra-list li .t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #cra-list li .t small{display:block;color:#8a8a8a;font-size:10px;
                          overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #cra-list li .x{cursor:pointer;color:#ff6962;border:0;background:none;font-size:14px;padding:0 3px}
    #cra-list li.absent{opacity:.55}
    .cra-btn{border:1px solid #c5c5c5;background:#fff;border-radius:5px;padding:5px 9px;cursor:pointer;
             font:12px system-ui,sans-serif}
    .cra-btn:hover{border-color:#333}
    .cra-btn.p{background:#4dab91;border-color:#4dab91;color:#fff}
    .cra-btn.p:hover{background:#3f9a81}
    .cra-opt{display:flex;align-items:center;gap:6px;margin-top:5px;color:#555}
    .cra-opt code{background:#f0f0f0;padding:0 4px;border-radius:3px;font-size:10.5px;letter-spacing:1px}
    .cra-exports{display:flex;flex-wrap:wrap;gap:6px;margin-top:9px;padding-top:8px;
                 border-top:1px solid #eee}
    .cra-exports code{background:#f0f0f0;padding:0 3px;border-radius:3px;font-size:10px}
    table.cra-suivi{border-collapse:collapse;margin:2px 0 0 3px;font-size:11px;line-height:1.35}
    table.cra-suivi th{font-weight:400;color:#787878;text-align:left;padding:0 8px 0 0;white-space:nowrap}
    table.cra-suivi td.v{text-align:right;font-weight:600;color:#333;white-space:nowrap}
    table.cra-suivi tr:first-child td.v{font-size:13px}
    table.cra-suivi tr:first-child th{color:#555}
    table.cra-suivi td.p{text-align:right;padding-left:7px;color:#9a9da6;font-weight:400;
                         white-space:nowrap;font-size:10.5px}
    table.cra-suivi.depasse td.plan,
    table.cra-suivi.depasse td.pct{color:#c0392b}
    /* Ce tableau vit DANS la page VSA : il suit le thème de VSA (attribut sur <html>),
       pas la préférence système utilisée pour le panneau de l'assistant. */
    html[data-vs-theme="dark"] table.cra-suivi th{color:#9a9da6}
    html[data-vs-theme="dark"] table.cra-suivi td.v{color:#e8e8e8}
    html[data-vs-theme="dark"] table.cra-suivi tr:first-child th{color:#b8bbc4}
    html[data-vs-theme="dark"] table.cra-suivi td.p{color:#8a8d96}
    .cra-lignes-actions{display:flex;align-items:center;gap:8px;margin:2px 0 8px}
    .cra-btn.cra-mini{padding:2px 7px;font-size:11px}
    .cra-aide{color:#9a9da6;font-size:10.5px}
    #cra-list li.hors-modele{border-style:dashed;opacity:.9}
    #cra-list li .ic{border:0;background:none;cursor:pointer;font-size:12px;padding:0 1px;
                     line-height:1;filter:grayscale(1);opacity:.75}
    #cra-list li .ic:hover{filter:none;opacity:1}
    #cra-list li .ic.off{opacity:.45}
    #cra-list li .cw{position:relative;width:15px;height:15px;display:inline-block;flex:0 0 auto}
    #cra-list li .cw .chip.perso{border-width:2px;border-color:#787878}
    #cra-list li .cw .chip{position:absolute;inset:0;border:1px solid #c5c5c5;border-radius:50%;
                           font-size:8px;color:#c5c5c5;text-align:center;line-height:13px;overflow:hidden}
    #cra-list li .cw input[type=color]{position:absolute;inset:0;width:100%;height:100%;
                                       opacity:0;cursor:pointer;border:0;padding:0}
    .cra-err{color:#c0392b;background:#ff696215;border-left:3px solid #ff6962;
             padding:4px 7px;margin-top:5px;border-radius:0 4px 4px 0}
    .cra-ok{color:#2e7d5b;background:#4dab9118;border-left:3px solid #4dab91;
            padding:4px 7px;margin-top:5px;border-radius:0 4px 4px 0}
    .cra-note{color:#666;margin-top:6px}
    table.cra-diff{width:100%;border-collapse:collapse;margin-top:6px;font-size:11px}
    table.cra-diff td{padding:2px 4px;border-bottom:1px dotted #e6e6e6;white-space:nowrap}
    table.cra-diff td:first-child{max-width:130px;overflow:hidden;text-overflow:ellipsis}
    table.cra-diff td.a{color:#9a9da6;text-align:right}
    table.cra-diff td.b{color:#2e7d5b;font-weight:600;text-align:right}
    #cra-imp-fichier{width:100%;font-size:11px;margin-top:4px}
    #cra-imp-apercu{max-height:190px;overflow:auto;margin:4px 0}
    #cra-imp-appliquer:disabled{opacity:.45;cursor:not-allowed}
    details.cra-sec{margin-top:9px;border-top:1px solid #eee;padding-top:7px}
    details.cra-sec>summary{cursor:pointer;color:#555;font-weight:600;outline:none}
    .cra-f{display:grid;grid-template-columns:74px 1fr;gap:5px;align-items:center;margin-top:6px}
    .cra-f input,.cra-f textarea{width:100%;box-sizing:border-box;font:11px ui-monospace,monospace;
             padding:4px 5px;border:1px solid #c5c5c5;border-radius:4px;background:#fff;color:#222}
    .cra-f input.bad{border-color:#ff6962;background:#fff2f1}
    #cra-preview{margin-top:7px;font:11px ui-monospace,monospace;color:#555;max-height:130px;overflow:auto}
    #cra-preview div{padding:3px 0;border-bottom:1px dotted #e6e6e6}
    #cra-preview b{color:#4dab91;font-weight:600}
    #cra-preview i{color:#ff6962;font-style:normal}
    #cra-io{width:100%;height:96px;box-sizing:border-box;font:11px ui-monospace,monospace;
            border:1px solid #c5c5c5;border-radius:4px;padding:5px;margin-top:6px}
    #cra-toast{position:fixed;right:160px;bottom:20px;z-index:100000;background:#333;color:#fff;
               padding:7px 13px;border-radius:5px;font:12px system-ui,sans-serif;opacity:0;
               transition:opacity .2s;pointer-events:none}
    #cra-toast.on{opacity:.94}
    @media (prefers-color-scheme: dark){
      #cra-panel{background:#242424;color:#e8e8e8;border-color:#444}
      #cra-panel h3{background:#2e2e2e;border-color:#3a3a3a}
      #cra-panel .cra-foot{border-color:#3a3a3a}
      #cra-list li{background:#2b2b2b;border-color:#3a3a3a}
      .cra-btn{background:#2e2e2e;color:#e8e8e8;border-color:#4a4a4a}
      .cra-exports{border-color:#3a3a3a}
      .cra-exports code{background:#3a3a3a}
      .cra-lignes-actions{border-color:#3a3a3a}
      #cra-list li .cw .chip{border-color:#4a4a4a}
      table.cra-diff td{border-color:#3a3a3a}
      .cra-note{color:#aaa}
      .cra-err{color:#ff9b95}
      .cra-ok{color:#7fd4b5}
      .cra-f input,.cra-f textarea,#cra-io{background:#1e1e1e;color:#e8e8e8;border-color:#4a4a4a}
    }`;

    function injecterCss() {
        if (document.getElementById('cra-style')) return;
        const s = document.createElement('style');
        s.id = 'cra-style';
        s.textContent = CSS;
        document.head.appendChild(s);
    }

    function construirePanneau() {
        if (document.getElementById('cra-fab')) return;

        const fab = document.createElement('button');
        fab.id = 'cra-fab';
        fab.type = 'button';
        fab.textContent = '⠿ Lignes CRA';
        fab.addEventListener('click', () => {
            document.getElementById('cra-panel').classList.toggle('open');
            rafraichirPanneau();
        });

        const panel = document.createElement('div');
        panel.id = 'cra-panel';
        panel.innerHTML = `
          <h3>Modèle de lignes</h3>
          <div class="cra-body">
            <ul id="cra-list"></ul>
            <p id="cra-empty" style="color:#8a8a8a;margin:4px 0">
              Aucun modèle. Range tes lignes dans la feuille, puis « Capturer l'ordre actuel ».
            </p>

            <div class="cra-lignes-actions">
              <button class="cra-btn cra-mini" id="cra-tout-afficher" type="button">Tout afficher</button>
              <span class="cra-aide">👁 masquer · ⬤ couleur</span>
            </div>

            <label class="cra-opt"><input type="checkbox" id="cra-auto-ordre"> Réordonner automatiquement</label>
            <label class="cra-opt"><input type="checkbox" id="cra-auto-descr"> Remplir les descriptions vides</label>
            <label class="cra-opt" title="A=0  Z=0,25  E=0,5  R=0,75  T=1">
              <input type="checkbox" id="cra-raccourcis"> Raccourcis de saisie <code>A Z E R T</code>
            </label>
            <label class="cra-opt" style="padding-left:18px">
              <input type="checkbox" id="cra-avance"> …et avancer à la cellule suivante
            </label>
            <label class="cra-opt"><input type="checkbox" id="cra-suivi"> Tableau de suivi par ligne</label>
            <label class="cra-opt"><input type="checkbox" id="cra-coul-auto"> Couleur automatique par projet</label>
            <label class="cra-opt"><input type="checkbox" id="cra-bloq-we"> Verrouiller les samedis et dimanches</label>
            <label class="cra-opt"><input type="checkbox" id="cra-bloq-passe"> Verrouiller les jours passés</label>

            <div class="cra-exports">
              <button class="cra-btn" id="cra-exp-detail"  type="button" title="Une ligne par activité, une colonne par jour, totaux en pied et en marge">⭳ CSV détail par jour</button>
              <button class="cra-btn" id="cra-exp-projets" type="button" title="Total consommé sur le mois, regroupé par projet">⭳ CSV total par projet</button>
              <div class="cra-opt" style="flex-basis:100%;gap:8px">
                <label for="cra-csv-sep">Séparateur</label>
                <select id="cra-csv-sep">
                  <option value=";">point-virgule&nbsp;;</option>
                  <option value=",">virgule&nbsp;,</option>
                  <option value="	">tabulation</option>
                  <option value="|">barre verticale&nbsp;|</option>
                </select>
                <label for="cra-csv-dec">Décimale</label>
                <select id="cra-csv-dec">
                  <option value=",">virgule&nbsp;,</option>
                  <option value=".">point&nbsp;.</option>
                </select>
              </div>
            </div>

            <details class="cra-sec">
              <summary>Règle d'extraction de la clé</summary>
              <div class="cra-f">
                <label for="cra-motif">Motif</label>       <input id="cra-motif" spellcheck="false">
                <label for="cra-cle">Clé</label>           <input id="cra-cle" spellcheck="false">
                <label for="cra-descr">Description</label> <input id="cra-descr" spellcheck="false">
              </div>
              <p style="color:#8a8a8a;margin:6px 0 0">
                Expression régulière appliquée au libellé de mission.
                <code>$1</code> = 1<sup>er</sup> groupe capturé, <code>$0</code> = tout le motif.
              </p>
              <div id="cra-preview"></div>
              <button class="cra-btn" id="cra-regle-reset" type="button" style="margin-top:6px">Règle par défaut</button>
            </details>

            <details class="cra-sec">
              <summary>Import CSV</summary>
              <p style="color:#8a8a8a;margin:6px 0">
                Attendu : le fichier produit par « CSV détail par jour », éventuellement
                modifié dans un tableur. Les lignes sont reconnues par la colonne
                <b>Projet</b> ou <b>Description</b> ; elles doivent déjà exister dans la
                feuille (sinon, lancez « Appliquer au mois » d'abord).
              </p>
              <input type="file" id="cra-imp-fichier" accept=".csv,text/csv,text/plain">
              <div id="cra-imp-apercu"></div>
              <button class="cra-btn" id="cra-imp-appliquer" type="button" disabled>Appliquer l'import</button>
            </details>

            <details class="cra-sec">
              <summary>Avancé</summary>
              <div class="cra-f">
                <label for="cra-descr-vides">Desc. vides</label> <input id="cra-descr-vides" spellcheck="false">
                <label for="cra-delai">Délai AJAX</label>        <input id="cra-delai" type="number" min="0" max="5000" step="50">
              </div>
              <p style="color:#8a8a8a;margin:6px 0 0">
                <b>Desc. vides</b> : valeurs (séparées par des virgules) traitées comme une
                description vide, donc remplaçables automatiquement. Utile si votre instance
                préremplit ce champ avec un gabarit.<br>
                <b>Délai AJAX</b> : millisecondes de repos après chaque choix de tiers ou de
                mission. À augmenter si la création automatique de lignes échoue par intermittence.
              </p>
            </details>

            <details class="cra-sec">
              <summary>Import / export du modèle</summary>
              <textarea id="cra-io" spellcheck="false"></textarea>
              <div style="display:flex;gap:6px;margin-top:6px">
                <button class="cra-btn" id="cra-export" type="button">Exporter</button>
                <button class="cra-btn" id="cra-import" type="button">Importer</button>
              </div>
            </details>
          </div>
          <div class="cra-foot">
            <button class="cra-btn p" id="cra-apply"   type="button">Appliquer au mois</button>
            <button class="cra-btn"   id="cra-capture" type="button">Capturer l'ordre actuel</button>
            <button class="cra-btn"   id="cra-forcer"  type="button">Forcer les descriptions</button>
            <button class="cra-btn"   id="cra-clear"   type="button">Vider</button>
          </div>`;

        document.body.append(fab, panel);

        // ⚠ ne pas nommer cette variable « notifier » : elle masquerait la fonction.
        const elToast = document.createElement('div');
        elToast.id = 'cra-toast';
        document.body.append(elToast);

        const q = sel => panel.querySelector(sel);

        q('#cra-apply').addEventListener('click', appliquerModele);

        q('#cra-capture').addEventListener('click', () => {
            capturerModele();
            rafraichirPanneau();
            notifier(`Modèle capturé (${modele.length} ligne(s))`);
        });

        q('#cra-forcer').addEventListener('click', () => {
            const n = appliquerDescriptions(true);
            notifier(n ? `${n} description(s) mise(s) à jour` : 'Aucune modification');
        });

        q('#cra-clear').addEventListener('click', () => {
            if (!confirm('Effacer le modèle enregistré ?')) return;
            modele = [];
            sauverModele();
            rafraichirPanneau();
        });

        q('#cra-exp-detail').addEventListener('click', exporterDetail);
        q('#cra-exp-projets').addEventListener('click', exporterProjets);

        q('#cra-tout-afficher').addEventListener('click', () => {
            toutAfficher();
            notifier('Toutes les lignes sont affichées');
        });

        const co = q('#cra-auto-ordre'), cd = q('#cra-auto-descr');
        const rc = q('#cra-raccourcis');
        rc.checked = reglages.raccourcisSaisie;
        rc.addEventListener('change', () => { reglages.raccourcisSaisie = rc.checked; sauverReglages(); });

        const av = q('#cra-avance');
        av.checked = reglages.avanceAuto;
        av.addEventListener('change', () => { reglages.avanceAuto = av.checked; sauverReglages(); });

        const sv = q('#cra-suivi');
        sv.checked = reglages.suiviLigne;
        sv.addEventListener('change', () => {
            reglages.suiviLigne = sv.checked;
            sauverReglages();
            injecterSuivi();
        });

        const ca = q('#cra-coul-auto');
        ca.checked = reglages.couleursAuto;
        ca.addEventListener('change', () => {
            reglages.couleursAuto = ca.checked;
            sauverReglages();
            appliquerApparence();
            rafraichirPanneau();
        });

        const bw = q('#cra-bloq-we'), bp = q('#cra-bloq-passe');
        co.checked = reglages.autoOrdre;
        cd.checked = reglages.autoDescr;
        bw.checked = reglages.bloquerWeekend;
        bp.checked = reglages.bloquerPasse;
        co.addEventListener('change', () => { reglages.autoOrdre = co.checked; sauverReglages(); });
        cd.addEventListener('change', () => { reglages.autoDescr = cd.checked; sauverReglages(); });

        // Format CSV : séparateur et décimale, appliqués à l'export comme à l'import.
        const cs = q('#cra-csv-sep'), cdec = q('#cra-csv-dec');
        const majFormat = () => {
            reglages.csvSep = cs.value;
            reglages.csvDecimal = cdec.value;
            sauverReglages();
            // decCsv() bascule d'office si les deux coïncident : on reflète ce choix.
            cdec.value = decCsv();
        };
        cs.value = sepCsv();
        cdec.value = decCsv();
        cs.addEventListener('change', majFormat);
        cdec.addEventListener('change', majFormat);
        bw.addEventListener('change', () => { reglages.bloquerWeekend = bw.checked; sauverReglages(); appliquerVerrous(); });
        bp.addEventListener('change', () => { reglages.bloquerPasse = bp.checked; sauverReglages(); appliquerVerrous(); });

        // ── import CSV : analyse puis application, en deux temps
        let planImport = null;
        const fich = q('#cra-imp-fichier'), apercu = q('#cra-imp-apercu'), btnImp = q('#cra-imp-appliquer');

        fich.addEventListener('change', async () => {
            planImport = null;
            btnImp.disabled = true;
            apercu.innerHTML = '';
            const f = fich.files?.[0];
            if (!f) return;
            try {
                const res = analyserImport(await f.text());
                planImport = res.plan;
                apercu.innerHTML = rendreApercuImport(res);
                btnImp.disabled = !res.plan.length;
            } catch (e) {
                apercu.innerHTML = '<div class="cra-err">Lecture impossible : ' + echapper(e.message) + '</div>';
            }
        });

        btnImp.addEventListener('click', () => {
            if (!planImport?.length) return;
            if (!confirm(`Écrire ${planImport.length} cellule(s) ?\n\n`
                + 'Rien ne sera enregistré : il faudra cliquer sur « Enregistrer » dans VSA.\n'
                + 'Recharger la page annule l\'opération.')) return;
            const n = appliquerImport(planImport);
            planImport = null;
            btnImp.disabled = true;
            fich.value = '';
            apercu.innerHTML = '<div class="cra-ok">' + n + ' cellule(s) écrite(s). Pensez à enregistrer dans VSA.</div>';
            notifier(n + ' cellule(s) importée(s)');
        });

        // ── éditeur de règle
        const im = q('#cra-motif'), ic = q('#cra-cle'), id_ = q('#cra-descr');
        const chargerRegle = () => {
            im.value = reglages.regle.motif;
            ic.value = reglages.regle.cle;
            id_.value = reglages.regle.descr;
        };
        chargerRegle();

        const majRegle = () => {
            reglages.regle.motif = im.value;
            reglages.regle.cle = ic.value;
            reglages.regle.descr = id_.value;
            _regexSrc = null;                       // invalide le cache de compilation
            im.classList.toggle('bad', !regex());
            sauverReglages();
            rafraichirApercu();
            rafraichirPanneau();
        };
        [im, ic, id_].forEach(el => el.addEventListener('input', majRegle));

        // ── options avancées
        const iv = q('#cra-descr-vides'), idl = q('#cra-delai');
        iv.value = reglages.descrVides;
        idl.value = reglages.delaiMs;
        iv.addEventListener('input', () => { reglages.descrVides = iv.value; sauverReglages(); });
        idl.addEventListener('input', () => {
            const n = parseInt(idl.value, 10);
            reglages.delaiMs = Number.isFinite(n) && n >= 0 ? Math.min(n, 5000) : DEFAUTS.delaiMs;
            sauverReglages();
        });

        q('#cra-regle-reset').addEventListener('click', () => {
            reglages.regle = { ...REGLE_DEFAUT };
            _regexSrc = null;
            sauverReglages();
            chargerRegle();
            im.classList.remove('bad');
            rafraichirApercu();
            rafraichirPanneau();
        });

        // ── import / export
        q('#cra-export').addEventListener('click', () => {
            q('#cra-io').value = JSON.stringify({ regle: reglages.regle, modele }, null, 2);
            notifier('Modèle exporté dans la zone de texte');
        });

        q('#cra-import').addEventListener('click', () => {
            const txt = q('#cra-io').value.trim();
            if (!txt) return alerte('Colle d\'abord un modèle exporté dans la zone de texte.');
            let data;
            try { data = JSON.parse(txt); }
            catch (e) { return alerte('JSON invalide : ' + e.message); }

            const lu = Array.isArray(data) ? data : data.modele;
            if (!Array.isArray(lu)) return alerte('Format inattendu : « modele » doit être un tableau.');

            if (data.regle) { reglages.regle = { ...REGLE_DEFAUT, ...data.regle }; _regexSrc = null; sauverReglages(); chargerRegle(); }
            modele = lu.filter(e => e && e.cle).map(e => ({
                cle: String(e.cle), brut: String(e.brut || e.cle), titre: String(e.titre || ''),
                tiers: String(e.tiers || ''), viaMission: e.viaMission !== false,
            }));
            sauverModele();
            rafraichirApercu();
            rafraichirPanneau();
            notifier(`${modele.length} entrée(s) importée(s)`);
        });

        if ($?.fn?.sortable) {
            $(q('#cra-list')).sortable({
                // Les entrées hors modèle sont listées pour l'œil et la couleur, mais
                // n'ont pas de rang : les inclure ici corromprait le modèle.
                items: '> li:not(.hors-modele)',
                handle: '.g',
                axis: 'y',
                update: () => {
                    const ordre = [...panel.querySelectorAll('#cra-list li:not(.hors-modele)')]
                        .map(li => li.dataset.cle);
                    const trie = ordre.map(c => modele.find(e => e.cle === c)).filter(Boolean);
                    // Filet : on ne remplace le modèle que si rien n'a été perdu.
                    if (trie.length === modele.length) {
                        modele = trie;
                        sauverModele();
                        if (reglages.autoOrdre) appliquerOrdre();
                    }
                },
            });
        }
    }

    /** Aperçu live de la règle sur les lignes réellement présentes. */
    function rafraichirApercu() {
        const box = document.getElementById('cra-preview');
        if (!box) return;
        box.innerHTML = '';

        if (!regex()) { box.innerHTML = '<div><i>Motif invalide</i></div>'; return; }

        const rangs = lignes();
        if (!rangs.length) { box.innerHTML = '<div><i>Aucune ligne dans la feuille</i></div>'; return; }

        for (const tr of rangs) {
            const titre = titreDe(idDe(tr));
            const ex = extraire(titre);
            const d = document.createElement('div');
            if (ex.trouve) {
                d.innerHTML = `clé <b>${echapper(ex.brut)}</b> · descr. <b>${echapper(ex.descr) || '—'}</b>`;
            } else {
                d.innerHTML = `<i>aucune correspondance</i> — repli sur le libellé entier`;
            }
            d.title = titre;
            box.appendChild(d);
        }
    }

    const echapper = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    /** Aperçu de l'import : ce qui va changer, et ce qui bloque. Aucun effet de bord. */
    function rendreApercuImport(res) {
        const { plan, erreurs, inconnus, verrouillees, totalApres } = res;
        let h = '';

        for (const e of erreurs) h += '<div class="cra-err">' + echapper(e) + '</div>';
        if (inconnus.length) {
            h += '<div class="cra-err">Aucune ligne correspondante dans la feuille pour : '
                + inconnus.map(echapper).join(', ') + '</div>';
        }
        if (verrouillees) h += '<div class="cra-err">' + verrouillees + ' cellule(s) ignorée(s) car verrouillée(s).</div>';

        if (!plan.length) {
            h += '<div class="cra-note">Aucun changement à appliquer.</div>';
            return h;
        }

        const depassements = [...(totalApres || new Map())].filter(([, t]) => t > 1);
        if (depassements.length) {
            h += '<div class="cra-err">Après import, ces jours dépasseraient 1 : '
                + depassements.map(([j, t]) => `${j} (${nombreCsv(t)})`).join(', ') + '</div>';
        }

        const parLigne = new Map();
        for (const p of plan) parLigne.set(p.brut, (parLigne.get(p.brut) || 0) + 1);

        h += '<div class="cra-note"><b>' + plan.length + ' cellule(s)</b> sur '
            + parLigne.size + ' ligne(s) — rien n\'est encore écrit.</div>';
        h += '<table class="cra-diff"><tbody>';
        for (const p of plan.slice(0, 40)) {
            h += '<tr><td>' + echapper(p.brut) + '</td><td>j' + p.jour + '</td>'
                + '<td class="a">' + nombreCsv(p.avant) + '</td><td>→</td>'
                + '<td class="b">' + nombreCsv(p.apres) + '</td></tr>';
        }
        h += '</tbody></table>';
        if (plan.length > 40) h += '<div class="cra-note">… et ' + (plan.length - 40) + ' autre(s).</div>';
        return h;
    }

    function rafraichirPanneau() {
        const ul = document.getElementById('cra-list');
        if (!ul) return;

        const idx = indexLignes();
        ul.innerHTML = '';

        for (const e of modele) {
            ul.appendChild(construireEntree(e, !!resoudre(e, idx), true));
        }

        // Lignes présentes dans la feuille mais absentes du modèle : on les liste quand
        // même, pour pouvoir les masquer, les colorer ou les ajouter au modèle.
        for (const [cle, hit] of idx) {
            if (modele.some(m => m.cle === cle)) continue;
            const e = entreeDepuisLigne(hit.L);
            if (e) ul.appendChild(construireEntree(e, true, false));
        }

        const vide = document.getElementById('cra-empty');
        if (vide) vide.style.display = (modele.length || idx.size) ? 'none' : '';
        rafraichirApercu();
    }

    /**
     * Une entrée de la liste : poignée, œil, couleur, libellé, action.
     * @param {boolean} present    la ligne existe dans le mois affiché
     * @param {boolean} dansModele l'entrée fait partie du modèle enregistré
     */
    function construireEntree(e, present, dansModele) {
        const app = appDe(e);
        const li = document.createElement('li');
        li.dataset.cle = e.cle;
        if (!present) li.classList.add('absent');
        if (!dansModele) li.classList.add('hors-modele');

        const g = document.createElement('span');
        g.className = 'g';
        g.textContent = dansModele ? '⠿' : '·';
        if (!dansModele) g.style.cursor = 'default';

        // ── œil : masquage visuel, sans effet sur les données ni sur l'enregistrement
        const oeil = document.createElement('button');
        oeil.type = 'button';
        oeil.className = 'ic' + (app.masque ? ' off' : '');
        oeil.textContent = app.masque ? '🙈' : '👁';
        oeil.title = app.masque ? 'Afficher cette ligne' : 'Masquer cette ligne (les temps sont conservés)';
        oeil.addEventListener('click', () => majApparence(e, { masque: !app.masque }));

        // ── couleur de fond
        const effective = couleurEffective(e);
        const boite = document.createElement('span');
        boite.className = 'cw';
        const pastille = document.createElement('span');
        pastille.className = 'chip' + (app.couleur ? ' perso' : '');
        pastille.style.background = effective ? normaliserTeinte(effective) : 'transparent';
        if (!effective) pastille.textContent = '⬤';

        const pick = document.createElement('input');
        pick.type = 'color';
        pick.value = effective || PALETTE[0];
        pick.title = app.couleur ? 'Couleur personnalisée' : 'Couleur automatique — cliquez pour personnaliser';

        // « input » se déclenche en continu pendant le glissement : on se contente
        // d'un aperçu, sans enregistrer ni reconstruire la liste (ce qui détruirait
        // ce champ et figerait la couleur). L'enregistrement a lieu sur « change ».
        pick.addEventListener('input', () => {
            pastille.style.background = normaliserTeinte(pick.value);
            pastille.textContent = '';
            apercuCouleur(e, pick.value);
        });
        pick.addEventListener('change', () => majApparence(e, { couleur: pick.value }));
        boite.append(pastille, pick);

        const raz = document.createElement('button');
        raz.type = 'button';
        raz.className = 'ic';
        raz.textContent = '⌫';
        raz.title = reglages.couleursAuto
            ? 'Revenir à la couleur automatique'
            : 'Retirer la couleur';
        raz.style.display = app.couleur ? '' : 'none';
        raz.addEventListener('click', () => majApparence(e, { couleur: null }));

        const t = document.createElement('div');
        t.className = 't';
        t.title = e.titre || e.cle;
        t.textContent = etiquette(e);
        const sub = document.createElement('small');
        sub.textContent = !present ? e.cle + ' — absente du mois'
            : !dansModele ? e.cle + ' — hors modèle'
                : e.cle;
        t.appendChild(sub);

        const act = document.createElement('button');
        act.type = 'button';
        act.className = 'x';
        if (dansModele) {
            act.textContent = '×';
            act.title = 'Retirer du modèle';
            act.addEventListener('click', () => {
                modele = modele.filter(m => m.cle !== e.cle);
                sauverModele();
                rafraichirPanneau();
            });
        } else {
            act.textContent = '+';
            act.style.color = '#4dab91';
            act.title = 'Ajouter au modèle';
            act.addEventListener('click', () => {
                modele.push(e);
                sauverModele();
                rafraichirPanneau();
            });
        }

        li.append(g, oeil, boite, raz, t, act);
        return li;
    }

    let minuteurToast;
    function notifier(msg) {
        const el = document.getElementById('cra-toast');
        if (!el) return;
        el.textContent = msg;
        el.classList.add('on');
        clearTimeout(minuteurToast);
        minuteurToast = setTimeout(() => el.classList.remove('on'), 2200);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Amorçage & ré-accrochage
    // ─────────────────────────────────────────────────────────────────────────

    function amorcer() {
        if (amorcage || !tbody()) return false;

        // Nos propres mutations ne doivent pas relancer l'observer.
        amorcage = true;
        muet = true;
        try {
            injecterCss();
            construirePanneau();
            injecterPoignees();
            initTri();
            installerGardeSelect();
            installerRaccourcis();

            if (reglages.autoOrdre) appliquerOrdre();
            if (reglages.autoDescr) appliquerDescriptions(false);

            injecterSuivi();        // tableau de consommation par ligne
            appliquerApparence();   // masquage + couleurs
            appliquerVerrous();     // week-end / passé

            rafraichirPanneau();
        } finally {
            amorcage = false;
            setTimeout(() => { muet = false; }, 0);
        }
        return true;
    }

    /**
     * attachSubmitAction() est rappelée par TOUS les chemins de re-render
     * (application d'un filtre, gridReload après enregistrement).
     */
    function accrocherVsa() {
        const orig = window.attachSubmitAction;
        if (typeof orig !== 'function' || orig.__craHooked) return typeof orig === 'function';
        const enveloppe = function () {
            const r = orig.apply(this, arguments);
            setTimeout(amorcer, 60);
            return r;
        };
        enveloppe.__craHooked = true;
        window.attachSubmitAction = enveloppe;
        return true;
    }

    /** Ceinture et bretelles : le conteneur de grille est remplacé en entier par le filtre. */
    function observerGrille() {
        const cible = document.getElementById('grid_UITimesheetPivot') || document.body;
        let t;
        new MutationObserver(() => {
            if (muet) return;
            clearTimeout(t);
            t = setTimeout(() => { accrocherVsa(); amorcer(); }, 180);
        }).observe(cible, { childList: true, subtree: true });
    }

    (function demarrer(essai = 0) {
        if (!window.jQuery || !document.getElementById('grid_thead_table_crapivot')) {
            if (essai < 40) return setTimeout(() => demarrer(essai + 1), 250);
            return avertir('jQuery ou grille CRA introuvable — script désactivé');
        }
        accrocherVsa();
        observerGrille();
        amorcer();
        console.info('[CRA] userscript actif —', modele.length, 'ligne(s) au modèle',
            '| règle:', reglages.regle.motif);
    })();

})();
