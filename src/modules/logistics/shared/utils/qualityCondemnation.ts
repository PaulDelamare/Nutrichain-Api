import { Prisma } from '@prisma/client';
import { QUALITY_RESULTS } from '../../constants/logistics.constants';

/** Un contrôle, réduit à ce qui sert à décider si le lot est encore condamné. */
export interface QualityVerdict {
  id: string;
  resultat: string;
  id_user_labo: string;
  date_test: Date;
}

export interface QualityCondemnation {
  /** Le dernier verdict non conforme : c'est lui qui retient le lot. */
  nonConformity: QualityVerdict;
  /** La contre-analyse conforme qui le dément, si elle a été enregistrée. */
  counterAnalysis: QualityVerdict | null;
}

/**
 * « Ce lot est-il encore condamné par la qualité ? » — LA question, posée une seule fois.
 *
 * Elle se pose à trois endroits qui doivent répondre pareil : la levée qualité (qui exige la
 * contre-analyse), la levée froid (qui doit refuser tant que la qualité retient le lot) et l'écran
 * d'alerte (qui annonce à l'utilisateur si le lot est levable). Chacun avait sa propre lecture, et
 * la plus fragile — « le DERNIER contrôle est-il non conforme ? » — devenait fausse dès qu'une
 * contre-analyse s'enregistrait : elle rendait la levée froid permissive sur un lot condamné.
 *
 * La condamnation ne se lit donc pas au dernier verdict, mais à la dernière non-conformité NON
 * DÉMENTIE par un contrôle conforme postérieur.
 */
export function readQualityCondemnation(controls: QualityVerdict[]): QualityCondemnation | null {
  const nonConformity = [...controls]
    .sort(compareByTestDate)
    .reverse()
    .find((c) => c.resultat === QUALITY_RESULTS.NON_CONFORM);

  if (!nonConformity) return null;

  // Un contrôle conforme ANTÉRIEUR ne prouve rien : c'est la non-conformité qui a eu le dernier
  // mot. Comparaison stricte sur la date seule — `id` est un uuid, son ordre n'a aucun sens
  // chronologique, et à date égale on préfère refuser.
  const counterAnalysis =
    controls
      .filter((c) => c.resultat === QUALITY_RESULTS.CONFORM)
      .sort(compareByTestDate)
      .find((c) => c.date_test > nonConformity.date_test) ?? null;

  return { nonConformity, counterAnalysis };
}

/** Tri chronologique stable : `id` ne départage que pour rendre l'ordre reproductible. */
function compareByTestDate(a: QualityVerdict, b: QualityVerdict): number {
  const delta = a.date_test.getTime() - b.date_test.getTime();
  return delta !== 0 ? delta : a.id.localeCompare(b.id);
}

/** Les contrôles d'un lot, dans la forme attendue par `readQualityCondemnation`. */
export async function loadQualityVerdicts(
  tx: Prisma.TransactionClient,
  batchId: string,
  organizationId: string
): Promise<QualityVerdict[]> {
  return tx.qualityControl.findMany({
    where: { id_lot: batchId, organization_id: organizationId },
    orderBy: [{ date_test: 'asc' }, { id: 'asc' }],
    select: { id: true, resultat: true, id_user_labo: true, date_test: true },
  });
}
