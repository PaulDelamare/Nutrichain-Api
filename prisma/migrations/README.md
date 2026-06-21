# Migrations Prisma

Depuis la baseline `0_init` (issue #15), l'historique des migrations est **versionné dans Git**
et redevient la source de vérité du schéma. Fini le `db push` non tracé.

## Contexte

Avant cette baseline, le dossier `prisma/migrations/` était gitignoré et l'équipe synchronisait
ses bases à la main (`db push`), ce qui avait fait dériver le schéma réel des migrations (EPCIS,
`IdempotencyKey`, `Customer.email`… ajoutés sans migration). `0_init` capture l'intégralité du
schéma courant en une migration unique et propre.

## Adoption (une seule fois, par chaque dev) — bases de DEV uniquement

Les bases locales ne contiennent que du seed regénérable :

```bash
git pull
npx prisma migrate reset --force   # drop + applique 0_init + relance le seed
```

> ⚠️ Destructif sur les données locales (du seed/test uniquement). Ne JAMAIS lancer sur une base
> contenant des données réelles à conserver.

## Workflow ensuite (normal)

- Modifier `schema.prisma`, puis : `npx prisma migrate dev --name <description>` → crée + applique
  une migration **versionnée**.
- Ne plus utiliser `db push` (sauf prototypage jetable), pour ne pas redériver.
