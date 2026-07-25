import { defineConfig } from 'vitest/config'

// Suite séparée des tests unitaires : ces fichiers parlent à un VRAI PostgreSQL (aucun mock de
// Prisma), pour prouver des invariants que la base garantit elle-même (contraintes, verrous,
// séquences, cascades) — un mock validerait un comportement qui n'existe pas (#150). Nécessite
// DATABASE_URL pointant vers une base jetable ; lancée par la CI dans le job E2E, qui provisionne
// déjà PostgreSQL, jamais dans `quality-gates` (aucun service DB là-bas).
export default defineConfig({
    test: {
        globals: true,
        include: ['src/**/*.integration.test.ts'],
        // Les invariants testés ici (verrou consultatif, séquence, unicité) supposent un état de
        // base partagé et non concurrent entre fichiers : les isoler évite qu'un test lise l'état
        // laissé par un autre en parallèle.
        fileParallelism: false,
    },
})
