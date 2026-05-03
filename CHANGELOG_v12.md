# CHANGELOG v12

## Graphique "Performance récente" — refonte du scaling

### Bug
Le scaling utilisait `Math.min(100, percent * 0.78)`. Toute barre au-delà de
~128% était cappée à 100% de hauteur. Conséquence : 130%, 150%, 200% rendaient
la même hauteur. Impossible de voir la différence visuelle entre un jour
correct et un jour exceptionnel.

### Fix
Scaling **dynamique relatif au max du jeu affiché** :
- La barre la plus haute occupe 100% de la hauteur disponible.
- Les autres sont proportionnelles à leur ratio sur ce max.
- Plancher : la référence min reste 100% — donc tant qu'aucune barre ne dépasse
  100%, l'échelle reste stable et lisible.

Résultat : un jour à 200% écrase visuellement un jour à 130% (130/200 = 65% de
hauteur). On voit instantanément la "claque".

### Limite réduite
Avant : 14 derniers jours créés.
Après : **8 derniers jours créés** (= jour en cours + 7 antérieurs en pratique).
Plus lisible sur mobile, écarts plus marqués.

## Bumps de version
- `?v=11` → `?v=12`
- `terrain-v11` → `terrain-v12`
