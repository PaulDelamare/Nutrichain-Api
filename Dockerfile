# Étape 1 : Construction (Builder)
FROM node:20-alpine AS builder

WORKDIR /app

# Copier les fichiers de définition des dépendances
COPY package*.json ./
COPY prisma ./prisma/

# Installer TOUTES les dépendances (y compris devDependencies pour la compilation)
RUN npm ci

# Copier le code source complet
COPY . .

# Générer le client Prisma
RUN npx prisma generate

# Compiler le code TypeScript en JavaScript (dans le dossier dist/)
RUN npm run build

# Étape 2 : Production
FROM node:20-alpine

# Facultatif : installer ffmpeg uniquement si votre API Nutrichain en a réellement besoin (traitement vidéo/audio)
# RUN apk add --no-cache ffmpeg

WORKDIR /app

# Copier les packages et installer uniquement les dépendances de production
COPY package*.json ./
RUN npm ci --omit=dev

# Copier le client Prisma généré pour que l'ORM fonctionne en production
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

# Copier les fichiers JavaScript compilés (d'après votre tsconfig.json qui spécifie "outDir": "dist")
COPY --from=builder /app/dist ./dist

# Configurer l'environnement
ENV NODE_ENV=production

# Exposer le port de l'application
EXPOSE 3030

# Lancer la version compilée
CMD ["node", "dist/server.js"]