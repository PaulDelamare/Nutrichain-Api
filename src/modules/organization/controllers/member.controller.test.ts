import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Response } from 'express';
import { changeMemberRoleController, revokeMemberController } from './member.controller';
import { memberService } from '../services/member.service';
import { AuthenticatedRequest } from '../../identity/types/auth.types';
import { sendSuccess } from '../../../shared/utils/returnSuccess/returnSuccess';

vi.mock('../services/member.service', () => ({
  memberService: {
    changeRole: vi.fn(),
    revoke: vi.fn(),
  },
}));

vi.mock('../../../shared/utils/returnSuccess/returnSuccess', () => ({
  sendSuccess: vi.fn(),
}));

describe('MemberController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('changeMemberRoleController', () => {
    it("transmet au service le tenant et l'auteur de la SESSION, la cible venant de l'URL", async () => {
      // Ce contrôleur est un pur câblage : il ne fait que TRANSMETTRE au service le tenant
      // (`activeOrgId`) et l'auteur (`auth.user.id`) issus de la session. Le cloisonnement réel
      // (findFirst filtré par l'organisation) et les gardes owner/soi-même vivent dans
      // `memberService.chargerCible`, ici mocké : ce test prouve la source des valeurs, pas ces
      // protections.
      vi.mocked(memberService.changeRole).mockResolvedValue({ id: 'member-1' } as never);
      const req = {
        params: { id: 'member-1' },
        body: { role: 'operator' },
        activeOrgId: 'org-1',
        auth: { user: { id: 'admin-session' } },
      } as unknown as AuthenticatedRequest;

      await changeMemberRoleController(req, {} as Response);

      expect(memberService.changeRole).toHaveBeenCalledWith(
        'member-1',
        'operator',
        'org-1',
        'admin-session'
      );
    });

    it('ne lit ni le tenant, ni l’auteur, ni la cible depuis le corps de la requête', async () => {
      // Le contrôleur source la cible dans l'URL et le tenant/l'auteur dans la session : des
      // champs homonymes glissés dans le corps ne changent rien. (Sur cette route, VineJS retire
      // aussi ces champs en amont ; le test verrouille néanmoins que le contrôleur, lui, ne les
      // lit pas — ce qui reste vrai sur `revoke`, dépourvu de validateur.)
      vi.mocked(memberService.changeRole).mockResolvedValue({ id: 'member-1' } as never);
      const req = {
        params: { id: 'member-1' },
        body: {
          role: 'operator',
          id: 'member-usurpe',
          organization_id: 'org-etrangere',
          actorUserId: 'le-patron',
        },
        activeOrgId: 'org-1',
        auth: { user: { id: 'admin-session' } },
      } as unknown as AuthenticatedRequest;

      await changeMemberRoleController(req, {} as Response);

      expect(memberService.changeRole).toHaveBeenCalledWith(
        'member-1',
        'operator',
        'org-1',
        'admin-session'
      );
    });

    it('délègue à sendSuccess le code 200 et le membre renvoyé par le service', async () => {
      // sendSuccess est mocké : on vérifie le contrat passé (code, message, données), pas
      // l'écriture HTTP réelle, portée par ce util partagé et testée ailleurs.
      const membre = { id: 'member-1', role: 'operator' };
      vi.mocked(memberService.changeRole).mockResolvedValue(membre as never);
      const res = {} as Response;
      const req = {
        params: { id: 'member-1' },
        body: { role: 'operator' },
        activeOrgId: 'org-1',
        auth: { user: { id: 'admin-session' } },
      } as unknown as AuthenticatedRequest;

      await changeMemberRoleController(req, res);

      expect(sendSuccess).toHaveBeenCalledWith(res, 200, 'Rôle du membre mis à jour', membre);
    });
  });

  describe('revokeMemberController', () => {
    it("transmet au service le tenant et l'auteur de la SESSION, la cible venant de l'URL", async () => {
      vi.mocked(memberService.revoke).mockResolvedValue(undefined as never);
      const req = {
        params: { id: 'member-1' },
        body: {},
        activeOrgId: 'org-1',
        auth: { user: { id: 'admin-session' } },
      } as unknown as AuthenticatedRequest;

      await revokeMemberController(req, {} as Response);

      expect(memberService.revoke).toHaveBeenCalledWith('member-1', 'org-1', 'admin-session');
    });

    it('ne lit ni le tenant, ni l’auteur, ni la cible depuis le corps de la requête', async () => {
      // La révocation n'a aucun validateur en amont : le corps atteint le contrôleur tel quel.
      // Ce test verrouille que le contrôleur l'ignore et source tout de l'URL et de la session.
      vi.mocked(memberService.revoke).mockResolvedValue(undefined as never);
      const req = {
        params: { id: 'member-1' },
        body: { id: 'member-usurpe', organization_id: 'org-etrangere', actorUserId: 'le-patron' },
        activeOrgId: 'org-1',
        auth: { user: { id: 'admin-session' } },
      } as unknown as AuthenticatedRequest;

      await revokeMemberController(req, {} as Response);

      expect(memberService.revoke).toHaveBeenCalledWith('member-1', 'org-1', 'admin-session');
    });

    it("délègue à sendSuccess le code 200 en confirmant l'identifiant révoqué", async () => {
      vi.mocked(memberService.revoke).mockResolvedValue(undefined as never);
      const res = {} as Response;
      const req = {
        params: { id: 'member-1' },
        body: {},
        activeOrgId: 'org-1',
        auth: { user: { id: 'admin-session' } },
      } as unknown as AuthenticatedRequest;

      await revokeMemberController(req, res);

      expect(sendSuccess).toHaveBeenCalledWith(res, 200, 'Accès du membre révoqué', {
        id: 'member-1',
      });
    });
  });
});
