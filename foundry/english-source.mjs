// English standalone build; preserve the previous GM version and storage schema.
const translations = {
  'Agilité':'Agility','Connaissance':'Knowledge','Magie':'Magic','Discrétion':'Stealth',
  'Armes de mêlée':'Melee weapons','Armes à distance':'Missile weapons','Boucliers':'Shields','Armes naturelles':'Natural weapons','Autres compétences':'Other skills',
  'Élément':'Element','Pouvoir':'Power','Forme':'Form',
  'Points à distribuer':'Points to distribute','Souhaits de progression':'Progression requests',
  'Cette version de test cible Foundry 14.367.':'This test version requires Foundry 14.367.',
  'Cette version de test cible RuneQuest Glorantha 6.1.1.':'This test version requires RuneQuest Glorantha 6.1.1.',
  'L’interface MJ est réservée au maître de jeu.':'The GM interface is restricted to the GM.',
  'Interface inconnue.':'Unknown interface.',
  'Ce personnage n’est pas accessible avec cette interface.':'This character is not accessible through this interface.',
  'Sans nom':'Unnamed','Valeur persistée indisponible :':'Stored value unavailable:',
  'Structure des notes non reconnue. Aucune note ne sera écrasée.':'Unknown note structure. Existing notes will be preserved.',
  'Les points doivent être des entiers de 0 à 1 000 000.':'Points must be whole numbers from 0 to 1,000,000.',
  'Budgets XP, TP et DP invalides.':'Invalid XP, TP or DP budgets.',
  'Liste des souhaits invalide.':'Invalid request list.',
  'Souhait absent, dupliqué ou mal formé.':'Missing, duplicate or malformed request.',
  'Allocation invalide.':'Invalid allocation.',
  'Les TP concernent seulement les compétences ; leur progression est positive.':'TP applies only to skills; skill progression must be positive.',
  'État de départ invalide.':'Invalid starting values.',
  'Entrée supprimée ou remplacée :':'Entry removed or replaced:',
  'La fiche a changé pour ${row.name}. Retire ce souhait puis ajoute-le à nouveau avec les valeurs actuelles.':'The sheet has changed for ${row.name}. Remove this entry and add it again using current values.',
  'Allocation impossible selon le barème pour':'Allocation unavailable under the progression rules for',
  'Budget ${type.toUpperCase()} dépassé : ${used[type]} affectés pour ${draft.amounts[type]} disponibles.':'${type.toUpperCase()} budget exceeded: ${used[type]} allocated, ${draft.amounts[type]} available.',
  'Repères des notes endommagés ou dupliqués. Aucune note ne sera écrasée.':'Note markers are damaged or duplicated. Existing notes will be preserved.',
  'Section des notes incomplète. Aucune note ne sera écrasée.':'Incomplete note section. Existing notes will be preserved.',
  'Sections des notes imbriquées.':'Overlapping note sections.',
  'Contenu des sections réservé mal formé.':'Malformed reserved note section.',
  'Données des notes illisibles. Aucune note ne sera écrasée.':'Unreadable note data. Existing notes will be preserved.',
  'Le champ des notes est indisponible.':'The notes field is unavailable.',
  'Les sections Points et Souhaits doivent être présentes ensemble.':'Points and requests sections must be present together.',
  'Version, personnage ou révision des notes incohérents.':'Inconsistent note version, character or revision.',
  'Les souhaits ou les points ont été modifiés ailleurs. Recharge les notes avant de continuer ; ton brouillon reste affiché.':'The request or points were changed elsewhere. Reload notes before continuing; your draft is still displayed.',
  'Impossible de vérifier les effets de la sauvegarde des notes sur cette fiche.':'Unable to check the effects of saving notes on this sheet.',
  'Le système voudrait recalculer automatiquement la base de ${item.name} à la sauvegarde des notes. Enregistrement bloqué pour préserver les compétences ; le MJ doit vérifier la fiche native.':'The system would recalculate the base value of ${item.name} when saving notes. Saving is blocked to preserve skills; the GM must check the native sheet.',
  'Ce compte ne peut pas enregistrer les notes de ce personnage. Le brouillon reste non enregistré ; le relais MJ sera ajouté ultérieurement.':'This account cannot save character notes. The draft remains unsaved; GM relay will be added later.',
  'Enregistrement refusé. Le brouillon reste non enregistré.':'Save refused. The draft remains unsaved.',
  'La sauvegarde n’a pas pu être vérifiée. Recharge les notes pour vérifier leur état.':'Save could not be verified. Reload notes to check their state.'
};
export function englishSource(source) {
  for (const [fr,en] of Object.entries(translations).sort((a,b)=>b[0].length-a[0].length)) source=source.replaceAll(fr,en);
  return source.replaceAll('"fr"','"en"');
}
