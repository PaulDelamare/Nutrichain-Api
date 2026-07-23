import { describe, it, expect, vi, beforeEach } from 'vitest';
import { batchService } from './batch.service';
import { prisma } from '../../../../shared/configs/prismaClient.config';
import { auditService } from '../../../../shared/utils/audit/audit.service';
import { APIError } from '../../../../shared/utils/errorHandler/APIError';

vi.mock('../../../../shared/configs/prismaClient.config', () => ({
  prisma: {
    batch: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    batch_Mouvement: { create: vi.fn() },
    qualityControl: { findFirst: vi.fn() },
    member: { findFirst: vi.fn() },
    // Simule une transaction en passant le mock prisma au callback
    $transaction: vi.fn(async (cb) => cb(prisma)),
  },
}));

vi.mock('../../../../shared/utils/audit/audit.service', () => ({
  auditService: { logAction: vi.fn() },
}));

describe('BatchSharedService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Par défaut l'organisation compte un second décideur : la séparation des tâches s'applique.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(prisma.member.findFirst).mockResolvedValue({ id: 'membre-qualite' } as any);
    // Par défaut aucun contrôle qualité condamnant : la levée de quarantaine froid est possible.
    // `clearAllMocks` n'efface pas les implémentations — sans ce défaut, un mock NON_CONFORME
    // fuirait d'un test à l'autre. Chaque test part donc d'un lot non condamné.
    vi.mocked(prisma.qualityControl.findFirst).mockResolvedValue(null);
  });

  describe('createBatch', () => {
    it('doit créer un lot avec les données fournies', async () => {
      const mockTx = {
        batch: {
          create: vi.fn().mockResolvedValue({ id: 'batch-123' }),
        },
      };

      const data = {
        organization_id: 'org-1',
        id_produit: 'prod-1',
        quantite_actuelle: 100,
        unite_code: 'KG',
        created_by: 'user-1',
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await batchService.createBatch(mockTx as any, data);

      expect(mockTx.batch.create).toHaveBeenCalledWith({
        data: {
          ...data,
          date_peremption: undefined,
          lot_number: expect.stringMatching(/^[0-9]{6}-[0-9A-Z]{6}$/),
          quantite_base: data.quantite_actuelle,
          statut: 'EN_STOCK',
        },
      });
      expect(result.id).toBe('batch-123');
    });

    it('rattache le lot à sa réception quand id_receipt est fourni', async () => {
      const mockTx = { batch: { create: vi.fn().mockResolvedValue({ id: 'batch-r' }) } };

      await batchService.createBatch(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mockTx as any,
        {
          organization_id: 'org-1',
          id_produit: 'prod-1',
          quantite_actuelle: 100,
          unite_code: 'KG',
          created_by: 'user-1',
          id_receipt: 'rec-1',
        }
      );

      expect(mockTx.batch.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ id_receipt: 'rec-1' }),
      });
    });

    // La promesse centrale : le numéro imprimé par le fournisseur est celui écrit en base. Sans ce
    // test, retirer le `?? generateLotNumber()` (donc jeter le numéro fournisseur) ne fait rougir
    // AUCUN test unitaire — la réception mocke `createBatch` et ne voit rien.
    it("écrit le numéro de lot du fournisseur au lieu d'en générer un", async () => {
      const mockTx = { batch: { create: vi.fn().mockResolvedValue({ id: 'batch-789' }) } };

      await batchService.createBatch(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mockTx as any,
        {
          organization_id: 'org-1',
          id_produit: 'prod-1',
          quantite_actuelle: 100,
          unite_code: 'KG',
          created_by: 'user-1',
          lot_number: 'FRN-ABC123',
        }
      );

      expect(mockTx.batch.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ lot_number: 'FRN-ABC123' }),
        })
      );
    });

    it('doit créer le lot avec le statut initial fourni (quarantaine BLOQUE)', async () => {
      const mockTx = {
        batch: {
          create: vi.fn().mockResolvedValue({ id: 'batch-456' }),
        },
      };

      const data = {
        organization_id: 'org-1',
        id_produit: 'prod-1',
        quantite_actuelle: 100,
        unite_code: 'KG',
        created_by: 'user-1',
        statut: 'BLOQUE' as const,
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await batchService.createBatch(mockTx as any, data);

      expect(mockTx.batch.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ statut: 'BLOQUE' }),
      });
    });
  });

  describe('liftQuarantine', () => {
    it('doit lever la quarantaine (BLOQUE -> EN_STOCK) et tracer la décision dans l audit', async () => {
      vi.mocked(prisma.batch.findFirst).mockResolvedValue(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { id: 'batch-1', organization_id: 'org-1', statut: 'BLOQUE', created_by: 'operateur-2' } as any
      );
      vi.mocked(prisma.batch.update).mockResolvedValue({
        id: 'batch-1',
        statut: 'EN_STOCK',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const result = await batchService.liftQuarantine(
        'batch-1',
        'org-1',
        'user-1',
        'Contrôle refait OK'
      );

      expect(prisma.batch.update).toHaveBeenCalledWith({
        where: { id: 'batch-1' },
        data: expect.objectContaining({ statut: 'EN_STOCK' }),
      });
      expect(auditService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'LIFT_BATCH_QUARANTINE',
          entity: 'Batch',
          entityId: 'batch-1',
          oldValue: { statut: 'BLOQUE' },
          newValue: expect.objectContaining({ statut: 'EN_STOCK', motif: 'Contrôle refait OK' }),
        }),
        expect.anything()
      );
      expect(result.statut).toBe('EN_STOCK');
    });

    it('la levée entre dans l historique du lot, avec son motif', async () => {
      vi.mocked(prisma.batch.findFirst).mockResolvedValue({
        id: 'batch-1',
        organization_id: 'org-1',
        statut: 'BLOQUE',
        quantite_actuelle: 42,
        unite_code: 'KG',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.batch.update).mockResolvedValue({ id: 'batch-1' } as any);

      await batchService.liftQuarantine('batch-1', 'org-1', 'user-1', '2e contrôle conforme');

      // Sans ce mouvement, la décision qualité n'apparaît nulle part sur la fiche du lot :
      // le lot redevient « conforme » sans que rien n'explique pourquoi.
      expect(prisma.batch_Mouvement.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id_lot: 'batch-1',
          type_action: 'LEVEE_QUARANTAINE',
          quantite: 42,
          unite: 'KG',
          id_user: 'user-1',
          metadata: expect.objectContaining({ motif: '2e contrôle conforme' }),
        }),
      });
    });

    it('doit refuser (404) un lot d une autre organisation', async () => {
      vi.mocked(prisma.batch.findFirst).mockResolvedValue(null);

      const action = batchService.liftQuarantine('batch-x', 'org-1', 'user-1', 'motif');
      await expect(action).rejects.toMatchObject({ status: 404 });
      expect(prisma.batch.update).not.toHaveBeenCalled();
    });

    it('doit refuser (409) la levée si le lot n est pas en quarantaine', async () => {
      vi.mocked(prisma.batch.findFirst).mockResolvedValue(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { id: 'batch-1', organization_id: 'org-1', statut: 'EN_STOCK', created_by: 'operateur-2' } as any
      );

      const action = batchService.liftQuarantine('batch-1', 'org-1', 'user-1', 'motif');
      await expect(action).rejects.toThrow(APIError);
      await expect(action).rejects.toMatchObject({ status: 409 });
      expect(prisma.batch.update).not.toHaveBeenCalled();
      expect(auditService.logAction).not.toHaveBeenCalled();
    });

    /**
     * Séparation des tâches HACCP : sans cette garde, un `admin` — présent dans WRITE_ROLES ET
     * QUALITY_ROLES — produit un lot, le voit partir en quarantaine, et signe lui-même sa remise
     * en stock. Le contrôle qualité ne serait alors qu'une formalité auto-administrée.
     */
    it("doit refuser (403) la levée par celui qui a produit le lot", async () => {
      vi.mocked(prisma.batch.findFirst).mockResolvedValue(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { id: 'batch-1', organization_id: 'org-1', statut: 'BLOQUE', created_by: 'user-1' } as any
      );

      const action = batchService.liftQuarantine('batch-1', 'org-1', 'user-1', 'motif');
      await expect(action).rejects.toMatchObject({ status: 403 });
      expect(prisma.batch.update).not.toHaveBeenCalled();
      expect(auditService.logAction).not.toHaveBeenCalled();
    });

    /**
     * Échappement mono-membre : une organisation à un seul décideur ne doit pas se retrouver avec
     * des lots inlibérables — y compris ceux mis en quarantaine automatiquement par une excursion
     * de température. On laisse passer, et l'audit dit que la décision est auto-signée.
     */
    it("lève malgré tout, en le traçant, quand personne d'autre ne peut décider", async () => {
      vi.mocked(prisma.batch.findFirst).mockResolvedValue(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { id: 'batch-1', organization_id: 'org-1', statut: 'BLOQUE', created_by: 'user-1' } as any
      );
      vi.mocked(prisma.member.findFirst).mockResolvedValue(null);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.batch.update).mockResolvedValue({ id: 'batch-1' } as any);

      await batchService.liftQuarantine('batch-1', 'org-1', 'user-1', 'seul habilité');

      expect(auditService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          newValue: expect.objectContaining({
            separation_des_taches: 'AUTO_SIGNEE_AUCUN_AUTRE_DECIDEUR',
          }),
        }),
        expect.anything()
      );
    });

    it('laisse un tiers lever la quarantaine du lot', async () => {
      vi.mocked(prisma.batch.findFirst).mockResolvedValue(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { id: 'batch-1', organization_id: 'org-1', statut: 'BLOQUE', created_by: 'operateur-2' } as any
      );
      vi.mocked(prisma.batch.update).mockResolvedValue({
        id: 'batch-1',
        statut: 'EN_STOCK',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const result = await batchService.liftQuarantine('batch-1', 'org-1', 'user-1', 'motif');

      expect(result.statut).toBe('EN_STOCK');
    });

    /**
     * Le cœur du correctif HACCP : un produit fini mis en quarantaine froid alors qu'il attendait
     * son contrôle de sortie (EN_ATTENTE_QC) DOIT y retourner à la levée — pas devenir expédiable
     * au seul motif que l'incident frigo est résolu. La barrière « rien ne sort sans contrôle »
     * était franchissable par un simple incident de chambre froide.
     */
    it('restaure le statut d avant-quarantaine (EN_ATTENTE_QC), au lieu de forcer EN_STOCK', async () => {
      vi.mocked(prisma.batch.findFirst).mockResolvedValue({
        id: 'batch-1',
        organization_id: 'org-1',
        statut: 'BLOQUE',
        statut_avant_blocage: 'EN_ATTENTE_QC',
        created_by: 'operateur-2',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.batch.update).mockResolvedValue({ id: 'batch-1', statut: 'EN_ATTENTE_QC' } as any);

      const result = await batchService.liftQuarantine('batch-1', 'org-1', 'user-1', 'Frigo réparé');

      expect(prisma.batch.update).toHaveBeenCalledWith({
        where: { id: 'batch-1' },
        data: expect.objectContaining({ statut: 'EN_ATTENTE_QC', statut_avant_blocage: null }),
      });
      // L'audit WORM — la preuve HACCP opposable — doit refléter le VRAI statut, pas EN_STOCK.
      expect(auditService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          newValue: expect.objectContaining({ statut: 'EN_ATTENTE_QC' }),
        }),
        expect.anything()
      );
      expect(result.statut).toBe('EN_ATTENTE_QC');
    });

    /**
     * Un lot déclaré NON CONFORME par le labo pendant sa quarantaine froid ne se libère PAS par ce
     * canal : réparer la chambre froide ne rend pas consommable un produit contaminé. Sans cette
     * garde, le décideur lève la quarantaine, le lot repasse en attente de contrôle, un contrôle
     * de routine le déclare conforme, et le produit condamné part en magasin.
     */
    it('refuse (409) la levée d un lot condamné par un contrôle non conforme', async () => {
      vi.mocked(prisma.batch.findFirst).mockResolvedValue({
        id: 'batch-1',
        organization_id: 'org-1',
        statut: 'BLOQUE',
        statut_avant_blocage: 'EN_ATTENTE_QC',
        created_by: 'operateur-2',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      vi.mocked(prisma.qualityControl.findFirst).mockResolvedValue({
        id: 'qc-1',
        resultat: 'NON_CONFORME',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const action = batchService.liftQuarantine('batch-1', 'org-1', 'user-1', 'Frigo réparé');
      await expect(action).rejects.toMatchObject({ status: 409 });
      expect(prisma.batch.update).not.toHaveBeenCalled();
      expect(auditService.logAction).not.toHaveBeenCalled();
    });

    it('reste sur EN_STOCK par défaut pour un lot né bloqué (aucun statut d avant)', async () => {
      vi.mocked(prisma.batch.findFirst).mockResolvedValue({
        id: 'batch-1',
        organization_id: 'org-1',
        statut: 'BLOQUE',
        statut_avant_blocage: null,
        created_by: 'operateur-2',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(prisma.batch.update).mockResolvedValue({ id: 'batch-1', statut: 'EN_STOCK' } as any);

      const result = await batchService.liftQuarantine('batch-1', 'org-1', 'user-1', 'Réception revue');

      expect(prisma.batch.update).toHaveBeenCalledWith({
        where: { id: 'batch-1' },
        data: expect.objectContaining({ statut: 'EN_STOCK', statut_avant_blocage: null }),
      });
      expect(result.statut).toBe('EN_STOCK');
    });
  });

  describe('resolveBatchByLotNumber — le lot qu’on vient de scanner', () => {
    it('résout le lot par le numéro lu sur son étiquette', async () => {
      vi.mocked(prisma.batch.findFirst).mockResolvedValue({
        id: 'bat-1',
        lot_number: 'FRN-ABC123',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      const batch = await batchService.resolveBatchByLotNumber('FRN-ABC123', 'org-1');

      expect(batch.id).toBe('bat-1');
    });

    // Le cloisonnement se vérifie sur CHAQUE objet : sans le filtre d'organisation, scanner
    // l'étiquette d'un concurrent ouvrirait la fiche de SON lot — quantités, DLC, fournisseur.
    it('ne résout JAMAIS un lot d’une autre organisation', async () => {
      vi.mocked(prisma.batch.findFirst).mockResolvedValue(null);

      const action = batchService.resolveBatchByLotNumber('FRN-ABC123', 'org-1');

      await expect(action).rejects.toThrow(APIError);
      await expect(action).rejects.toMatchObject({ status: 404 });
      expect(prisma.batch.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organization_id: 'org-1' }),
        })
      );
    });

    // Un code saisi à la main arrive comme il vient. On le met en majuscules — comme il est ÉCRIT —
    // au lieu d'une recherche insensible à la casse : celle-ci écarterait l'index unique (balayage
    // à chaque scan) et, l'unicité étant sensible à la casse, `abc123` et `ABC123` pourraient
    // coexister — un `findFirst` sans tri en aurait renvoyé un AU HASARD.
    it('retrouve le lot quelle que soit la casse du code saisi', async () => {
      vi.mocked(prisma.batch.findFirst).mockResolvedValue({
        id: 'bat-1',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      await batchService.resolveBatchByLotNumber('frn-abc123', 'org-1');

      expect(prisma.batch.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ lot_number: 'FRN-ABC123' }),
        })
      );
    });

    // Le nom et l'e-mail d'un salarié sont une donnée personnelle. La liste des lots et le journal
    // d'audit les réservent déjà à l'administration ; la fiche du lot, elle, les servait à TOUS —
    // y compris au `viewer`. Scanner un lot ne doit pas rendre l'annuaire du personnel.
    it("ne révèle l'auteur du lot qu'à l'administration", async () => {
      vi.mocked(prisma.batch.findFirst).mockResolvedValue({
        id: 'bat-1',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      await batchService.resolveBatchByLotNumber('FRN-ABC123', 'org-1');

      const [args] = vi.mocked(prisma.batch.findFirst).mock.calls[0];
      expect(args?.include).not.toHaveProperty('user');
      expect(args?.include?.mouvements).not.toHaveProperty('include');
    });

    it("sert l'auteur du lot quand l'appelant y a droit", async () => {
      vi.mocked(prisma.batch.findFirst).mockResolvedValue({
        id: 'bat-1',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      await batchService.resolveBatchByLotNumber('FRN-ABC123', 'org-1', true);

      const [args] = vi.mocked(prisma.batch.findFirst).mock.calls[0];
      expect(args?.include).toHaveProperty('user');
    });
  });
});
