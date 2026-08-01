# Politique de sécurité

## Versions suivies

Seule la dernière version publiée sur la branche `main` est maintenue.

## Signaler une vulnérabilité

**N'ouvrez pas d'issue publique.**

Utilisez l'onglet **Security → Report a vulnerability** du dépôt
([lien direct](https://github.com/erim32/addon-vsactivity-cra/security/advisories/new)),
qui ouvre un canal privé avec le mainteneur.

Merci d'y décrire :

- la version du script (`@version`) et le gestionnaire de userscripts utilisé ;
- le comportement observé et son impact ;
- les étapes de reproduction.

Vous pouvez espérer un premier retour sous une quinzaine de jours. Ce projet est
maintenu sur du temps personnel : il n'y a pas d'engagement de délai au-delà.

**N'incluez jamais** de capture, d'export CSV ou de HTML issus de votre instance
réelle : ces fichiers contiennent des noms de clients, des références de commande
et votre identité. Anonymisez, ou décrivez.

## Modèle de menace

Ce script est un userscript : il s'exécute avec `@grant none`, donc **dans le
contexte de la page VSA**, avec les mêmes droits que celle-ci. Il ne dispose
d'aucun privilège d'extension supplémentaire.

Ce qui en découle :

- Il peut lire et écrire tout ce que la page peut lire et écrire — c'est
  précisément ce qui lui permet de remplir la grille.
- Il ne demande aucune permission `GM_*`, ne déclare aucun `@connect`, et
  n'émet aucune requête réseau de son propre fait.
- Les données de configuration résident dans le `localStorage` de l'origine VSA,
  sous `vsaCraHelper.settings.v2` et `vsaCraHelper.model.v2`. Elles sont donc
  lisibles par la page elle-même, comme n'importe quelle donnée de `localStorage`.
- Les fichiers CSV sont construits en mémoire et téléchargés via un `Blob`
  local. Rien ne transite par un serveur tiers.

**Le seul appel sortant** de l'ensemble est celui du gestionnaire de userscripts
lui-même, qui interroge périodiquement `@updateURL` sur
`raw.githubusercontent.com` pour détecter une nouvelle version. Il est
désactivable dans les réglages de Tampermonkey ou Violentmonkey.

## Avant d'installer sur un poste professionnel

Vérifiez que l'installation d'extensions et de userscripts est autorisée par la
politique informatique de votre employeur. Le code est lisible en entier dans un
fichier unique : relisez-le, ou faites-le relire, plutôt que de vous fier à cette
page.
