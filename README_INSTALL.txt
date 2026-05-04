Fichiers à envoyer à la racine du repo terrain :

1) Remplacer index.html par ce index.html
2) Ajouter cyberpunk-upgrade.css
3) Ajouter cyberpunk-patch.js
4) Remplacer icon.svg
5) Remplacer sw.js

Ce que ça fait :
- Le bouton LIVE devient cliquable.
- LIVE = la minimap suit ta position avec mouvement smooth.
- FREE = la minimap ne recentre plus toute seule, tu peux naviguer librement.
- Les petits sauts GPS sous 14 m sont ignorés sur la minimap.
- Les barres rang/score sont plus fines, style HUD Cyberpunk, sans segments internes.
- Les clients chauds passent plutôt orange que rouge danger.
- Les clients signés utilisent l’icône 🪙.
- Le favicon/app icon devient une pièce.
- Le bouton édition carte affiche 🔧.
- Le bouton rafraîchir les quêtes affiche 🪄.

Important PWA :
Après publication GitHub Pages, ferme complètement l’application installée puis rouvre-la.
Si tu vois encore l’ancienne version, ouvre le site dans Chrome, recharge une fois, puis rouvre l’app installée.
