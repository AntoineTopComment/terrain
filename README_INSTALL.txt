PACK COMPLET TERRAIN - FIELD OPS v32

Ce zip contient les fichiers necessaires pour remettre le site en ligne sur GitHub Pages :
- index.html
- style.css
- app.js
- map.js
- score.js
- manifest.json
- sw.js
- icon.svg
- icon-192.png
- icon-512.png

Installation rapide :
1. Dezippe le dossier.
2. Dans le repo GitHub terrain, remplace les fichiers a la racine par ceux du dossier.
3. Commit les changements.
4. Recharge la PWA sur tablette.

Important tablette / PWA :
- Le service worker est passe en cache terrain-v32.
- Si l'ancienne version reste affichee, ferme completement la PWA puis rouvre-la.
- Si besoin : Chrome > Parametres du site > Stockage > Effacer les donnees, ou desinstalle/reinstalle l'icone PWA.

Ce pack utilise uniquement la cle anon publique cote client.

Inclus :
- Cockpit FIELD OPS plein ecran restaure.
- Titre FIELD OPS avec glitch anime.
- Bouton LIVE/FREE cliquable pour activer ou suspendre le suivi GPS.
- Recentrage GPS smooth avec seuil anti-jitter.
- Minimap sombre lisible avec marqueurs Cyberpunk.
- Marqueurs quete separes des cartes de quete pour eviter les conflits CSS.
- Quetes sans sous-fond de panneau et sans ascenseur horizontal.
- Boutons edition et refresh en icones.
- Carte simplifiee en 3 niveaux : gris vide = neutre/froid, orange ! = action/opportunite, vert vide = signe.


V30 : remplace les anciens blocs rang/score par un HUD Cyberpunk 2077. Le HUD lit ranks et daily_scores.sales_count en lecture seule. Migration Supabase déjà faite côté Claude, ne pas rejouer de SQL depuis ce zip.


Version 32 : HUD resserré, quêtes déplacées en bas à droite, bouton outil placé à côté du LIVE/FREE.


---

AJOUT POLICE PERSONNALISÉE DU TITRE

Cette version repart de FIELD OPS v32.
Elle garde l'effet glitch animé du titre de la v32.
La seule nouveauté est la possibilité de changer la police du titre du rang.

Pour l'utiliser :
1. Dézippe le dossier du site.
2. Mets ton fichier OpenType dans le dossier fonts/.
3. Renomme-le exactement : title-font.otf
4. Le chemin doit donc être : fonts/title-font.otf
5. Relance le serveur local.
6. Si l'ancienne police reste affichée, vide le cache du site.

La police n'est pas fournie dans ce zip.


Version UI2 : fond noir sur les icônes action, quêtes repliables, performances récentes stylées façon map, GPS rond pulsant.
