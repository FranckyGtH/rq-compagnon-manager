# RQ compagnon Manager

## Guide d’installation et d’utilisation

Version stable 0.17.3 — Foundry VTT 14 Stable Build 367 — RuneQuest Glorantha 6.1.1

RQ compagnon Manager accompagne la progression des personnages. Le MJ attribue les récompenses, le joueur prépare ses souhaits, puis le MJ vérifie et applique les changements. Ce guide décrit l’installation par macros ou par module, le cycle courant, le downtime et les outils de sauvegarde. L’interface de l’application est en anglais ; les noms des boutons sont repris tels qu’ils apparaissent à l’écran.

La version des applications a été testée dans Foundry par le joueur et dans 111 tests automatisés. Le paquet d’installation réutilise ce moteur ; son installation dans une session Foundry reste à vérifier.

## 1 Ce que chacun peut faire

| Fonction | MJ avec DM Manager | Joueur avec PC Manager |
| --- | --- | --- |
| Choix du personnage | Tous les personnages du monde accessibles au MJ | Personnages accessibles au compte |
| Attribution XP TP DP | Définit les budgets | Consulte les budgets |
| Répartition XP TP | Prépare ou corrige les demandes | Prépare et enregistre ses souhaits |
| Valeurs de la fiche | Applique les changements | Aucun changement par PC Manager |
| Caractéristiques | Gère les ticks et les augmentations | Choisit un tick saisonnier si éligible |
| Downtime | Gère les résultats, les coûts et les statuts | Propose des activités et des DP |
| Informations secrètes | Dossier privé du compendium | Aucune publication des secrets |
| Sauvegardes et restauration | Compendium et exports JSON | Enregistre seulement les informations d’échange |

Pour enregistrer ses demandes, le joueur doit disposer du droit Owner sur son personnage. Observer permet la consultation. Ces droits Foundry existent indépendamment du Manager : PC Manager n’écrit pas les valeurs des skills, runes ou passions, mais ne retire pas les droits que le système accorde par ailleurs au compte. Le MJ conserve la validation des changements effectués par le Manager.

## 2 Choisir une installation

Deux modes sont disponibles. Ils utilisent les mêmes applications et les mêmes dossiers de personnages.

- **Macros autonomes** : conserver le fonctionnement déjà testé, sans installer de module.
- **Module local** : installer le ZIP sur le serveur Foundry ; le module crée deux macros de lancement et fournit le code des applications.

Choisir un seul mode de lancement pendant une répartition. Fermer les fenêtres des anciennes versions avant de changer de mode ou de version.

### Installation par macros

1. Créer une macro de type Script appelée RQ compagnon Manager DM.
2. Ouvrir RQ_Compagnon_Manager_DM_v0.17.3.js et copier tout son contenu dans le champ Command de la macro. Enregistrer.
3. Créer une seconde macro Script appelée RQ compagnon Manager PC avec le contenu de RQ_Compagnon_Manager_PC_v0.17.3.js.
4. Réserver la macro DM au MJ. Partager la macro PC avec les joueurs en lecture et exécution, sans leur donner le droit de modifier son code.
5. Autoriser l’exécution des macros Script pour les rôles de joueurs concernés dans les permissions du monde Foundry, si nécessaire.
6. Glisser chaque macro dans la barre de raccourcis. Ouvrir celle correspondant au rôle voulu.

Si ces macros existent déjà, remplacer leur contenu plutôt que créer des doublons. Le MJ peut lancer PC Manager pour tester le parcours joueur : l’application reste en mode PC.

### Installation du module local

Le fichier RQ_Compagnon_Manager_Module_v0.17.3.zip contient un dossier **companion-manager** avec module.json, les applications et ce guide. Il ne contient aucune fiche de personnage ni donnée privée du MJ.

1. Arrêter le serveur Foundry avant de copier les fichiers.
2. Décompresser le ZIP. Placer le dossier companion-manager dans le dossier **Data/modules** des données utilisateur du serveur Foundry. Utiliser le chemin réellement configuré sur ce serveur.
3. Vérifier la structure : **Data/modules/companion-manager/module.json**. Éviter un dossier supplémentaire entre companion-manager et module.json.
4. Redémarrer Foundry et ouvrir le monde RuneQuest.
5. Se connecter comme MJ. Dans **Manage Modules**, activer **RQ compagnon Manager**, enregistrer et laisser le monde se recharger.
6. Le module crée deux macros dans le répertoire des macros : **RQ compagnon Manager DM (Module)** et **RQ compagnon Manager PC (Module)**. La première est privée par défaut ; la seconde est partagée en lecture avec les joueurs.
7. Glisser les macros de lancement dans la barre de raccourcis. Autoriser les macros Script pour les joueurs concernés si nécessaire.
8. Ouvrir DM Manager puis procéder à l’initialisation décrite ci-dessous.

Les joueurs n’ont aucun fichier à installer sur leur ordinateur : ils se connectent au monde où le module est actif. Les anciennes macros autonomes sont conservées ; ranger leurs raccourcis pour éviter de lancer deux interfaces à la fois. Les deux macros du module se recréent au prochain chargement avec un MJ connecté si elles ont été supprimées.

Pour The Forge, ouvrir le Bazaar puis **Install From Manifest** et utiliser https://github.com/FranckyGtH/rq-compagnon-manager/releases/latest/download/module.json. Le ZIP peut aussi être importé avec **Summon Import Wizard**. Voir [les instructions détaillées](installation-v0.17.3.md) dans le paquet ou [installation.md](installation.md) dans le dépôt GitHub.

### Première initialisation par le MJ

1. Ouvrir DM Manager et sélectionner le personnage dans **Character**.
2. Dans **Summary**, cliquer **Initialize / migrate character**.
3. Vérifier que le dossier privé est prêt. Le compendium **RQ compagnon Manager — DM** est créé au niveau du monde avec un dossier JournalEntry par personnage.
4. Si le personnage utilisait déjà le Manager, les informations privées sont migrées ou le dossier existant est réutilisé. Les notes extérieures aux zones du Manager sont conservées.
5. Utiliser **Open character dossier** pour vérifier le dossier du personnage. Ne pas rendre le compendium accessible aux joueurs.
6. Dans **Characteristics**, vérifier Initial DEX et Species maximum avant d’utiliser les ticks de caractéristiques.

L’installation du module n’initialise pas automatiquement tous les personnages et n’applique aucune progression à elle seule.

## 3 Le cycle courant

### Étape MJ attribuer les récompenses

1. Sélectionner le personnage dans DM Manager.
2. Définir les quantités de XP, TP et DP à distribuer dans les blocs correspondants.
3. Ajouter les récompenses de fin de saison dans **Season Training**, s’il y en a.
4. Cliquer **Save / synchronize DM publication**. Les valeurs deviennent disponibles au joueur.

Les trois blocs affichent les quantités attribuées, utilisées et restantes. Le joueur ne peut pas modifier les budgets attribués par le MJ. Les TP provenant de ses choix saisonniers s’ajoutent au disponible.

### Étape joueur préparer les souhaits

1. Ouvrir PC Manager et sélectionner le personnage.
2. Utiliser **Refresh sheet** ou **Reload notes** après une nouvelle publication du MJ ou des changements provenant d’une autre fenêtre.
3. Choisir les récompenses saisonnières, sélectionner les entrées XP/TP et proposer les activités de downtime.
4. Vérifier les prévisions et les budgets restants.
5. Cliquer **Save request to notes** pour enregistrer les demandes sur la fiche. Les valeurs natives du personnage restent inchangées.

Les demandes se trouvent dans les zones réservées au Manager des notes Background du personnage. Leur format lisible permet au script de les relire. Ne pas modifier directement les tableaux ou les marqueurs de ces zones.

### Étape MJ vérifier et appliquer

1. Recharger les notes du personnage dans DM Manager. Examiner les entrées, les choix saisonniers et les demandes de DP.
2. Corriger si nécessaire les souhaits et enregistrer. Enregistrer aussi les détails privés de downtime avant de continuer.
3. Utiliser **Export character (JSON)** pour obtenir une sauvegarde externe avant les changements. Vérifier son téléchargement dans le navigateur.
4. Cliquer **Apply progression**. La confirmation rappelle l’export et montre les points alloués et restants.
5. Si souhaité, activer l’export après application. Confirmer l’application.
6. Vérifier le message de réussite et le résultat sur la fiche. Le joueur recharge ensuite ses notes pour consulter les résultats.

Les skills, runes et passions sont mis à jour ; les ticks utilisés sont consommés ; les ticks saisonniers sont ajoutés ; les investissements DP et les clôtures programmées sont appliqués. Toutes les activités sont stockées et vérifiées dans le compendium, et leurs résultats publics sont republiés sur la fiche. Une référence complète est enregistrée automatiquement, même sans export JSON après application.

**Après réussite, les trois budgets passent à zéro et les souhaits sont effacés. Les points inutilisés sont archivés dans l’historique, sans report automatique.**

## 4 XP et TP

Les filtres sont sur une même ligne : **Type / Category / Sort / Search / Exp. Tick only**. Ils se combinent. Sort permet notamment de trier la valeur Full en ordre croissant ou décroissant. Le filtre Exp. Tick only limite la sélection aux entrées avec un tick d’expérience.

Ajouter une entrée à **Selected entries**, puis cocher XP ou TP. Une entrée reçoit au plus 1 XP et 1 TP par répartition. Une case indisponible est bloquée. Raw est la valeur brute persistée ; Full inclut les modificateurs préparés par le système. La nouvelle valeur est recalculée selon les choix. L’en-tête reste visible pendant le défilement de la liste.

| Learning Mode | Sens pour l’utilisateur |
| --- | --- |
| Normal | XP autorisé ; TP possible pour une skill éligible |
| Study only | Aucun XP ; TP possible si la skill reste entraînable |
| Exp. only | XP possible ; TP indisponible |
| Imp. only | XP possible uniquement avec Exp. Tick coché |
| Style member | Membre d’un style de combat à gérer par le style |

Les contrôles se fondent sur les valeurs Raw et les possibilités de l’entrée. Les règles sont celles du Manager issu du classeur, pas un moteur général pour toutes les variantes de RuneQuest. Les cases et la prévision font foi pour l’entrée sélectionnée.

La sélection d’une rune opposée ajoute sa paire pour montrer les deux impacts. La sélection d’un style de combat ajoute les skills de son pack. À l’application, leurs valeurs Full sont alignées avec le style et leurs ticks sont retirés. Les packs configurés sont Berserker, Fyrdman, Horse Thegn, Slinger, Weapon Thegn et Wolf Hunter. Un pack inconnu, une skill absente ou plusieurs correspondances bloque la répartition concernée.

Le bouton de suppression de toutes les entrées demande confirmation. Il nettoie la sélection du brouillon ; enregistrer ensuite pour modifier les souhaits conservés sur la fiche.

## 5 Season Training et Characteristics

### Récompenses saisonnières

Dans **Season Training**, le MJ peut ajouter plusieurs récompenses de fin de saison. Le joueur choisit, pour chacune, **2 TP** ou **1 tick** sur une caractéristique éligible. Plusieurs récompenses s’accumulent. Les TP s’ajoutent au budget disponible ; les ticks sont enregistrés quand le MJ applique la progression.

Un tick saisonnier n’augmente pas immédiatement la caractéristique. Il alimente son compteur ; les augmentations se gèrent ensuite dans l’écran Characteristics du MJ.

### Gestion des caractéristiques par le MJ

**Characteristics** affiche la valeur courante, le maximum, les ticks accumulés et le coût du prochain point. Le MJ définit et enregistre **Initial DEX** et **Species maximum** dans cet écran. INT et SIZ sont présentées pour référence et ne sont pas entraînables.

- **Collect Experience ticks** : ajoute un tick pour chaque caractéristique dont le toggle Experience natif est coché, puis retire ce toggle.
- **Force ticks**, puis **Save forced ticks** : remplace les compteurs renseignés ; une case vide laisse son compteur inchangé.
- **Apply characteristic increases** : augmente de 1 chaque caractéristique éligible affichée dans la confirmation et soustrait les ticks dépensés. Le surplus est conservé.

Pour un maximum d’espèce de 21, le coût dépend de la valeur actuelle : jusqu’à 9, 1 tick ; de 10 à 15, 2 ; de 16 à 17, 3 ; de 18 à 19, 4 ; à 20, 5. Le tableau ne couvre pas d’autres maxima d’espèce. Le plafond de DEX tient aussi compte de sa valeur initiale.

Enregistrer ou supprimer les souhaits saisonniers encore en attente avant de modifier les compteurs en dehors de leur application. Les contrôles indiquent les opérations à terminer.

## 6 Downtime et DP

### Proposer une activité

Dans **Downtime**, le joueur utilise **Add activity**. Il renseigne le titre, le type, la description de ce qu’il recherche et les DP à investir. **Keep in draft** ajoute la demande au brouillon ; **Save request to notes** l’enregistre sur la fiche pour le MJ.

Pour une activité déjà existante, **Propose DP / details** prépare un investissement supplémentaire ou une demande de mise à jour des détails. Les DP investis affichés sont les DP déjà validés, auxquels la prochaine application ajoutera la demande.

Le filtre Status affiche par défaut **In progress**. Choisir Completed, Failed, Cancelled ou All statuses pour consulter les autres activités. Une tâche qui vient d’être clôturée disparaît donc de la vue par défaut.

### Training avec une skill cible

Pour le type Training, le joueur sélectionne une skill éligible à l’entraînement. **1 DP finance 1 TP appliqué directement à cette skill** quand le MJ applique la progression. Le choix ne nécessite pas une deuxième répartition de TP.

La liste exclut les skills non entraînables et celles ayant déjà un TP ou un Training DP dans cette phase. XP et Training peuvent se combiner sur la même skill si ses règles le permettent. **Update details only (0 DP)** permet de demander seulement un changement de description.

Pour les anciennes activités Training avec des DP déjà investis sans cible, le MJ dispose de **Convert invested DP → TP**. La conversion crédite les TP disponibles pour une prochaine répartition et consigne les DP convertis pour éviter une seconde conversion des mêmes points.

### Résultats et clôture par le MJ

Dans **DM details / publish response**, le MJ règle les DP nécessaires, leur visibilité au joueur, la réponse publique, les notes secrètes et le statut. Enregistrer avec **Save details / publish response**.

Avec une demande encore en attente, choisir **Completed** programme la clôture après l’application des DP et du Training éventuel. Il est aussi possible de garder In progress et de cocher **Complete when progression is applied**. L’activité reste en cours jusqu’à Apply progression. Sans demande en attente, choisir Completed ferme immédiatement l’activité lors de l’enregistrement.

Pour annuler une clôture programmée, conserver In progress, décocher la case et enregistrer. La case vise la prochaine demande appliquée sur cette activité, y compris une mise à jour des détails à 0 DP. Elle ne clôture pas toutes les tâches et ne se déclenche pas automatiquement à l’atteinte du nombre de DP requis.

Failed et Cancelled sont disponibles. Avec une demande en attente, il faut d’abord l’appliquer ou la retirer avant d’attribuer l’un de ces statuts.

## 7 Summary et sauvegardes

### Dossier privé du compendium

Dans **Summary**, le MJ initialise le dossier, le recharge, ouvre le compendium et utilise les outils de réparation ou de synchronisation. Le compendium du monde est **world.companion-manager-dm**.

Chaque personnage possède ses pages Identity, Character backups, Characteristic ticks, Progression history, Export history, Downtime — DM, Downtime — Active, Downtime — Completed, Downtime — Failed, Private notes et Migration archive. Les activités Cancelled sont conservées dans la section Failed avec leur statut propre.

Les pages de suivi sont générées à partir des données privées du Manager. Modifier les activités depuis DM Manager. Les pages libres Private notes et Downtime — DM peuvent servir aux notes du MJ.

### Références et exports

**Character backups** conserve les cinq dernières références complètes selon un ordre FIFO : la plus ancienne est retirée à l’ajout d’une sixième. Chaque référence rassemble la fiche et les données privées nécessaires à la restauration. L’historique des fichiers exportés est lui aussi limité aux cinq dernières références de fichiers.

**Export character (JSON)** fournit un fichier de sauvegarde Manager contenant la fiche native et son dossier privé. Le nom comporte un timestamp. Le fichier inclut les secrets du MJ ; le conserver comme sauvegarde MJ. Un export est une demande de téléchargement : vérifier la présence réelle du fichier.

La sauvegarde du compendium se trouve dans les données du monde Foundry. Pour couvrir un problème affectant tout le monde ou le serveur, conserver aussi une sauvegarde externe de ces données. Les exports JSON complètent les références internes.

### Résumé Obsidian

Dans Summary, **Obsidian Summary** présente le texte Markdown à copier dans Obsidian. Il sépare les XP avec ou sans tick, les TP, les résultats sur les ticks de caractéristiques et les DP, avec les statuts entre crochets. Après application, le résumé du dernier cycle reste disponible dans l’historique.

## 8 Resynchronisation et reprise

### Choisir la bonne source

Dans Summary, **Character reference / resynchronization** propose trois directions :

| Direction | Quand l’utiliser |
| --- | --- |
| Compendium reference → character sheet | Restaurer une référence sauvegardée choisie |
| Current character sheet → new DM reference | Accepter la fiche actuelle comme nouvelle référence |
| JSON export → sheet and DM reference | Restaurer depuis un export du personnage |

Choisir la source, utiliser **Preview / force resynchronization**, examiner les changements proposés puis confirmer. La restauration porte sur la fiche complète et peut affecter des valeurs, objets et effets en dehors de la dernière répartition.

La case **Clear pending PC requests and seasonal choices** est cochée par défaut : elle efface les demandes et choix saisonniers en attente, mais conserve les récompenses attribuées. Lire ce choix avant de confirmer. Une opération de resynchronisation interrompue se reprend avec **Resume character resynchronization**.

### Messages courants

- **Private data loaded; generated dossier pages need repair** : les données privées sont chargées, mais une page générée n’a pas pu être vérifiée. Utiliser Reload dossier dans Summary et contrôler les pages concernées. Ne pas lancer une restauration complète seulement sur la base de ce message. S’il persiste, noter le texte exact et conserver les données existantes pour diagnostic.
- **Saved notes changed**, **distribution changed** ou référence désynchronisée : recharger les notes et le dossier, puis revoir les souhaits. Choisir une resynchronisation seulement après avoir identifié la source correcte.
- **Resume interrupted update** : reprendre l’application depuis DM Manager. Les cibles sont conservées pour éviter une double dépense ; ne pas appliquer manuellement les mêmes gains entre-temps.
- Compendium verrouillé ou permissions invalides : utiliser **Repair permissions / unlock** dans Summary. Le compendium doit rester privé au MJ.
- Personnage absent ou sauvegarde impossible côté PC : vérifier les permissions du personnage, puis les permissions d’exécution des macros Script.
- Skill Training introuvable : vérifier son admissibilité, la valeur actuelle et l’existence d’un TP ou Training déjà demandé dans cette répartition.

## 9 Mise à jour et désactivation

Pour les macros, remplacer le contenu avec les fichiers de la version choisie. Pour le module local, arrêter Foundry, remplacer son dossier dans Data/modules puis redémarrer. Pour une installation par GitHub, le manifeste hébergé permet de vérifier les mises à jour ; sur The Forge, utiliser **Check for Updates** dans le Bazaar. Redémarrer le monde après la mise à jour.

Les dossiers privés sont des données du monde, pas des données livrées dans le module. La désactivation du module laisse les fiches et le compendium du monde en place. Les macros de lancement du module nécessitent le module actif ; les macros autonomes peuvent être utilisées après fermeture des anciennes fenêtres.

Avant de changer de version, terminer les mises à jour interrompues et conserver une sauvegarde. Ne pas supprimer le compendium privé pour résoudre une erreur d’interface.

## 10 Premier contrôle après installation du module

1. Vérifier que les deux macros de lancement sont créées une seule fois après activation puis rechargement.
2. Ouvrir DM Manager avec un compte MJ et le dossier existant d’un personnage. Vérifier les tâches et les sauvegardes.
3. Ouvrir PC Manager avec le compte joueur : seuls ses personnages accessibles sont proposés et le compendium privé est inaccessible.
4. Réaliser un petit cycle sur un personnage de test : budgets MJ, souhaits PC, application MJ, contrôle des valeurs et du compendium.
5. Vérifier le téléchargement d’un export JSON et l’accès au résumé Obsidian.

Le passage des macros au module doit réutiliser le dossier existant et ne demande pas de repartir d’une fiche vierge.

## Références Foundry

Installation et activation des modules : https://foundryvtt.com/article/modules/

Structure des modules et manifeste : https://foundryvtt.com/article/module-development/

Le moteur 0.17.3 vise strictement Foundry 14.367 et rqg 6.1.1. Une autre version doit faire l’objet d’une validation avant d’être prise en charge.
