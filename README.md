# VSA CRA — assistant de saisie

[![Licence MIT](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/erim32/addon-vsactivity-cra/actions/workflows/ci.yml/badge.svg)](https://github.com/erim32/addon-vsactivity-cra/actions/workflows/ci.yml)
[![Installer le userscript](https://img.shields.io/badge/installer-userscript-brightgreen.svg)](https://raw.githubusercontent.com/erim32/addon-vsactivity-cra/main/vsa-cra-helper.user.js)

Userscript pour la **feuille de temps (CRA)** de [VSA / VSActivity](https://www.vsactivity.com).

La grille native impose l'ordre de ses lignes, ne propose aucun modèle réutilisable d'un mois
sur l'autre et n'offre pas d'export. Ce script ajoute ces trois choses, sans rien changer au
fonctionnement de VSA.

| | |
|---|---|
| **Ordre des lignes** | Rangez vos activités au glisser-déposer. L'ordre est mémorisé et réappliqué à chaque affichage. |
| **Modèle de mois** | Enregistrez votre liste d'activités habituelle, puis recréez-la en un clic sur un mois vide. |
| **Description automatique** | Le champ description est rempli à partir du libellé de la mission, via une règle que vous définissez. |
| **Exports CSV** | Un export détaillé jour par jour, un export du total consommé par projet. |
| **Import CSV** | Remplissage en masse depuis un fichier, avec aperçu obligatoire avant écriture. |
| **Affichage** | Masquez ou colorez chaque ligne, verrouillez les week-ends et les jours passés. |
| **Suivi par ligne** | Consommé du mois, cumul planifié et volume vendu, réunis sous chaque activité. |
| **Saisie au clavier** | Une touche par valeur — `A`=0, `Z`=0,25, `E`=0,5, `R`=0,75, `T`=1 — et le focus avance tout seul. |

> **Aucune donnée ne sort de votre navigateur.** Le script ne contacte aucun serveur externe.
> Vos réglages restent dans le `localStorage` du navigateur, et les fichiers CSV sont générés
> localement puis téléchargés par vos soins.

---

## Sommaire

- [Installation](#installation)
- [Premier usage](#premier-usage)
- [La règle d'extraction](#la-règle-dextraction)
- [Utilisation au quotidien](#utilisation-au-quotidien)
- [Saisie rapide au clavier](#saisie-rapide-au-clavier)
- [Les exports CSV](#les-exports-csv)
- [Le tableau de suivi par ligne](#le-tableau-de-suivi-par-ligne)
- [Personnaliser l'affichage des lignes](#personnaliser-laffichage-des-lignes)
- [Verrouiller des cellules](#verrouiller-des-cellules)
- [Import CSV](#import-csv)
- [Tous les réglages](#tous-les-réglages)
- [Transférer sa configuration](#transférer-sa-configuration)
- [En cas de problème](#en-cas-de-problème)
- [Ce que le script ne fait jamais](#ce-que-le-script-ne-fait-jamais)
- [Limites connues](#limites-connues)
- [Contribuer](#contribuer)
- [Licence](#licence)

---

## Installation

### 1. Installer un gestionnaire de userscripts

Il vous faut une extension capable d'exécuter des userscripts :

| Extension | Navigateurs |
|---|---|
| [Tampermonkey](https://www.tampermonkey.net/) *(recommandé)* | Chrome, Edge, Firefox, Safari, Opera |
| [Violentmonkey](https://violentmonkey.github.io/) | Chrome, Edge, Firefox |

> ⚠️ Sur un poste professionnel, vérifiez au préalable que l'installation d'extensions est
> autorisée par la politique informatique de votre entreprise.

### 2. Installer le script

**➜ [Installer `vsa-cra-helper.user.js`](https://raw.githubusercontent.com/erim32/addon-vsactivity-cra/main/vsa-cra-helper.user.js)**

L'extension intercepte le lien et ouvre son écran d'installation. Vérifiez au
passage que les autorisations annoncées se limitent au `@match` sur
`*.vsactivity.com`, puis confirmez.

<details>
<summary><b>Installation manuelle</b> — si le lien n'est pas intercepté</summary>

<br>

1. Ouvrez le tableau de bord de l'extension → **Créer un nouveau script**
2. Effacez le contenu proposé par défaut
3. Collez l'intégralité de [`vsa-cra-helper.user.js`](vsa-cra-helper.user.js)
4. **Fichier → Enregistrer** (ou `Ctrl+S`)

Installé ainsi, le script **ne se met pas à jour tout seul** : il faudra recoller
le fichier à chaque nouvelle version.

</details>

### 3. Vérifier

Ouvrez votre feuille de temps VSA. Un bouton vert **« ⠿ Lignes CRA »** doit apparaître
en bas à droite de la page.

S'il n'apparaît pas, voir [En cas de problème](#en-cas-de-problème).

### Mises à jour

Installé par le lien ci-dessus, le script se met à jour tout seul : il déclare un
`@updateURL`, que le gestionnaire de userscripts interroge périodiquement avant
de vous proposer la nouvelle version. Les changements de chaque version sont
listés dans [CHANGELOG.md](CHANGELOG.md).

C'est la **seule** connexion sortante de l'ensemble, et elle est le fait de
l'extension, pas du script. Elle se coupe dans les réglages du gestionnaire
(Tampermonkey → *Réglages → Mise à jour → Rechercher des mises à jour : jamais*).

### Instance sur un domaine propre

Le script s'active par défaut sur les adresses en `*.vsactivity.com`. Si votre entreprise
héberge VSA sur son propre domaine, ajoutez une ligne dans le bloc de métadonnées, tout en
haut du script :

```js
// @match        https://cra.example.com/o_services/timesheetspivot/*
```

en remplaçant `cra.example.com` par votre nom d'hôte, puis enregistrez.

---

## Premier usage

L'ordre compte : commencez sur **un mois déjà saisi**, pour que le script ait de quoi
travailler.

### Étape 1 — Vérifier la règle d'extraction

Cliquez sur **« ⠿ Lignes CRA »**, dépliez **« Règle d'extraction de la clé »**.

Un aperçu affiche, pour chaque ligne de votre feuille, la **clé** et la **description** que
le script en déduit :

```
clé PROJET-ALPHA · descr. PROJET-ALPHA
clé PROJET-BETA  · descr. PROJET-BETA
```

Ces clés doivent identifier vos projets de façon lisible et **stable dans le temps**.
Si l'aperçu affiche « aucune correspondance » ou des valeurs illisibles, ajustez le motif —
voir [La règle d'extraction](#la-règle-dextraction).

### Étape 2 — Ranger les lignes

Chaque ligne de la grille porte maintenant une poignée **⠿** à gauche.
Glissez-déposez les lignes dans l'ordre qui vous convient.

### Étape 3 — Capturer le modèle

Cliquez sur **« Capturer l'ordre actuel »**. La liste s'affiche dans le panneau : c'est
votre modèle. Il est enregistré immédiatement.

### Étape 4 — L'appliquer à un nouveau mois

Le mois suivant, ouvrez le mois vide et cliquez sur **« Appliquer au mois »**.
Le script crée les lignes manquantes dans votre ordre, sélectionne les bonnes missions et
remplit les descriptions.

> Rien n'est enregistré automatiquement : **cliquez ensuite sur « Enregistrer » dans VSA.**

---

## La règle d'extraction

C'est le cœur du script. Elle sert à deux choses :

- **identifier** une ligne d'un mois sur l'autre (la « clé ») ;
- **remplir** le champ description.

### Pourquoi pas simplement le libellé complet ?

Dans beaucoup d'instances, le libellé d'une mission ressemble à ceci :

```
REF-00123 [du 01/03/26 au 30/09/26 (PROJET-ALPHA) - Assistance technique] : Intitulé >>> 12/30
```

Deux parties bougent avec le temps : le compteur final (`>>> 12/30`, jours consommés sur
jours vendus) change **à chaque imputation**, et la référence de commande change au
**renouvellement** de la mission. Un modèle indexé sur le libellé entier casserait au premier
jour saisi ; indexé sur l'identifiant interne, il casserait au changement de contrat.

D'où le principe : **la clé est une *partie* du libellé**, celle qui identifie durablement
le projet. Par défaut, ce qui se trouve entre parenthèses.

### Les trois champs

| Champ | Défaut | Rôle |
|---|---|---|
| **Motif** | `\(([^)]*)\)` | Expression régulière appliquée au libellé de la mission |
| **Clé** | `$1` | Gabarit du fragment identifiant |
| **Description** | `$1` | Gabarit de la valeur écrite dans le champ description |

`$0` désigne tout ce que le motif a capturé, `$1` le premier groupe entre parenthèses de la
regex, `$2` le deuxième, etc.

### Exemples

| Format du libellé | Motif | Clé obtenue |
|---|---|---|
| `… (PROJET-ALPHA) …` | `\(([^)]*)\)` | `PROJET-ALPHA` |
| `MISSION [ALPHA-2026] chez …` | `\[([^\]]*)\]` | `ALPHA-2026` |
| `PRJ4412 — Refonte SI` | `^([A-Z]{2,}\d+)` | `PRJ4412` |
| `REF-1 [dates] : Intitulé >>> 3/10` | ` : (.+?)(?: >>>\|$)` | `Intitulé` |

La description peut différer de la clé. Avec le motif `\(([^-)]*)-([^)]*)\)` sur
`… (ALPHA-Dupont) …` :

- Clé `$1` → `ALPHA`
- Description `$1 / $2` → `ALPHA / Dupont`

### Bon à savoir

- Un motif invalide **surligne le champ en rouge** sans casser le script.
- Si le motif ne correspond à rien (activité interne type « Formation », sans parenthèses),
  la clé de repli est le libellé entier et **aucune description n'est écrite** — le script
  n'invente pas de valeur.
- Pour la comparaison uniquement, les clés sont mises en minuscules et les espaces autour
  des tirets supprimés : `ALPHA - Dupont` et `ALPHA-Dupont` sont donc considérés identiques.
  Le texte réellement écrit dans la description reste tel quel.
- **« Règle par défaut »** restaure les trois champs.

---

## Utilisation au quotidien

### Le panneau

Bouton **« ⠿ Lignes CRA »** en bas à droite.

| Bouton | Effet |
|---|---|
| **Appliquer au mois** | Crée les lignes du modèle absentes du mois, dans l'ordre, puis remplit toutes les descriptions |
| **Capturer l'ordre actuel** | Remplace le modèle par l'ordre actuellement affiché |
| **Forcer les descriptions** | Réécrit **toutes** les descriptions, y compris celles saisies à la main |
| **Vider** | Efface le modèle enregistré (demande confirmation) |

Dans la liste du panneau, chaque entrée peut être réordonnée par sa poignée **⠿** ou retirée
par la croix **×**. Une entrée grisée signale un projet du modèle **absent du mois affiché**.

### Automatismes

Deux cases, actives par défaut :

- **Réordonner automatiquement** — l'ordre du modèle est réappliqué à chaque affichage
  (changement de mois, après enregistrement). Cette opération **n'écrit aucune donnée**,
  elle ne fait que déplacer des lignes à l'écran.
- **Remplir les descriptions vides** — seules les descriptions **vides** sont complétées.
  Un texte que vous avez saisi n'est jamais écrasé automatiquement ; il faut le bouton
  « Forcer les descriptions ».

### Glisser-déposer

Deux endroits, même effet : la poignée **⠿** sur les lignes de la grille, et celle des
entrées du panneau. Dans les deux cas le modèle est mis à jour et enregistré aussitôt.

---

## Saisie rapide au clavier

Sur une cellule de jour qui a le focus, **une seule touche** pose la valeur :

| Touche | Valeur | |
|---|---|---|
| `A` | `0` | rien |
| `Z` | `0,25` | quart de journée |
| `E` | `0,5` | demi-journée |
| `R` | `0,75` | trois quarts |
| `T` | `1` | journée complète |

Majuscules et minuscules fonctionnent indifféremment. Ce sont les cinq premières touches de
la rangée du haut d'un clavier AZERTY : la main gauche couvre toute l'échelle sans bouger,
pendant que la droite reste sur `Tab` pour passer au jour suivant.

### L'avancement automatique

Après la frappe, le focus passe **à la cellule suivante** et son contenu est sélectionné.
Remplir une semaine ne demande donc que cinq touches, sans un seul `Tab` :

```
t t e t a     →  lundi 1 · mardi 1 · mercredi 0,5 · jeudi 1 · vendredi 0
```

L'ordre suivi est celui de la lecture : le reste du mois sur la ligne courante, puis la ligne
suivante depuis son premier jour. Sur la toute dernière cellule de la grille, le focus reste
en place.

L'avancement **saute ce qui n'est pas saisissable** — cellules verrouillées, jours hors
période d'une mission, lignes masquées — pour ne jamais déposer le focus dans un champ où la
touche suivante n'aurait aucun effet. Avec le verrou des week-ends actif, passer du vendredi
mène directement au lundi.

Ce comportement se désactive séparément, par la case **« …et avancer à la cellule
suivante »** : les raccourcis restent alors actifs, mais le focus ne bouge plus.

### Ce qui reste intact

- **Les combinaisons du navigateur.** `Ctrl+A` sélectionne toujours tout, `Ctrl+Z` annule.
  Seule la touche seule est interceptée.
- **Les autres touches.** Chiffres, `Tab`, flèches, `Retour arrière` : rien n'est capté.
  Vous pouvez toujours taper une valeur au clavier normalement.
- **Le reste de la page.** Les raccourcis n'agissent que sur les cellules de jour de la
  grille — ni le champ description, ni les réglages du panneau ne sont concernés.

### Cas particuliers

- **Cellule verrouillée** (week-end, jour passé, hors période de mission) : la valeur n'est
  pas modifiée, et la touche est tout de même absorbée pour que la lettre ne s'inscrive pas
  dans un champ censé être en lecture seule.
- **Ligne affichée en heures** : la valeur est convertie avec le barème du jour, pour que
  `T` signifie toujours « une journée complète ». Sur une base de 7,18 h, `T` inscrit `7,18`
  et `E` inscrit `3,59`.

Le tout se désactive par la case **« Raccourcis de saisie A Z E R T »**.

---

## Les exports CSV

Deux boutons dans le panneau. Les fichiers reflètent le mois **affiché**, modifications non
enregistrées comprises — enregistrez d'abord si vous voulez l'état serveur.

### ⭳ CSV détail par jour

Une ligne par activité, une colonne par jour, les totaux en marge et en pied.

```
;;1;2;3;…;31;Total
Client;Description;Sa;Di;Lu;…;Lu;
Client A;PROJET-ALPHA;1;0;0;…;0;2,5
Client A;PROJET-BETA;0;0;0,5;…;0;1
Total par jour;;1;0;0,5;…;0;3,5
```

L'en-tête tient sur **deux lignes** : les numéros de jour, puis leur abréviation sur deux
caractères. Deux caractères plutôt qu'un parce que `Ma` et `Me` distinguent mardi de
mercredi, ce que l'initiale seule ne permettait pas.

C'est un écart assumé à la norme RFC 4180, qui ne prévoit qu'une seule ligne d'en-tête :
ici la lisibilité en tableur prime. L'import s'en accommode, et accepte aussi bien les
fichiers produits par les versions antérieures — voir [Import CSV](#import-csv).

Nom du fichier : `CRA_2026-08_detail_NOM-Prenom.csv`

### ⭳ CSV total par projet

Le consommé du mois, regroupé par projet, trié du plus gros au plus petit.

```
Projet;Client;Total (jours);Jours saisis
PROJET-ALPHA;Client A;2,5;3
PROJET-BETA;Client A;1;1
Total;;3,5;4
```

« Jours saisis » compte les journées où quelque chose a été imputé — distinct du total,
puisqu'une journée peut être fractionnée en demi-journées.

Nom du fichier : `CRA_2026-08_projets_NOM-Prenom.csv`

### Format des fichiers

Deux réglages, appliqués **à l'export comme à l'import** :

| Réglage | Valeurs possibles | Défaut |
|---|---|---|
| **Séparateur** | point-virgule · virgule · tabulation · barre verticale | `;` |
| **Décimale** | virgule · point | `,` |

Les défauts conviennent à **Excel en français**. Séparateur virgule + décimale point pour
LibreOffice, Google Sheets, pandas ou tout outil attendant le format anglo-saxon.

La décimale ne peut jamais coïncider avec le séparateur : choisir la virgule pour les deux
obligerait à entourer chaque nombre de guillemets, ce que beaucoup de tableurs relisent mal.
Le script bascule alors d'office sur l'autre décimale.

Le reste est fixe et conforme aux usages : **BOM UTF-8** — sans lui Excel ouvre le fichier en
ANSI et abîme les accents —, fins de ligne CRLF, et échappement RFC 4180 (guillemets doublés,
champs entourés uniquement lorsque c'est nécessaire).

### Valeurs exportées

Toujours **en jours**, même pour une ligne que vous saisissez en heures : VSA maintient les
deux unités en correspondance, le script lit la valeur en jours. Les deux fichiers sont donc
homogènes et sommables quel que soit votre mode de saisie.

Avant d'écrire, le script recoupe ses totaux avec ceux affichés par VSA. En cas d'écart, un
avertissement est émis dans la console du navigateur (`F12`).

---

## Le tableau de suivi par ligne

À l'emplacement du total de chaque ligne, VSA affiche « 2,5 jours ». Le script le remplace
par un tableau compact :

```
Ce mois-ci       2,5 jours
Jours planifiés   15        50 %
Jours vendus      30
```

| Ligne | Origine |
|---|---|
| **Ce mois-ci** | Le total de la ligne pour le mois affiché — l'élément d'origine de VSA, simplement déplacé dans le tableau. Il continue donc de se mettre à jour à chaque saisie. |
| **Jours planifiés** | Le cumul consommé depuis le début de la mission, recopié du panneau de droite (VSA l'y nomme « Jours réalisés »). Se met à jour en direct lui aussi. |
| **Jours vendus** | Le volume total de la mission. |

La troisième colonne donne la **part consommée** — planifiés ÷ vendus. Une décimale au plus,
sans zéro inutile : `50 %`, `7,5 %`, `68,8 %`. Elle n'apparaît que sur la ligne des jours
planifiés, et reste vide si le volume vendu est inconnu ou nul.

L'intérêt : ces trois chiffres n'étaient lisibles qu'en croisant deux zones distantes de
l'écran. Côte à côte, ils répondent d'un coup d'œil à « où en suis-je sur cette mission ».

Si les jours planifiés dépassent les jours vendus, la valeur et son pourcentage passent en
rouge. L'égalité stricte n'est pas traitée comme un dépassement.

Sur une **activité interne** (formation, absence, inter-contrat), il n'y a ni volume vendu ni
cumul : les deux dernières lignes affichent alors `—`.

Le tableau se désactive par la case **« Tableau de suivi par ligne »**, qui restitue
l'affichage d'origine.

---

## Personnaliser l'affichage des lignes

Dans la liste du panneau, chaque ligne dispose de deux contrôles.

### 👁 Masquer une ligne

Retire la ligne de l'affichage **sans rien supprimer**. Les temps restent saisis, les champs
restent dans le formulaire, et l'enregistrement les envoie normalement. C'est un filtre
visuel, utile quand une feuille compte beaucoup d'activités et que vous n'en saisissez que
deux ou trois.

Le bouton **« Tout afficher »** en haut de la liste réaffiche tout d'un coup.

> Les lignes masquées restent présentes dans les **exports CSV** : un export est un document
> déclaratif, il refléterait mal la réalité s'il omettait du temps saisi.

### ⬤ Colorer une ligne

**Chaque ligne reçoit d'emblée une couleur**, déduite de son couple **client + projet**.
Deux lignes du même projet chez deux clients différents obtiennent donc deux couleurs
distinctes, et une même mission garde la sienne d'un mois sur l'autre, indéfiniment — la
couleur est calculée, pas tirée au sort.

Pour personnaliser, cliquez sur la pastille. Le **⌫** revient à la couleur automatique.
Une pastille à bord épais signale une couleur choisie à la main.

La case **« Couleur automatique par projet »** désactive l'attribution d'office ; seules les
couleurs choisies manuellement subsistent alors.

#### Pourquoi votre couleur n'est pas appliquée telle quelle

Seule la **teinte** de votre choix est conservée : la saturation et la clarté sont imposées.
Un rouge vif devient un rose pâle, un vert fluo un vert d'eau. C'est le seul moyen de
garantir qu'aucun choix ne rende la grille illisible.

Les valeurs retenues viennent d'une mesure de contraste, avec pour critère : **ne jamais
faire pire que le fond le plus sombre que VSA utilise lui-même**, le gris des week-ends.

| Fond | Texte principal | Libellés | Mentions 8 px |
|---|---|---|---|
| VSA, cellule normale | 12,6 | 4,27 | 2,62 |
| VSA, week-end | 9,9 | 3,25 | 2,00 |
| **Teinte du script** | **9,2** | **3,24** | **1,99** |

Le texte principal reste très au-dessus du niveau AAA (7:1). Les mentions en 8 px n'y
satisfaisaient déjà pas dans le design d'origine — la teinte ne les dégrade pas plus que ne
le font les propres cellules de week-end de VSA. Le contenu des champs de saisie n'est pas
concerné : ils ont leur propre fond blanc.

#### Où la couleur est posée

Sur l'élément de ligne lui-même — le `<tr id="line_…">` de `#grid_thead_table_crapivot` —
et non sur chaque cellule.

Le fond d'une ligne de tableau n'étant visible que là où les cellules sont transparentes, et
VSA donnant aux jours ordinaires un fond opaque, les cellules sont neutralisées pour laisser
la couleur de la ligne transparaître.

Cette neutralisation reste **sans effet sur les cellules à fond signifiant** — week-end,
jours fériés, congés : leur règle est déclarée `!important` côté VSA et l'emporte sur tout
style en ligne. Leur signalétique est donc préservée d'elle-même, sans traitement particulier.

---

## Verrouiller des cellules

Deux cases dans le panneau :

- **Verrouiller les samedis et dimanches**
- **Verrouiller les jours passés** (antérieurs à aujourd'hui ; le jour même reste modifiable)

Les cellules concernées passent en lecture seule, grisées, avec un curseur d'interdiction.

> **Détail qui compte** : le verrou utilise `readOnly`, jamais `disabled`. Un champ désactivé
> n'est pas envoyé lors de l'enregistrement — verrouiller un samedi déjà saisi aurait pu en
> effacer le contenu. Avec `readOnly`, la frappe est bloquée mais la valeur reste dans le
> formulaire, donc intacte.

Les cellules que VSA a lui-même désactivées (jour hors période d'une mission) ne sont pas
touchées, et décocher la case ne déverrouille que ce que le script avait verrouillé.

---

## Import CSV

Permet de remplir la feuille en masse depuis un fichier — typiquement un export modifié dans
un tableur.

> ⚠️ **C'est la seule fonction du script qui écrit des temps, et elle le fait en masse.**
> Elle procède donc obligatoirement en deux temps : analyse et aperçu d'abord, écriture
> seulement après un clic explicite. Vérifiez l'aperçu.

### Marche à suivre

1. Exportez le mois avec **« CSV détail par jour »**
2. Modifiez le fichier dans votre tableur
3. Panneau → **Import CSV** → choisissez le fichier
4. **Lisez l'aperçu** : il liste chaque cellule qui changerait, avec sa valeur avant et après
5. Cliquez sur **« Appliquer l'import »**, puis sur **« Enregistrer »** dans VSA

Tant que vous n'avez pas enregistré dans VSA, **recharger la page annule tout**.

### Format attendu

Un fichier d'exemple est fourni : **`exemple-import.csv`**.

```
;;1;2;3;…;31
Client;Description;Lu;Ma;Me;…;Me
ACME Corp;PROJET-ALPHA;1;1;1;…;0
ACME Corp;PROJET-BETA;0;0;0;…;0
```

**Les totaux sont facultatifs à l'import.** Ni la colonne `Total`, ni les lignes de total ne
sont nécessaires : le fichier d'exemple s'en passe. Un export non modifié reste évidemment
importable — ses totaux sont simplement ignorés et recalculés.

| Élément | Règle |
|---|---|
| Lignes d'en-tête | Repérées **par leur contenu**, pas par leur position : la ligne portant le plus de numéros de jour, et celle contenant `Projet` ou `Description`. Les données commencent après la dernière des deux. |
| Colonne d'identification | `Projet` ou, à défaut, `Description`. Sa valeur est rapprochée de la clé extraite de chaque ligne. |
| Colonnes de jour | Tout en-tête commençant par un nombre de 1 à 31. `3`, `03` et `3 (Lu)` sont équivalents — ce qui suit le nombre est ignoré. |
| Valeurs | En **jours**. Virgule ou point acceptés, quel que soit votre réglage. Vide = 0. |
| Colonne `Total` | **Facultative.** Ignorée si présente : elle est recalculée. |
| Lignes de total | **Facultatives.** Toute ligne dont l'identifiant commence par `Total`, `Totale`, `Totaux`… est ignorée. |
| Colonne absente d'une ligne | Une ligne plus courte que l'en-tête laisse les jours manquants **inchangés**. Seule une cellule présente mais vide vaut zéro. |
| Séparateur | Celui de vos réglages ; à défaut, détecté dans le fichier. |

Repérer les en-têtes par leur contenu rend l'import tolérant : il accepte le format actuel à
deux lignes, celui des versions antérieures à une seule ligne, et un fichier auquel vous
auriez ajouté une ligne de titre dans votre tableur.

De même, un fichier reçu d'un collègue dont les réglages diffèrent des vôtres reste lisible :
si le séparateur configuré ne découpe visiblement rien, le script renifle celui du fichier.

### Ce que l'import refuse de faire

- **Créer des lignes.** Un projet absent de la feuille est signalé, pas créé — le CSV ne
  contient pas l'information nécessaire pour choisir la bonne mission. Lancez
  « Appliquer au mois » d'abord.
- **Écrire dans une cellule verrouillée** (week-end, jour passé, ou hors période de mission).
  Elles sont comptées et signalées dans l'aperçu.
- **Accepter une valeur non numérique ou négative.** Signalée ligne par ligne.

L'aperçu avertit également si un jour dépasserait **1 journée** au total après import.

---

## Tous les réglages

Tout est enregistré dans le `localStorage` du navigateur, sous les clés
`vsaCraHelper.settings.v2` et `vsaCraHelper.model.v2`.

| Réglage | Défaut | Description |
|---|---|---|
| Réordonner automatiquement | activé | Applique l'ordre du modèle à chaque affichage |
| Remplir les descriptions vides | activé | Ne complète que les champs vides |
| Raccourcis de saisie `A Z E R T` | activé | Une touche pose 0 · 0,25 · 0,5 · 0,75 · 1 |
| …et avancer à la cellule suivante | activé | Déplace le focus après chaque raccourci |
| Tableau de suivi par ligne | activé | Remplace « 2,5 jours » par ce mois-ci / planifiés / vendus |
| Couleur automatique par projet | activé | Attribue une couleur de fond déduite du couple client + projet |
| Verrouiller les samedis et dimanches | désactivé | Week-ends en lecture seule |
| Verrouiller les jours passés | désactivé | Jours antérieurs à aujourd'hui en lecture seule |
| Séparateur CSV | `;` | Champs, à l'export comme à l'import |
| Décimale CSV | `,` | Jamais identique au séparateur |
| Motif | `\(([^)]*)\)` | Regex d'extraction |
| Clé | `$1` | Gabarit du fragment identifiant |
| Description | `$1` | Gabarit de la description écrite |
| **Desc. vides** | `[]` | Valeurs (séparées par des virgules) traitées comme une description vide, donc remplaçables automatiquement. Utile si votre instance préremplit ce champ avec un gabarit. |
| **Délai AJAX** | `250` ms | Temps de repos après chaque choix de tiers ou de mission. À augmenter sur une instance lente. |

Les deux derniers se trouvent dans la section **« Avancé »**.

---

## Transférer sa configuration

Section **« Import / export du modèle »**.

- **Exporter** place dans la zone de texte un JSON contenant la règle d'extraction et le
  modèle. Copiez-le où vous voulez.
- **Importer** relit ce JSON et remplace la configuration en place.

Utile pour passer d'un poste à un autre, ou pour partager une configuration type entre
collègues travaillant sur les mêmes projets.

---

## En cas de problème

### Le bouton « ⠿ Lignes CRA » n'apparaît pas

1. Vérifiez que l'extension est active et le script activé dans son tableau de bord.
2. Vérifiez l'adresse de la page : le `@match` doit correspondre à votre instance
   (voir [Instance sur un domaine propre](#instance-sur-un-domaine-propre)).
3. Ouvrez la console (`F12` → Console) : si le script s'est désactivé, il l'indique par un
   message préfixé `[CRA]`.

Au chargement normal, la console affiche une ligne du type :
`[CRA] userscript actif — 4 ligne(s) au modèle | règle: \(([^)]*)\)`

### « Appliquer au mois » signale des lignes non traitées

Le message précise la cause pour chacune :

| Cause | Explication |
|---|---|
| *mission introuvable* | La mission est déjà utilisée sur une autre ligne (VSA l'interdit deux fois), elle est hors période, ou son libellé a changé au point que la clé ne correspond plus |
| *activité absente de la liste* | Le tiers enregistré dans le modèle ne vous est plus proposé |
| *délai dépassé* | L'instance n'a pas répondu à temps → augmentez le **Délai AJAX** |

Les autres lignes sont créées normalement : seules les entrées en échec sont listées.

### La création de lignes échoue par intermittence

Augmentez le **Délai AJAX** (section « Avancé ») : essayez 500, puis 1000 ms.

### Les descriptions ne se remplissent pas

- Vérifiez l'aperçu de la règle : si la colonne description est vide, c'est que le motif ne
  correspond pas au libellé.
- En mode automatique, seules les descriptions **vides** sont complétées. Si le champ
  contient déjà un texte, utilisez **« Forcer les descriptions »**, ou déclarez la valeur
  concernée dans le réglage **Desc. vides**.

### Les accents sont abîmés dans Excel

Vous avez probablement importé le fichier via *Données → Obtenir des données* en imposant un
encodage. Ouvrez-le plutôt par double-clic : le BOM présent dans le fichier suffit à ce
qu'Excel détecte l'UTF-8.

### Repartir de zéro

Console (`F12`), puis :

```js
localStorage.removeItem('vsaCraHelper.model.v2');
localStorage.removeItem('vsaCraHelper.settings.v2');
```

Rechargez la page.

---

## Ce que le script ne fait jamais

- **Il n'enregistre pas à votre place.** Ni le bouton « Enregistrer » de VSA, ni la
  soumission du CRA pour validation ne sont jamais déclenchés automatiquement.
- **Il n'écrase pas vos saisies.** En mode automatique, seules les descriptions vides sont
  complétées.
- **Il ne touche pas à vos temps.** Aucune valeur de jour ou d'heure n'est jamais écrite.
- **Il ne remanie pas vos lignes existantes.** L'activité et la mission ne sont renseignées
  que sur les lignes que « Appliquer au mois » vient de créer ; celles déjà présentes ne sont
  que déplacées, et leur description complétée si elle est vide.
- **Il n'envoie rien à l'extérieur.** Aucune requête réseau vers un tiers. La seule
  connexion sortante du dispositif est la vérification de mise à jour, effectuée par
  votre gestionnaire de userscripts et non par le script — voir
  [Mises à jour](#mises-à-jour).
- **Il se désactive proprement** si la page ne correspond pas à ce qu'il attend, plutôt que
  de produire des saisies erronées.

Le réordonnancement, en particulier, n'écrit **aucune donnée** : il déplace des lignes à
l'écran, sans effet sur ce qui est envoyé au serveur.

---

## Limites connues

- **L'ordre est local à votre navigateur.** VSA ne stocke aucun ordre utilisateur : le modèle
  vit dans le `localStorage`. Il ne suit pas d'un poste ou d'un profil à l'autre — utilisez
  l'export/import pour cela.
- **Une mission ne peut figurer que sur une seule ligne**, contrainte de VSA. Le script la
  respecte et signale le conflit le cas échéant.
- **Dépendance au HTML de VSA.** Une mise à jour de l'éditeur peut changer la structure de la
  page. Le script vérifie la présence des éléments qu'il attend et se désactive plutôt que de
  travailler à l'aveugle.
- **Le CSV reflète l'écran**, pas le serveur : enregistrez avant d'exporter si vous voulez
  l'état enregistré.

---

## Contribuer

Les signalements et les propositions passent par les
[issues](https://github.com/erim32/addon-vsactivity-cra/issues/new/choose). Les
conventions du projet — règles de conception, vérifications avant PR — sont
décrites dans [CONTRIBUTING.md](CONTRIBUTING.md).

> ⚠️ **Anonymisez tout ce que vous joignez.** Un export CSV, une capture d'écran ou
> une copie de page VSA portent des noms de clients, des références de commande et
> votre identité. Remplacez-les par des valeurs fictives, comme le fait
> `exemple-import.csv`.

Une faille de sécurité se signale **en privé** : voir [SECURITY.md](SECURITY.md).

---

## Licence

[MIT](LICENSE). Fourni tel quel, sans garantie.

Ce script n'est ni affilié à, ni approuvé par, ni soutenu par l'éditeur de
VSA / VSActivity. Les noms « VSA » et « VSActivity » appartiennent à leurs
détenteurs respectifs et ne sont employés ici que pour désigner le logiciel avec
lequel ce script interagit.
