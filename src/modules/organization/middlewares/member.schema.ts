import vine from '@vinejs/vine';
import { makeBodyValidator } from './referenceData.schema';
import { INVITABLE_ROLES } from '../../identity/constants/roles.constants';

// `owner` est volontairement absent : cette route ne crée pas de propriétaire (escalade).
// Les rôles assignables sont ceux qu'on peut aussi inviter.
const changeRoleSchema = vine.object({
  role: vine.enum(INVITABLE_ROLES),
});

export const validateChangeMemberRole = makeBodyValidator(changeRoleSchema);
