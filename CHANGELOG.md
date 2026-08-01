# Journal des modifications

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/),
et le versionnage suit [SemVer](https://semver.org/lang/fr/).

Le numéro de version vit dans le champ `@version` de l'en-tête de
`vsa-cra-helper.user.js` — les deux doivent toujours concorder, ce que la CI vérifie.

## [Non publié]

## [1.0.0] — 2026-08-01

Première version publique.

### Ajouté

- **Ordre des lignes** — glisser-déposer depuis la grille ou depuis le panneau,
  ordre mémorisé et réappliqué à chaque affichage.
- **Modèle de mois** — capture de la liste d'activités, recréation en un clic sur
  un mois vide (« Appliquer au mois »).
- **Description automatique** — dérivée du libellé de la mission via une règle
  d'extraction configurable (motif, gabarit de clé, gabarit de description).
- **Export CSV détail par jour** — une ligne par activité, une colonne par jour,
  totaux en marge et en pied.
- **Export CSV total par projet** — consommé du mois regroupé par projet.
- **Import CSV** — remplissage en masse, avec aperçu obligatoire avant écriture ;
  refuse de créer des lignes, d'écrire dans une cellule verrouillée ou d'accepter
  une valeur non numérique.
- **Raccourcis clavier `A Z E R T`** — 0 · 0,25 · 0,5 · 0,75 · 1, avec avancement
  automatique du focus sautant les cellules non saisissables.
- **Tableau de suivi par ligne** — ce mois-ci / jours planifiés / jours vendus,
  avec part consommée et alerte de dépassement.
- **Affichage des lignes** — masquage individuel, couleur automatique déduite du
  couple client + projet, couleur manuelle par teinte.
- **Verrouillage de cellules** — week-ends et jours passés, en `readOnly` afin de
  ne jamais retirer une valeur du formulaire.
- **Réglages CSV** — séparateur et décimale, appliqués à l'export comme à
  l'import ; BOM UTF-8, CRLF et échappement RFC 4180.
- **Import / export de la configuration** en JSON.

[Non publié]: https://github.com/erim32/addon-vsactivity-cra/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/erim32/addon-vsactivity-cra/releases/tag/v1.0.0
