import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Response } from 'express';
import {
  listLocationsController,
  createEquipmentController,
  getEquipmentLabelController,
} from './equipment.controller';
import { equipmentService } from '../services/equipment.service';
import { labelService } from '../../logistics/shared/services/label.service';
import { sendSuccess } from '../../../shared/utils/returnSuccess/returnSuccess';
import { AuthenticatedRequest } from '../../identity/types/auth.types';

vi.mock('../services/equipment.service', () => ({
  equipmentService: {
    listLocations: vi.fn(),
    createEquipment: vi.fn(),
    getScannableLabel: vi.fn(),
  },
}));

vi.mock('../../logistics/shared/services/label.service', () => ({
  labelService: {
    generateQRCode: vi.fn(),
  },
}));

vi.mock('../../../shared/utils/returnSuccess/returnSuccess', () => ({
  sendSuccess: vi.fn(),
}));

/**
 * Les services sont mockés : ces tests prouvent les ARGUMENTS que le contrôleur leur transmet et
 * les DÉCISIONS qu'il prend lui-même (dérivation du droit « voir les archives » depuis le rôle,
 * tenant et auteur pris dans la session). Ils ne prouvent PAS le cloisonnement effectif — le
 * `findFirst`/`findMany` filtré par organisation vit dans le service, ici mocké. D'où « transmet »
 * et « ignore », jamais « cloisonne ».
 */
describe('EquipmentController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listLocationsController — dérivation de includeArchived depuis le rôle', () => {
    const buildReq = (role: string | undefined, includeArchived?: string): AuthenticatedRequest =>
      ({
        activeOrgId: 'org-1',
        auth: role ? { role, user: { id: 'u-1' } } : undefined,
        query: includeArchived === undefined ? {} : { includeArchived },
      }) as unknown as AuthenticatedRequest;

    it('transmet includeArchived=true au service pour un admin qui le demande', async () => {
      vi.mocked(equipmentService.listLocations).mockResolvedValue([] as never);

      await listLocationsController(buildReq('admin', 'true'), {} as Response);

      expect(equipmentService.listLocations).toHaveBeenCalledWith('org-1', true);
    });

    it('autorise les archives pour un owner qui le demande', async () => {
      vi.mocked(equipmentService.listLocations).mockResolvedValue([] as never);

      await listLocationsController(buildReq('owner', 'true'), {} as Response);

      expect(equipmentService.listLocations).toHaveBeenCalledWith('org-1', true);
    });

    it("ignore includeArchived pour un viewer (la lecture seule n'énumère pas les archives)", async () => {
      vi.mocked(equipmentService.listLocations).mockResolvedValue([] as never);

      await listLocationsController(buildReq('viewer', 'true'), {} as Response);

      expect(equipmentService.listLocations).toHaveBeenCalledWith('org-1', false);
    });

    it('ignore includeArchived pour un operator', async () => {
      vi.mocked(equipmentService.listLocations).mockResolvedValue([] as never);

      await listLocationsController(buildReq('operator', 'true'), {} as Response);

      expect(equipmentService.listLocations).toHaveBeenCalledWith('org-1', false);
    });

    it('ignore includeArchived pour un rôle quality', async () => {
      vi.mocked(equipmentService.listLocations).mockResolvedValue([] as never);

      await listLocationsController(buildReq('quality', 'true'), {} as Response);

      expect(equipmentService.listLocations).toHaveBeenCalledWith('org-1', false);
    });

    it("n'active pas les archives pour un admin qui ne passe pas le paramètre", async () => {
      vi.mocked(equipmentService.listLocations).mockResolvedValue([] as never);

      await listLocationsController(buildReq('admin', undefined), {} as Response);

      expect(equipmentService.listLocations).toHaveBeenCalledWith('org-1', false);
    });

    it("traite une valeur autre que la chaîne 'true' comme un refus, même pour un admin", async () => {
      vi.mocked(equipmentService.listLocations).mockResolvedValue([] as never);

      // Le contrôleur compare en `=== 'true'` : un `?includeArchived=1` ne doit pas ouvrir les
      // archives. Verrouille la comparaison stricte contre un assouplissement en truthy.
      await listLocationsController(buildReq('admin', '1'), {} as Response);

      expect(equipmentService.listLocations).toHaveBeenCalledWith('org-1', false);
    });

    it('délègue à sendSuccess le code 200 et les lieux renvoyés par le service', async () => {
      const lieux = [{ id: 'loc-1' }];
      vi.mocked(equipmentService.listLocations).mockResolvedValue(lieux as never);
      const res = {} as Response;

      await listLocationsController(buildReq('admin', 'true'), res);

      expect(sendSuccess).toHaveBeenCalledWith(res, 200, 'Lieux récupérés', lieux);
    });
  });

  describe('createEquipmentController — tenant et auteur pris dans la session', () => {
    const payload = {
      nom: 'Frigo A',
      type: 'FRIGO' as const,
      id_lieu: '11111111-1111-1111-1111-111111111111',
      temp_seuil_max: 4,
      sensor_id: 'SENSOR-1',
    };

    it("transmet organization_id=activeOrgId et created_by=auth.user.id avec le payload validé", async () => {
      // Preuve des règles dures : le tenant vient de `activeOrgId`, l'auteur de `auth.user.id` —
      // jamais du corps. Le payload validé n'expose d'ailleurs ni l'un ni l'autre (schéma VineJS).
      vi.mocked(equipmentService.createEquipment).mockResolvedValue({ id: 'eq-1' } as never);
      const req = {
        validatedEquipment: payload,
        activeOrgId: 'org-1',
        auth: { user: { id: 'user-session-1' } },
      } as unknown as AuthenticatedRequest;

      await createEquipmentController(req, {} as Response);

      expect(equipmentService.createEquipment).toHaveBeenCalledWith({
        ...payload,
        organization_id: 'org-1',
        created_by: 'user-session-1',
      });
    });

    it('délègue à sendSuccess le code 201 et le matériel créé', async () => {
      const equipment = { id: 'eq-1', nom: 'Frigo A' };
      vi.mocked(equipmentService.createEquipment).mockResolvedValue(equipment as never);
      const res = {} as Response;
      const req = {
        validatedEquipment: payload,
        activeOrgId: 'org-1',
        auth: { user: { id: 'user-session-1' } },
      } as unknown as AuthenticatedRequest;

      await createEquipmentController(req, res);

      expect(sendSuccess).toHaveBeenCalledWith(res, 201, 'Matériel créé', equipment);
    });
  });

  describe('getEquipmentLabelController — QR du code renvoyé, réponse binaire', () => {
    const buildReq = (): AuthenticatedRequest =>
      ({
        activeOrgId: 'org-1',
        params: { id: 'eq-1' },
      }) as unknown as AuthenticatedRequest;

    const buildRes = () =>
      ({
        setHeader: vi.fn(),
        send: vi.fn(),
      }) as unknown as Response;

    it("transmet le tenant de session et l'id d'URL au service, puis génère le QR du code retourné", async () => {
      vi.mocked(equipmentService.getScannableLabel).mockResolvedValue({
        code: 'EQP-ABCDE',
        nom: 'Frigo A',
      } as never);
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      vi.mocked(labelService.generateQRCode).mockResolvedValue(png as never);
      const res = buildRes();

      await getEquipmentLabelController(buildReq(), res);

      expect(equipmentService.getScannableLabel).toHaveBeenCalledWith('org-1', 'eq-1');
      expect(labelService.generateQRCode).toHaveBeenCalledWith('EQP-ABCDE');
      expect(res.send).toHaveBeenCalledWith(png);
    });

    it("pose les en-têtes PNG et le nom du matériel encodé dans Content-Disposition", async () => {
      vi.mocked(equipmentService.getScannableLabel).mockResolvedValue({
        code: 'EQP-ABCDE',
        // Nom avec espace et accent : doit être percent-encodé dans l'en-tête.
        nom: 'Frigo Été',
      } as never);
      vi.mocked(labelService.generateQRCode).mockResolvedValue(Buffer.from([0x89]) as never);
      const res = buildRes();

      await getEquipmentLabelController(buildReq(), res);

      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/png');
      expect(res.setHeader).toHaveBeenCalledWith('X-Equipment-Code', 'EQP-ABCDE');
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        `inline; filename="${encodeURIComponent('Frigo Été')}.png"`
      );
    });
  });
});
