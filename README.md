# RQ compagnon Manager

Applications DM et PC pour Foundry VTT et RuneQuest Glorantha. Le MJ attribue les XP, TP et DP ; le joueur prépare ses demandes ; le MJ contrôle et applique les changements.

Configuration prise en charge : **Foundry VTT 14.367 / rqg 6.1.1**. Interface en anglais, documentation en français.

## Installation

Après publication de la première Release, installer avec ce manifeste :

https://github.com/FranckyGtH/rq-compagnon-manager/releases/latest/download/module.json

Sur The Forge, utiliser l'installation par manifeste du Bazaar ou importer le ZIP depuis **Summon Import Wizard**. Activer ensuite **RQ compagnon Manager** dans **Manage Modules**. La connexion MJ crée deux macros de lancement.

Le module conserve l'identifiant `companion-manager` pour reprendre les installations précédentes et le compendium privé `world.companion-manager-dm`. Les fiches, notes privées et sauvegardes restent dans le monde Foundry.

## Fonctions

- Distribution XP et TP pour skills, runes, passions et styles de combat.
- Season Training et gestion des ticks de caractéristiques par le MJ.
- Activités de downtime, DP, Training ciblé et clôture des activités.
- Dossiers MJ privés, sauvegardes FIFO, export JSON et resynchronisation.
- Résumé Markdown pour Obsidian.

Documentation : [guide](docs/guide.md), [installation](docs/installation.md), [notes de version](docs/release-v0.17.3.md).

## Développement

Installer Node.js 22 ou supérieur et pnpm 10, puis :

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm test
```

`pnpm build` génère les macros autonomes, le module, le manifeste de publication et le ZIP dans `dist/`. Les tests utilisent Chromium et des fiches simulées. Une vérification facultative peut lire un export Actor local avec `KORONIL_TEST_EXPORT` ; ce fichier n'est jamais inclus dans la publication.

Pour utiliser un navigateur déjà installé pendant les tests : `RQ_TEST_BROWSER_CHANNEL=msedge`. Les tests automatisés complètent la validation dans un monde Foundry de test.

## Versions

La publication d'un tag correspondant à la version de package.json lance les contrôles et publie les fichiers de la Release si ceux-ci réussissent. Pour la version courante : `v0.17.3`.

Avant une prochaine version, mettre à jour package.json, les versions des générateurs et de package-main.mjs, les tests du paquet et les notes de version utilisées par le workflow. Vérifier le cycle complet dans Foundry avant de publier une version stable.

## Signalements

Décrire le problème dans une Issue avec les versions Foundry, rqg et Manager, les étapes pour le reproduire et le message exact. Ne pas joindre d'export contenant des informations privées du MJ.

Les icônes sont des créations du projet inspirées de motifs de Glorantha. Ce projet n'est pas une publication officielle de Chaosium et n'inclut aucun livre ou contenu de campagne.
