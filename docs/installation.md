# RQ compagnon Manager module 0.17.3

Cette mise à jour intègre les icônes Glorantha validées : cercle des runes pour DM Manager et bouclier de bronze pour PC Manager. Cette version adopte le nom RQ compagnon Manager et affiche 0.17.3 dans les fenêtres. Les règles restent celles de la version stable 0.17.1.

## Installation par GitHub sur The Forge

1. Fermer les fenêtres du Manager et terminer les opérations en cours.
2. Ouvrir [The Forge Bazaar](https://forge-vtt.com/bazaar), puis **Install From Manifest**.
3. Coller ce lien : https://github.com/FranckyGtH/rq-compagnon-manager/releases/latest/download/module.json
4. Vérifier le nom **RQ compagnon Manager** et installer le module.
5. Redémarrer le serveur, ouvrir le monde comme MJ et activer le module dans **Manage Modules**.
6. Retrouver les macros **RQ compagnon Manager DM** et **RQ compagnon Manager PC** dans le répertoire des macros et les placer dans la barre de raccourcis.

Le manifeste pointe vers la dernière version stable publiée. Les prochaines mises à jour seront accessibles depuis **Check for Updates** dans le Bazaar. Le module doit rester installé comme module personnalisé.

Source : [The Forge Bazaar](https://forge-vtt.com/bazaar).

## Installation ou mise à jour par ZIP sur The Forge

1. Télécharger RQ_Compagnon_Manager_Module_v0.17.3.zip.
2. Fermer les fenêtres du Manager et terminer les éventuelles opérations interrompues.
3. Dans The Forge, ouvrir My Foundry / Games Configuration puis Summon Import Wizard.
4. Importer le ZIP. Désactiver Install found packages from the Bazaar si cette option est présentée.
5. Utiliser Analyze, vérifier RQ compagnon Manager 0.17.3 puis terminer l'import. Le paquet remplace le module du même identifiant.
6. Arrêter et redémarrer le serveur depuis The Forge.
7. Ouvrir le monde comme MJ. Vérifier que RQ compagnon Manager est actif dans Manage Modules.
8. Les macros DM et PC du module reçoivent automatiquement leurs nouvelles icônes. Leurs identifiants et permissions sont conservés : les raccourcis déjà placés dans la barre restent utilisables.

Les dossiers et références du compendium sont des données du monde : ils sont conservés. Les macros autonomes ne sont pas modifiées.

## Macros autonomes

Le dossier icons du ZIP contient aussi les icônes SVG et PNG en 512 × 512 pixels. Pour les utiliser sans module, charger ces fichiers avec le sélecteur d'image de Foundry, puis choisir l'icône voulue dans la configuration de chaque macro. Copier le code des macros reste la procédure d'installation autonome.

Si le module est actif, les chemins des icônes sont :

- modules/companion-manager/icons/compagnon-dm.svg
- modules/companion-manager/icons/compagnon-pc.svg

## Validation

Les contrôles du paquet vérifient la présence des fichiers, les permissions des macros, l'absence de doublons et la mise à jour des anciennes macros du module. Le moteur embarqué reprend la progression déjà testée. L'installation du module et l'accès aux macros ont été confirmés par l'utilisateur sur The Forge. L'installation par le nouveau lien GitHub doit encore être confirmée dans sa session.

Guide complet : docs/guide.html ou docs/guide.md dans le ZIP.

Import sur The Forge : https://forums.forge-vtt.com/t/how-to-upload-a-modified-version-of-a-module-system/10510

Motifs inspirés des runes de Glorantha : https://rqwiki.chaosium.com/glorantha/the-runes.html

## Nouveau nom

La version 0.17.3 adopte le nom RQ compagnon Manager dans les fenêtres, le module et ses macros de lancement. Les mécanismes de progression proviennent de la version stable 0.17.1 ; aucun changement de règle n'est introduit.

L'identifiant du module reste companion-manager et le compendium privé garde son identifiant world.companion-manager-dm. Cela permet de retrouver les dossiers existants. Un ancien compendium peut conserver son ancien titre visible.

Les macros du module sont renommées lors de la mise à jour ; les macros autonomes existantes peuvent être renommées manuellement et leur contenu remplacé par les fichiers RQ_Compagnon_Manager_DM_v0.17.3.js et RQ_Compagnon_Manager_PC_v0.17.3.js.
