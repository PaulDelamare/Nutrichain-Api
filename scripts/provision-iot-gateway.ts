import { randomBytes } from 'crypto';
import { prisma } from '../src/shared/configs/prismaClient.config';
import { hashGatewayKey } from '../src/shared/utils/iotGateway/iotGateway';

/**
 * NUTRICHAIN — Enregistre une passerelle IoT depuis le serveur, sans passer par l'API.
 *
 * À quoi ça sert : depuis #93, la clé capteur n'ouvre l'ingestion que si elle est enregistrée en
 * base. Sur une installation DÉJÀ en service, la migration crée la table vide — les passerelles
 * physiques passeraient donc en 401 sans que personne ne le voie (un capteur ne se plaint pas).
 * Ce script est le chemin de reprise : il ré-enregistre la clé existante, ou en émet une nouvelle.
 *
 * Usage :
 *   npm run iot:gateway -- --org <organization_id> [--nom "Passerelle Nord"] [--cle <clé existante>]
 *
 * Sans `--cle`, une clé est générée et affichée UNE fois — la base n'en garde que l'empreinte.
 */

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};

async function main() {
  const organizationId = arg('org');
  if (!organizationId) {
    console.error('Usage : npm run iot:gateway -- --org <organization_id> [--nom <nom>] [--cle <clé>]');
    process.exit(1);
  }

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, name: true },
  });
  if (!org) {
    console.error(`Organisation introuvable : ${organizationId}`);
    process.exit(1);
  }

  const name = arg('nom') ?? 'Passerelle principale';
  const key = arg('cle') ?? randomBytes(48).toString('base64url');

  const gateway = await prisma.iotGateway.create({
    data: { organization_id: org.id, nom: name, key_hash: hashGatewayKey(key) },
    select: { id: true, nom: true },
  });

  console.log(`\n✅ Passerelle « ${gateway.nom} » enregistrée pour ${org.name} (${org.id}).`);
  console.log(`   id  : ${gateway.id}`);
  console.log(`   clé : ${key}`);
  console.log("\n⚠️  Cette clé ne sera plus jamais affichée : la base n'en garde que l'empreinte.\n");
}

main()
  .catch((e) => {
    console.error(`\n❌ ${e instanceof Error ? e.message : e}\n`);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
