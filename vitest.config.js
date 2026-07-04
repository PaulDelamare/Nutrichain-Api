import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        globals: true,
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'lcov'],
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
