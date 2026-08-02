import { describe, it, expect, vi, beforeEach } from 'vitest';
import { batchService } from './batch.service';
import { prisma } from '../../../../shared/configs/prismaClient.config';
import { auditService } from '../../../../shared/utils/audit/audit.service';
import { MOVEMENT_TYPES, BATCH_STATUSES, QUALITY_RESULTS } from '../../constants/logistics.constants';

vi.mock('../../../../shared/configs/prismaClient.config', () => ({
  prisma: {
    $transaction: vi.fn(),
    batch: { findFirst: vi.fn(), updateMany: vi.fn() },
    qualityControl: { findFirst: vi.fn(), findMany: vi.fn() },
    batch_Mouvement: { findMany: vi.fn(), create: vi.fn() },
    member: { findFirst: vi.fn() },
    alert: { findFirst: vi.fn() },
  },
}));

vi.mock('../../../../shared/utils/audit/audit.service', () => ({
  auditService: { logAction: vi.fn() },
}));

const orgId = 'org-1';
const batchId = 'lot-1';
/** Le contrôleur qui lève : différent du signataire de la non-conformité, sauf test contraire. */
const userId = 'user-controleur';
const signataire = 'user-labo';
const motif = 'Contre-analyse conforme du 02/08';

/** Le lot bloqué par un contrôle non conforme, revenu de `EN_ATTENTE_QC`. */
const blockedBatch = {
  id: batchId,
  organization_id: orgId,
  statut: BATCH_STATUSES.BLOCKED,
  statut_avant_blocage: BATCH_STATUSES.PENDING_QC,
  created_by: 'user-operateur',
  version: 3,
  quantite_actuelle: '40',
  unite_code: 'KG',
  id_materiel_actuel: 'chambre-froide-1',
};

/** Contrôles : la non-conformité, puis la contre-analyse conforme qui la suit. */
const controls = [
  { id: 'qc-1', resultat: QUALITY_RESULTS.NON_CONFORM, id_user_labo: signataire, date_test: new Date('2026-08-01') },
  { id: 'qc-2', resultat: QUALITY_RESULTS.CONFORM, id_user_labo: signataire, date_test: new Date('2026-08-02') },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.$transaction).mockImplementation((cb: (tx: unknown) => Promise<unknown>) =>
    cb(prisma)
  );
  vi.mocked(prisma.batch.findFirst).mockResolvedValue(blockedBatch as never);
  vi.mocked(prisma.qualityControl.findMany).mockResolvedValue(controls as never);
  // Aucun mouvement ni alerte ouverte : donc aucune isolation froid en vigueur.
  vi.mocked(prisma.batch_Mouvement.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.alert.findFirst).mockResolvedValue(null as never);
  vi.mocked(prisma.batch.updateMany).mockResolvedValue({ count: 1 } as never);
  // Un autre decideur habilite existe : la separation des taches peut donc s appliquer.
  vi.mocked(prisma.member.findFirst).mockResolvedValue({ id: 'membre-2' } as never);
  vi.mocked(auditService.logAction).mockResolvedValue({} as never);
});

describe('batchService.liftQualityQuarantine', () => {
  it('rend le lot à son statut d’AVANT le blocage, pas à EN_STOCK', async () => {
    // Un produit fini bloqué attendait son contrôle de sortie : le rendre EN_STOCK le rendrait
    // expédiable sans que la barrière HACCP n'ait jamais été franchie.
    await batchService.liftQualityQuarantine(batchId, orgId, userId, motif);

    expect(vi.mocked(prisma.batch.updateMany).mock.calls[0][0].data).toMatchObject({
      statut: BATCH_STATUSES.PENDING_QC,
      statut_avant_blocage: null,
    });
  });

  /**
   * Sans statut mémorisé (lots bloqués avant que le contrôle qualité ne l'écrive), on retombe sur
   * l'état le PLUS PRUDENT : le lot repasse par un contrôle de sortie plutôt que d'être expédiable.
   */
  it('retombe sur EN_ATTENTE_QC quand aucun statut n’a été mémorisé', async () => {
    vi.mocked(prisma.batch.findFirst).mockResolvedValue({
      ...blockedBatch,
      statut_avant_blocage: null,
    } as never);

    await batchService.liftQualityQuarantine(batchId, orgId, userId, motif);

    expect(vi.mocked(prisma.batch.updateMany).mock.calls[0][0].data).toMatchObject({
      statut: BATCH_STATUSES.PENDING_QC,
    });
  });

  it('exige une contre-analyse CONFORME postérieure à la non-conformité', async () => {
    vi.mocked(prisma.qualityControl.findMany).mockResolvedValue([controls[0]] as never);

    await expect(
      batchService.liftQualityQuarantine(batchId, orgId, userId, motif)
    ).rejects.toMatchObject({ status: 409 });
    expect(prisma.batch.updateMany).not.toHaveBeenCalled();
  });

  /** Une contre-analyse ANTÉRIEURE ne prouve rien : c'est la non-conformité qui a le dernier mot. */
  it('refuse une contre-analyse antérieure au dernier verdict non conforme', async () => {
    vi.mocked(prisma.qualityControl.findMany).mockResolvedValue([
      { ...controls[1], date_test: new Date('2026-07-30') },
      { ...controls[0], date_test: new Date('2026-08-01') },
    ] as never);

    await expect(
      batchService.liftQualityQuarantine(batchId, orgId, userId, motif)
    ).rejects.toMatchObject({ status: 409 });
  });

  /**
   * LE défaut que la réfutation a trouvé : un lot peut être bloqué par le froid ET condamné par un
   * contrôle. Le libérer par le canal qualité le sortirait d'un frigo toujours en panne.
   */
  it('refuse tant qu’une isolation froid est en vigueur', async () => {
    vi.mocked(prisma.batch_Mouvement.findMany).mockResolvedValue([
      { id: 10, type_action: MOVEMENT_TYPES.COLD_QUARANTINE, metadata: {} },
    ] as never);

    await expect(
      batchService.liftQualityQuarantine(batchId, orgId, userId, motif)
    ).rejects.toMatchObject({ status: 409 });
    expect(prisma.batch.updateMany).not.toHaveBeenCalled();
  });

  it('accepte quand l’isolation froid a été levée depuis', async () => {
    vi.mocked(prisma.batch_Mouvement.findMany).mockResolvedValue([
      { id: 10, type_action: MOVEMENT_TYPES.COLD_QUARANTINE, metadata: {} },
      { id: 11, type_action: MOVEMENT_TYPES.QUARANTINE_LIFTED, metadata: {} },
    ] as never);

    await expect(
      batchService.liftQualityQuarantine(batchId, orgId, userId, motif)
    ).resolves.toBeDefined();
  });

  /**
   * L'angle mort que la réfutation a trouvé : un lot DÉJÀ `BLOQUE` quand l'excursion le frappe
   * n'est pas re-marqué par `iotAlert.service` (cf. `COLD_QUARANTINABLE_STATUSES`). Aucun
   * mouvement `QUARANTAINE_FROID` n'existe donc, et la garde par les mouvements le laissait
   * ressortir d'un frigo en panne. Seul l'état réel de l'alerte le dit.
   */
  it('refuse quand une excursion NON RÉSOLUE couvre l’équipement, sans aucun mouvement froid', async () => {
    vi.mocked(prisma.alert.findFirst).mockResolvedValue({ id: 'alerte-froid-1' } as never);

    await expect(
      batchService.liftQualityQuarantine(batchId, orgId, userId, motif)
    ).rejects.toMatchObject({ status: 409 });
    expect(prisma.batch.updateMany).not.toHaveBeenCalled();
  });

  /**
   * La borne de date fait tout le travail : une excursion ANTÉRIEURE à la condamnation a déjà été
   * traitée par le canal froid (elle aurait laissé un mouvement). Sans cette borne, une vieille
   * alerte jamais résolue retiendrait indéfiniment des lots que le froid n'a jamais isolés — c'est
   * ce qui s'est produit sur les données réelles, où tout lot rangé dans la chambre concernée
   * devenait inlibérable.
   */
  it('ne retient que les excursions détectées APRÈS la condamnation', async () => {
    await batchService.liftQualityQuarantine(batchId, orgId, userId, motif);

    expect(vi.mocked(prisma.alert.findFirst).mock.calls[0][0].where).toMatchObject({
      created_at: { gt: controls[0].date_test },
    });
  });

  it('ne cherche pas d’alerte froid pour un lot sans emplacement', async () => {
    vi.mocked(prisma.batch.findFirst).mockResolvedValue({
      ...blockedBatch,
      id_materiel_actuel: null,
    } as never);

    await batchService.liftQualityQuarantine(batchId, orgId, userId, motif);

    expect(prisma.alert.findFirst).not.toHaveBeenCalled();
  });

  it('refuse un lot qui n’est pas en quarantaine', async () => {
    vi.mocked(prisma.batch.findFirst).mockResolvedValue({
      ...blockedBatch,
      statut: BATCH_STATUSES.IN_STOCK,
    } as never);

    await expect(
      batchService.liftQualityQuarantine(batchId, orgId, userId, motif)
    ).rejects.toMatchObject({ status: 409 });
  });

  it('rend 404 sur un lot d’une autre organisation', async () => {
    vi.mocked(prisma.batch.findFirst).mockResolvedValue(null);

    await expect(
      batchService.liftQualityQuarantine(batchId, orgId, userId, motif)
    ).rejects.toMatchObject({ status: 404 });
    // Un mock qui rend `null` renverrait 404 même SANS filtre d'organisation : c'est la clause
    // qu'il faut prouver, pas la réponse.
    expect(vi.mocked(prisma.batch.findFirst).mock.calls[0][0].where).toMatchObject({
      organization_id: orgId,
    });
  });

  /**
   * La séparation des tâches porte sur le SIGNATAIRE de la non-conformité, pas sur le créateur du
   * lot : sinon la même personne condamne et décondamne sans qu'aucune garde ne s'en aperçoive.
   */
  it('refuse au signataire de la non-conformité de lever seul', async () => {
    await expect(
      batchService.liftQualityQuarantine(batchId, orgId, signataire, motif)
    ).rejects.toMatchObject({ status: 403 });
  });

  it('laisse passer le signataire s’il est le seul décideur, et le trace', async () => {
    // Une organisation d'une seule personne — l'état de TOUTE organisation à sa création — verrait
    // sinon ses lots figés définitivement.
    vi.mocked(prisma.member.findFirst).mockResolvedValue(null as never);

    await batchService.liftQualityQuarantine(batchId, orgId, signataire, motif);

    const trace = JSON.stringify(vi.mocked(auditService.logAction).mock.calls[0][0].newValue);
    expect(trace).toContain('AUTO_SIGNEE');
  });

  it('trace le geste dans son propre mouvement, et scelle la décision', async () => {
    await batchService.liftQualityQuarantine(batchId, orgId, userId, motif);

    // Type DISTINCT de la levée froid : `alertBatch.service` lit `LEVEE_QUARANTAINE` pour savoir
    // si une isolation froid a été levée. Réutiliser le même type lui ferait croire que oui.
    expect(vi.mocked(prisma.batch_Mouvement.create).mock.calls[0][0].data).toMatchObject({
      type_action: MOVEMENT_TYPES.QUALITY_QUARANTINE_LIFTED,
      id_user: userId,
    });
    expect(vi.mocked(auditService.logAction).mock.calls[0][0].action).toBe(
      'LIFT_QUALITY_QUARANTINE'
    );
    // Deuxième argument = la transaction : hors d'elle, un rollback laisserait la levée sans preuve.
    expect(vi.mocked(auditService.logAction).mock.calls[0][1]).toBe(prisma);
  });

  it('refuse si l’état du lot a changé pendant la levée', async () => {
    vi.mocked(prisma.batch.updateMany).mockResolvedValue({ count: 0 } as never);

    await expect(
      batchService.liftQualityQuarantine(batchId, orgId, userId, motif)
    ).rejects.toMatchObject({ status: 409 });
  });

  /**
   * Le `count === 0` ci-dessus se déclenche avec ou sans verrou : seul le `where` prouve que la
   * levée refuse une décision concurrente au lieu d'écraser un état plus récent.
   */
  it('conditionne l’écriture à la version lue, et au tenant', async () => {
    await batchService.liftQualityQuarantine(batchId, orgId, userId, motif);

    expect(vi.mocked(prisma.batch.updateMany).mock.calls[0][0].where).toMatchObject({
      id: batchId,
      organization_id: orgId,
      version: blockedBatch.version,
    });
  });
});
