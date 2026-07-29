import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
    test: {
        globals: true,
        // Timeout par test et par hook. Le défaut de Vitest (5 s) était trop serré pour CE
        // dépôt, PAS parce qu'un test est lent en soi (#267) : `betterAuth({...})` s'instancie
        // AU CHARGEMENT de `auth.config`, et Vitest isole chaque fichier dans son propre fork.
        // Le premier test d'un fork qui touche la chaîne d'auth (directement, ou via un
        // contrôleur / une route protégée) paie donc, seul, l'import à froid de tout ce graphe.
        // Mesuré sous 9 cœurs saturés, ce coût atteignait 4,2 s pour `health.routes.test`
        // (« routeurs distincts », qui importe `hello.routes` → `requireAuth` → `auth.config`)
        // et 2,5 s pour `register.test` — les deux frôlaient les 5 s. Sur un runner CI plus lent
        // et partagé, ils basculaient au hasard en timeout : le check requis rougissait sans
        // qu'aucun code métier n'ait changé.
        //
        // Ce n'est donc ni un `retry` ni une `attente` posés sur un bug (le test PASSE) : c'est
        // le redimensionnement d'un défaut inadapté au profil d'import de ce dépôt. 15 s laisse
        // ~3,5× de marge sur le pire cas observé tout en restant assez court pour qu'un vrai
        // blocage ressorte comme un échec.
        testTimeout: 15_000,
        hookTimeout: 15_000,
        // Les tests d'intégration (`*.integration.test.ts`, cf. #150) parlent à un vrai
        // PostgreSQL : `npm test` tourne sans base disponible (poste de dev, job `quality-gates`
        // de la CI), les faire échouer là serait un faux négatif. Suite séparée : `npm run
        // test:integration` (vitest.integration.config.mjs), lancée uniquement dans le job E2E.
        exclude: [...configDefaults.exclude, 'src/**/*.integration.test.ts'],
        coverage: {
            provider: 'v8',
            // `json-summary` alimente le récapitulatif publié par la CI : le seuil ne sert à rien
            // si personne ne voit le chiffre.
            reporter: ['text', 'html', 'lcov', 'json-summary'],
            include: ['src/**/*.ts'],
            // Exclus du périmètre : fichiers sans logique testable unitairement
            // (bootstrap serveur, déclarations de types, templates d'e-mails JSX,
            // config Swagger). La logique métier, elle, reste intégralement mesurée.
            exclude: [
                'src/server.ts',
                'src/**/types/**',
                'src/**/*.types.ts',
                'src/**/*.model.ts',
                'src/shared/utils/mailer/templates/**',
                'src/shared/configs/swagger*.ts',
                'src/**/*.test.ts',
            ],
            // Plancher exigé par le cahier des charges (≥ 70 %) — la CI échoue en dessous.
            thresholds: {
                lines: 70,
                functions: 70,
                branches: 70,
                statements: 70,
            },
        },
    },
})
