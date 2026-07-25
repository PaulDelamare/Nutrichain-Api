import { defineConfig, configDefaults } from 'vitest/config'

export default defineConfig({
    test: {
        globals: true,
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
