# Contribuer

Merci de l'intérêt porté au projet. Quelques repères avant de vous lancer.

## Signaler un problème

Ouvrez une [issue](https://github.com/erim32/addon-vsactivity-cra/issues/new/choose).
Les gabarits proposés demandent le strict nécessaire.

> ⚠️ **Anonymisez toujours.** Les captures d'écran, exports CSV et copies de page
> VSA contiennent des noms de clients, des références de commande et votre
> identité. Remplacez-les par des valeurs fictives — `ACME Corp`,
> `PROJET-ALPHA` — comme le fait `exemple-import.csv`.
>
> Une faille de sécurité se signale en privé : voir [SECURITY.md](SECURITY.md).

## Environnement

Il n'y a **ni build, ni dépendance, ni gestionnaire de paquets**. Le projet est
un fichier JavaScript unique, chargé tel quel par le gestionnaire de userscripts.

Pour travailler dessus :

1. Clonez le dépôt.
2. Dans Tampermonkey, créez un script et collez-y le contenu du fichier — ou,
   plus confortable, activez le mode « fichier local » de l'extension et pointez
   sur votre copie de travail (nécessite d'autoriser l'accès aux URL de fichier).
3. Rechargez la feuille de temps VSA après chaque modification.

## Vérifications avant de proposer une modification

```sh
node --check vsa-cra-helper.user.js   # syntaxe
node scripts/validate.mjs             # en-tête ==UserScript== et cohérence de version
```

Ces deux commandes sont exactement ce que la CI exécute. Aucune installation
préalable n'est nécessaire, Node.js suffit.

## Conventions de code

Le fichier existant est la référence ; alignez-vous dessus plutôt que sur vos
habitudes.

- **Français** pour les identifiants, les commentaires et les messages
  utilisateur. C'est le parti pris du projet, il est tenu de bout en bout.
- **Indentation** de 4 espaces, fins de ligne LF, encodage UTF-8 sans BOM.
  Un [`.editorconfig`](.editorconfig) est fourni.
- **Un seul fichier.** Pas de découpage en modules : un userscript se distribue
  en un fichier, et la simplicité d'audit par l'utilisateur final est un objectif
  du projet.
- **Les commentaires expliquent le *pourquoi*.** Le fichier documente ses
  décisions de conception plutôt que ses mécanismes — poursuivez dans ce sens.
- **Pas de dépendance externe.** Le script utilise le jQuery déjà chargé par la
  page, rien d'autre.

## Règles de conception à respecter

Elles sont ce qui rend le script sûr à utiliser sur des données professionnelles.
Une contribution qui les enfreint ne sera pas retenue.

1. **Aucun appel réseau sortant.** Ni fetch, ni XHR, ni ressource distante, ni
   télémétrie.
2. **Aucun enregistrement automatique.** Le script ne clique jamais sur
   « Enregistrer », ni ne soumet le CRA pour validation.
3. **Aucune écriture de temps hors import explicite.** L'import CSV est la seule
   fonction qui écrit des valeurs de jour, et elle exige un aperçu puis un clic.
4. **Aucun écrasement silencieux.** En mode automatique, seules les descriptions
   vides sont complétées.
5. **Dégradation propre.** Si la page ne présente pas la structure attendue, le
   script se désactive et le signale en console plutôt que de travailler à
   l'aveugle.
6. **`readOnly`, jamais `disabled`,** pour verrouiller une cellule : un champ
   désactivé n'est pas transmis à l'enregistrement, ce qui effacerait la valeur.

## Pull requests

- Une PR = un sujet.
- Décrivez ce que vous avez testé, et sur quel navigateur.
- Mettez à jour [CHANGELOG.md](CHANGELOG.md) sous `## [Non publié]`.
- Ne modifiez pas `@version` : le mainteneur l'incrémente à la publication.
- Mettez à jour le [README](README.md) si le comportement visible change.

## Publier une version *(mainteneur)*

1. Incrémenter `@version` dans l'en-tête du userscript.
2. Basculer la section `## [Non publié]` du CHANGELOG en `## [x.y.z] — AAAA-MM-JJ`
   et ajouter les liens de comparaison en bas de fichier.
3. Vérifier que la CI passe sur `main`.
4. Créer le tag `vx.y.z` et la release GitHub correspondante.

Les installations existantes se mettent à jour d'elles-mêmes : `@updateURL`
pointe sur `main`, que le gestionnaire de userscripts interroge périodiquement.
