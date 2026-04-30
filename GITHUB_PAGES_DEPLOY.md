# Déployer TERRAIN sur GitHub Pages

## 1. Créer le dépôt

1. Va sur https://github.com/new
2. Nom recommandé : `terrain`
3. Mets le dépôt en `Public`
4. Clique sur `Create repository`

## 2. Envoyer les fichiers

Option simple depuis GitHub :

1. Ouvre ton dépôt GitHub
2. Clique sur `Add file` puis `Upload files`
3. Dépose le contenu du zip `terrain-github-pages.zip`
4. Clique sur `Commit changes`

Les fichiers doivent être à la racine du dépôt, pas dans un sous-dossier.

## 3. Activer GitHub Pages

1. Va dans `Settings`
2. Menu `Pages`
3. Dans `Build and deployment`, choisis :
   - Source : `Deploy from a branch`
   - Branch : `main`
   - Folder : `/ (root)`
4. Clique sur `Save`

GitHub donnera une URL du type :

```text
https://tonpseudo.github.io/terrain/
```

## 4. Point important Supabase

L'app TERRAIN est un site statique public. La clé Supabase `anon` est donc visible dans le navigateur, ce qui est normal pour une app frontend.

À vérifier côté Supabase :

- RLS activé sur `clients` et `daily_scores`
- lecture autorisée avec la clé anon
- écriture autorisée seulement sur les champs nécessaires si tu veux que `Poser` / `GPS ici` écrive depuis l'app
- sinon Claude peut rester le seul à écrire dans la base

## 5. Mise à jour du site

Quand Codex modifie l'app :

1. Remplace les fichiers du dépôt par les nouveaux
2. Commit
3. Attends 1 à 2 minutes
4. Recharge la PWA

Si l'ancien site reste affiché, ferme/réouvre la PWA ou vide le cache du navigateur.
