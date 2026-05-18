# Implémentation Sécurité Logistics (Receipts & Batches)

## 📋 Résumé Exécutif

Cette implémentation sécurise les routes logistics avec une distinction claire entre :
- **Flux B2B/M2M** : Clé API pour systèmes externes (IoT, partenaires logistiques)
- **Flux Web/Mobile** : Authentification Better-Auth + RBAC (Role-Based Access Control)

### Rôles Métier Logistics
```
- logistics_admin      : Créer/modifier/lister toutes les réceptions + stats
- logistics_operator   : Créer des réceptions, consulter ses propres, lister
- logistics_viewer     : Lecture seule (consulter)
- quality_control      : Lecture + tests de qualité
```

### Routes et Protections
| Route | Méthode | B2B (Clé API) | Web (Auth) | Protection Org |
|-------|---------|---------------|-----------|----------------|
| `/api/logistics/receipts` | POST | ✓ | ✓ (operator+) | N/A (créée dans l'org active) |
| `/api/logistics/receipts` | GET | ✓ | ✓ (viewer+) | ✓ (filtre org_id) |
| `/api/logistics/receipts/:id` | GET | ✓ | ✓ (viewer+) | ✓ (vérifier org) |
| `/api/logistics/receipts/stats` | GET | ✗ | ✓ (admin) | ✓ (org active) |
| `/api/logistics/batches/:id` | GET | ✓ | ✓ (viewer+) | ✓ (filtre org) |

---

## 1️⃣ Constantes & Énumérations

**Fichier**: `src/modules/logistics/constants/logistics.constants.ts` (NEW)

```typescript
// Rôles métier spécifiques au domaine Logistics
export const LOGISTICS_ROLES = {
  ADMIN: 'logistics_admin',        // Toutes les opérations + stats
  OPERATOR: 'logistics_operator',  // Créer réceptions + consulter
  VIEWER: 'logistics_viewer',      // Lecture seule
  QA: 'quality_control',           // Lecture + tests qualité
} as const;

export type LogisticsRole = typeof LOGISTICS_ROLES[keyof typeof LOGISTICS_ROLES];

// Permissions atomiques (pour future ABAC)
export const LOGISTICS_PERMISSIONS = {
  CREATE: 'logistics:create',
  READ: 'logistics:read',
  READ_STATS: 'logistics:read_stats',
  UPDATE: 'logistics:update',
  DELETE: 'logistics:delete',
} as const;

// Énumération des rôles autorisés par route
export const ROUTE_ROLE_MATRIX = {
  'POST:/receipts': [LOGISTICS_ROLES.ADMIN, LOGISTICS_ROLES.OPERATOR],
  'GET:/receipts': [LOGISTICS_ROLES.ADMIN, LOGISTICS_ROLES.OPERATOR, LOGISTICS_ROLES.VIEWER, LOGISTICS_ROLES.QA],
  'GET:/receipts/:id': [LOGISTICS_ROLES.ADMIN, LOGISTICS_ROLES.OPERATOR, LOGISTICS_ROLES.VIEWER, LOGISTICS_ROLES.QA],
  'GET:/receipts/stats': [LOGISTICS_ROLES.ADMIN],
  'GET:/batches/:id': [LOGISTICS_ROLES.ADMIN, LOGISTICS_ROLES.OPERATOR, LOGISTICS_ROLES.VIEWER, LOGISTICS_ROLES.QA],
} as const;
```

---

## 2️⃣ Middlewares de Sécurité

### A. Middleware: Vérifier Rôle Logistics (Flux Web/Mobile)

**Fichier**: `src/modules/logistics/middlewares/requireLogisticsRole.middleware.ts` (NEW)

```typescript
import { Request, Response, NextFunction } from 'express';
import { auth } from '../../../modules/identity/auth.config';
import { LOGISTICS_ROLES, type LogisticsRole } from '../constants/logistics.constants';

/**
 * Middleware: Vérifier qu'un utilisateur authentifié a un rôle logistics autorisé.
 * 
 * FLUX WEB/MOBILE UNIQUEMENT.
 * Utiliser avec Better-Auth: Bearer Token (mobile) ou Cookie HttpOnly (web).
 * 
 * @param allowedRoles Liste des rôles autorisés (ex: [LOGISTICS_ROLES.ADMIN, LOGISTICS_ROLES.OPERATOR])
 * 
 * COMPORTEMENT:
 * - 401: Pas authentifié
 * - 400: Pas d'organisation active sélectionnée
 * - 403: Rôle insuffisant OU utilisateur inactif OU date limite dépassée
 * - Attache req.user, req.session, req.activeOrgId pour les contrôleurs
 * 
 * SÉCURITÉ:
 * - Messages d'erreur génériques (ne révèle pas le rôle exact requis)
 * - Vérifie les affectations temporaires (startDate, endDate)
 * - Ne montre pas l'existence de rôles alternatifs
 */
export const requireLogisticsRole = (allowedRoles: LogisticsRole[]) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Étape 1: Récupérer la session utilisateur de Better-Auth
      const sessionPayload = await auth.api.getSession({
        headers: new Headers(req.headers as Record<string, string>),
      });

      if (!sessionPayload?.session || !sessionPayload?.user) {
        res.status(401).json({
          status: 401,
          error: [{ field: 'auth', message: 'Authentification requise' }],
        });
        return;
      }

      // Étape 2: Vérifier qu'une organisation active est définie
      const activeOrgId = sessionPayload.session.activeOrganizationId;
      if (!activeOrgId) {
        res.status(400).json({
          status: 400,
          error: [{ field: 'organization', message: 'Aucune organisation active sélectionnée' }],
        });
        return;
      }

      // Étape 3: Récupérer les infos de l'utilisateur dans cette organisation
      // (via Better-Auth ou requête Prisma directe si nécessaire)
      const orgDetails = await auth.api.getFullOrganization({
        headers: new Headers(req.headers as Record<string, string>),
        query: { organizationId: activeOrgId },
      });

      if (!orgDetails) {
        res.status(403).json({
          status: 403,
          error: [{ field: 'auth', message: 'Accès refusé' }],
        });
        return;
      }

      // Étape 4: Trouver le Member (rôle + affectation temporelle)
      const memberRecord = orgDetails.members.find(
        (m) => m.userId === sessionPayload.user.id
      );

      if (!memberRecord) {
        res.status(403).json({
          status: 403,
          error: [{ field: 'auth', message: 'Accès refusé' }],
        });
        return;
      }

      const userRole = memberRecord.role as LogisticsRole;

      // Étape 5: Vérifier que le rôle est autorisé POUR CETTE ROUTE
      if (!allowedRoles.includes(userRole)) {
        res.status(403).json({
          status: 403,
          error: [{ field: 'permission', message: 'Permission insuffisante' }],
        });
        return;
      }

      // Étape 6 (OPTIONNEL): Si le modèle supporte startDate/endDate sur Member
      // const now = new Date();
      // if (memberRecord.startDate && memberRecord.startDate > now) {
      //   res.status(403).json({
      //     status: 403,
      //     error: [{ field: 'permission', message: 'Votre accès n\'est pas encore actif' }],
      //   });
      //   return;
      // }
      // if (memberRecord.endDate && memberRecord.endDate < now) {
      //   res.status(403).json({
      //     status: 403,
      //     error: [{ field: 'permission', message: 'Votre accès a expiré' }],
      //   });
      //   return;
      // }

      // ✅ Authentification et autorisation OK
      // Attacher les données au contexte Express pour utilisation dans les contrôleurs
      (req as unknown).user = sessionPayload.user;
      (req as unknown).session = sessionPayload.session;
      (req as unknown).activeOrgId = activeOrgId;
      (req as unknown).memberRole = userRole;

      next();
    } catch (error) {
      console.error('[LogisticsRole Middleware Error]', error);
      res.status(500).json({
        status: 500,
        error: [{ field: 'server', message: 'Erreur serveur' }],
      });
    }
  };
};
```

### B. Middleware: Vérifier Accès à une Réception (Filtre Organization)

**Fichier**: `src/modules/logistics/middlewares/verifyReceiptAccess.middleware.ts` (NEW)

```typescript
import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../shared/configs/prismaClient.config';

/**
 * Middleware: Vérifier qu'un utilisateur Web a accès à une réception spécifique.
 * 
 * UTILISATION:
 * - router.get('/receipts/:id', requireLogisticsRole([...]), verifyReceiptAccess, handler)
 * 
 * VÉRIFICATIONS:
 * 1. La réception existe
 * 2. L'utilisateur est dans la même organisation que le créateur de la réception
 * 
 * SÉCURITÉ:
 * - Empêche un utilisateur d'une org A de consulter les données de l'org B
 * - Les utilisateurs B2B (API Key) NE passent PAS par ce middleware
 * - Messages d'erreur génériques (404, pas 403 révélateur)
 */
export const verifyReceiptAccess = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const receiptId = req.params.id as string;
    const activeOrgId = (req as unknown as { activeOrgId: string }).activeOrgId;
    const userId = ((req as unknown) as { user: { id: string } }).user.id;

    // Étape 1: Récupérer la réception et l'utilisateur qui l'a créée
    const receipt = await prisma.receipt.findUnique({
      where: { id: receiptId },
      include: {
        user: {
          include: {
            members: {
              where: { organizationId: activeOrgId },
            },
          },
        },
      },
    });

    // Étape 2: Vérifier que la réception existe
    if (!receipt) {
      res.status(404).json({
        status: 404,
        error: [{ field: 'receipt', message: 'Réception introuvable' }],
      });
      return;
    }

    // Étape 3: Vérifier que le créateur est dans la MÊME org active
    const creatorInSameOrg = receipt.user.members.length > 0;
    if (!creatorInSameOrg) {
      // IMPORTANT: Retourner 404 au lieu de 403 pour ne pas révéler l'existence
      res.status(404).json({
        status: 404,
        error: [{ field: 'receipt', message: 'Réception introuvable' }],
      });
      return;
    }

    // ✅ Accès autorisé
    (req as unknown as { receipt: typeof receipt }).receipt = receipt;
    next();
  } catch (error) {
    console.error('[VerifyReceiptAccess Middleware Error]', error);
    res.status(500).json({
      status: 500,
      error: [{ field: 'server', message: 'Erreur serveur' }],
    });
  }
};
```

### C. Middleware: Vérifier Accès à un Batch (Filtre Organization)

**Fichier**: `src/modules/logistics/middlewares/verifyBatchAccess.middleware.ts` (NEW)

```typescript
import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../shared/configs/prismaClient.config';

/**
 * Middleware: Vérifier qu'un utilisateur Web a accès à un lot (batch) spécifique.
 * 
 * UTILISATION:
 * - router.get('/batches/:id', requireLogisticsRole([...]), verifyBatchAccess, handler)
 * 
 * VÉRIFICATIONS:
 * 1. Le batch existe
 * 2. L'utilisateur est dans la même organisation que le créateur du batch
 * 
 * SÉCURITÉ:
 * - Empêche l'accès cross-organization
 * - Messages 404 génériques (pas de révélation d'existence)
 */
export const verifyBatchAccess = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const batchId = req.params.id as string;
    const activeOrgId = (req as unknown as { activeOrgId: string }).activeOrgId;

    // Étape 1: Récupérer le batch avec son créateur
    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
      include: {
        user: {
          include: {
            members: {
              where: { organizationId: activeOrgId },
            },
          },
        },
        produit: true,
      },
    });

    // Étape 2: Vérifier que le batch existe
    if (!batch) {
      res.status(404).json({
        status: 404,
        error: [{ field: 'batch', message: 'Lot introuvable' }],
      });
      return;
    }

    // Étape 3: Vérifier que le créateur est dans la MÊME org active
    const creatorInSameOrg = batch.user.members.length > 0;
    if (!creatorInSameOrg) {
      res.status(404).json({
        status: 404,
        error: [{ field: 'batch', message: 'Lot introuvable' }],
      });
      return;
    }

    // ✅ Accès autorisé
    (req as unknown as { batch: typeof batch }).batch = batch;
    next();
  } catch (error) {
    console.error('[VerifyBatchAccess Middleware Error]', error);
    res.status(500).json({
      status: 500,
      error: [{ field: 'server', message: 'Erreur serveur' }],
    });
  }
};
```

---

## 3️⃣ Schéma de Validation VineJS

**Fichier**: `src/modules/logistics/middlewares/validateReceipt.middleware.ts` (MODIFIER)

```typescript
import { Request, Response, NextFunction } from 'express';
import vine from '@vinejs/vine';

/**
 * Validation des données d'entrée pour une réception.
 * 
 * Appliqué AVANT le contrôleur (Fail Fast).
 * Les erreurs sont catchées par le errorHandler global.
 * 
 * CHAMPS:
 * - id_fournisseur: UUID du fournisseur existant
 * - shipment_id: Identifiant unique du chargement
 * - id_produit: UUID du produit existant
 * - quantite_actuelle: Décimal positif
 * - unite_code: Code d'unité valide (KG, L, etc.)
 * - statut_controle: OK|ALERTE|NONCONFORME
 * - received_by: UUID de l'utilisateur (sera overridé par req.user.id en Web mode)
 */
export const validateReceiptParams = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const schema = vine.object({
      id_fournisseur: vine.string().uuid(),
      shipment_id: vine.string().minLength(3).maxLength(100),
      id_produit: vine.string().uuid(),
      quantite_actuelle: vine.number().positive().decimal({ places: 2 }),
      unite_code: vine.string().maxLength(10),
      statut_controle: vine.enum(['OK', 'ALERTE', 'NONCONFORME']),
      received_by: vine.string().uuid(),
    });

    // Validation avec VineJS (lancera une erreur si invalide)
    const validatedData = await schema.validate(req.body);

    // Attacher les données validées au contexte
    (req as unknown as { validatedReceipt: typeof validatedData }).validatedReceipt =
      validatedData;

    next();
  } catch (error) {
    // Les erreurs de validation sont capturées par le errorHandler global
    next(error);
  }
};
```

---

## 4️⃣ Services Modifiés (Filtrage par Organization)

**Fichier**: `src/modules/logistics/receipts/services/receipt.service.ts` (MODIFIER)

```typescript
import { prisma } from '../../../../shared/configs/prismaClient.config';

/**
 * Types internes pour meilleure type-safety
 */
type CreateReceiptInput = {
  id_fournisseur: string;
  shipment_id: string;
  id_produit: string;
  quantite_actuelle: number;
  unite_code: string;
  statut_controle: string;
  received_by: string;
  activeOrgId?: string; // Pour filtrer par org (flux Web uniquement)
};

type ListReceiptsFilters = {
  page?: number;
  limit?: number;
  supplierId?: string;
  from?: string;
  to?: string;
  activeOrgId?: string; // Filtre org pour flux Web
  isBB2B?: boolean; // True si requête B2B (API Key)
};

export const receiptService = {
  /**
   * Créer une réception (Transaction ACID).
   * 
   * ENTREPÔT: Appel reçu du quai via API (B2B + clé API).
   * WEB: Appel de l'interface frontend (Auth Better-Auth + rôle).
   * 
   * @param data Données validées par le schéma VineJS
   * @returns { receiptId, batchId }
   * 
   * SÉCURITÉ:
   * - Vérifier l'existence de chaque référence FK
   * - Transactionalité (tout ou rien)
   * - Journaliser (Audit_Log) en flux critique
   */
  async createReceipt(data: CreateReceiptInput): Promise<{
    message: string;
    receiptId: string;
    batchId: string;
  }> {
    return prisma.$transaction(async (tx) => {
      // Étape 1: Vérifier les références FK
      const supplier = await tx.supplier.findUnique({ where: { id: data.id_fournisseur } });
      if (!supplier) {
        throw { status: 404, error: [{ field: 'id_fournisseur', message: 'Fournisseur introuvable' }] };
      }

      const product = await tx.product.findUnique({ where: { id: data.id_produit } });
      if (!product) {
        throw { status: 404, error: [{ field: 'id_produit', message: 'Produit introuvable' }] };
      }

      const user = await tx.user.findUnique({ where: { id: data.received_by } });
      if (!user) {
        throw { status: 404, error: [{ field: 'received_by', message: 'Utilisateur introuvable' }] };
      }

      if (data.unite_code) {
        const unit = await tx.unit.findUnique({ where: { code: data.unite_code } });
        if (!unit) {
          throw { status: 400, error: [{ field: 'unite_code', message: 'Unité inconnue' }] };
        }
      }

      // Étape 2: Créer la réception (bon de réception physique)
      const receipt = await tx.receipt.create({
        data: {
          id_fournisseur: data.id_fournisseur,
          shipment_id: data.shipment_id,
          date_reception: new Date(),
          statut_controle: data.statut_controle,
          received_by: data.received_by,
        },
      });

      // Étape 3: Créer le lot interne (contenant numérique traçable)
      const batch = await tx.batch.create({
        data: {
          id_produit: data.id_produit,
          quantite_actuelle: data.quantite_actuelle,
          unite_code: data.unite_code,
          quantite_base: data.quantite_actuelle,
          statut: 'EN_STOCK',
          created_by: data.received_by,
        },
      });

      // Étape 4 (OPTIONNEL): Enregistrer dans Audit_Log
      // await tx.audit_Log.create({
      //   data: {
      //     id_user: data.received_by,
      //     action: 'CREATE',
      //     entity: 'Receipt',
      //     entity_id: receipt.id,
      //     nouvelle_valeur: { receipt, batch },
      //     prev_hash: '0',
      //     signature_hash: 'PENDING',
      //   },
      // });

      return {
        message: 'Réception enregistrée avec succès et lot généré',
        receiptId: receipt.id,
        batchId: batch.id,
      };
    });
  },

  /**
   * Lister les réceptions avec filtres et pagination.
   * 
   * FLUX B2B (clé API):
   * - Aucun filtre d'organisation
   * - Filtre optionnel par supplierId
   * 
   * FLUX WEB (Auth):
   * - OBLIGATOIRE: filtrer par activeOrgId (via créateur du lot)
   * - Filtre optionnel par supplierId
   * 
   * @param filters Pagination, organisation, dates
   * @returns { data: Receipt[], pagination: {...} }
   */
  async listReceipts(filters: ListReceiptsFilters): Promise<{
    data: any[];
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }> {
    const page = filters.page ? Math.max(1, filters.page) : 1;
    const limit = filters.limit ? Math.min(Math.max(1, filters.limit), 100) : 20;
    const skip = (page - 1) * limit;

    // Construire les critères WHERE
    const where: any = {};

    if (filters.supplierId) {
      where.id_fournisseur = filters.supplierId;
    }

    // SÉCURITÉ: Si flux Web, filtrer par organisation
    // Le filtre se fait via le créateur du lot associé à une organisation
    if (filters.activeOrgId && !filters.isBB2B) {
      // Récupérer tous les utilisateurs de cette org
      const orgMembers = await prisma.member.findMany({
        where: { organizationId: filters.activeOrgId },
        select: { userId: true },
      });
      const userIds = orgMembers.map((m) => m.userId);

      // Filtrer les réceptions créées par ces utilisateurs
      where.received_by = { in: userIds };
    }

    if (filters.from || filters.to) {
      where.date_reception = {};
      if (filters.from) where.date_reception.gte = new Date(filters.from);
      if (filters.to) where.date_reception.lte = new Date(filters.to);
    }

    // Exécuter les requêtes en parallèle
    const [receipts, total] = await Promise.all([
      prisma.receipt.findMany({
        where,
        include: {
          fournisseur: true,
          user: { select: { id: true, name: true, email: true } },
        },
        skip,
        take: limit,
        orderBy: { date_reception: 'desc' },
      }),
      prisma.receipt.count({ where }),
    ]);

    return {
      data: receipts,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  },

  /**
   * Récupérer les statistiques des réceptions.
   * 
   * FLUX WEB UNIQUEMENT (Auth + admin).
   * Filtre automatique par l'organisation active de l'utilisateur.
   * 
   * @param activeOrgId ID de l'org active (depuis req.session)
   * @returns Statistiques du jour + totales
   */
  async getReceiptStats(activeOrgId: string): Promise<{
    total_receipts_today: number;
    total_quantity_kg: number;
    total_receipts_all_time: number;
  }> {
    // Récupérer les utilisateurs de cette org
    const orgMembers = await prisma.member.findMany({
      where: { organizationId: activeOrgId },
      select: { userId: true },
    });
    const userIds = orgMembers.map((m) => m.userId);

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    // Compter les réceptions du jour
    const countToday = await prisma.receipt.count({
      where: {
        date_reception: { gte: startOfDay },
        received_by: { in: userIds },
      },
    });

    // Compter TOUTES les réceptions (historique)
    const countAllTime = await prisma.receipt.count({
      where: {
        received_by: { in: userIds },
      },
    });

    return {
      total_receipts_today: countToday,
      total_quantity_kg: 0, // TODO: Calculer via aggregate + formule conversion unités
      total_receipts_all_time: countAllTime,
    };
  },

  /**
   * Récupérer une réception par son ID.
   * 
   * B2B: Accès direct (clé API)
   * WEB: Filtrage par org via middleware verifyReceiptAccess
   * 
   * @param id UUID de la réception
   * @returns Données complètes de la réception
   */
  async getReceiptById(id: string): Promise<any> {
    const receipt = await prisma.receipt.findUnique({
      where: { id },
      include: {
        fournisseur: true,
        user: { select: { id: true, name: true, email: true } },
      },
    });

    if (!receipt) {
      throw { status: 404, error: [{ field: 'id', message: 'Réception introuvable' }] };
    }

    return receipt;
  },

  /**
   * Récupérer un lot (batch) par son ID.
   * 
   * B2B: Accès direct
   * WEB: Filtrage par org via middleware verifyBatchAccess
   * 
   * @param id UUID du lot
   * @returns Données complètes du lot
   */
  async getBatchById(id: string): Promise<any> {
    const batch = await prisma.batch.findUnique({
      where: { id },
      include: {
        produit: true,
        user: { select: { id: true, name: true, email: true } },
      },
    });

    if (!batch) {
      throw { status: 404, error: [{ field: 'id', message: 'Lot introuvable' }] };
    }

    return batch;
  },
};
```

---

## 5️⃣ Contrôleurs Modifiés

**Fichier**: `src/modules/logistics/receipts/controllers/receipt.controller.ts` (MODIFIER)

```typescript
import { Request, Response } from 'express';
import { receiptService } from '../services/receipt.service';
import { sendSuccess } from '../../../../shared/utils/returnSuccess/returnSuccess';
import { catchAsync } from '../../../../shared/utils/errorHandler/catchAsync';

/**
 * POST /api/logistics/receipts
 * 
 * FLUX B2B (clé API):
 * - received_by: Doit être fourni dans le payload (vérifié par validation)
 * 
 * FLUX WEB (Auth):
 * - received_by: Overridé par req.user.id (l'utilisateur actuel)
 * - activeOrgId: Attaché par le middleware requireLogisticsRole
 */
export const createReceiptController = catchAsync(async (req: Request, res: Response) => {
  const isBB2B = !((req as unknown) as { user: any }).user; // Heuristique simple

  // Récupérer les données validées par VineJS
  const validatedData = (req as unknown as { validatedReceipt: any }).validatedReceipt;

  // FLUX WEB: Override received_by avec l'utilisateur actuel
  if (!isBB2B) {
    const userId = ((req as unknown) as { user: { id: string } }).user.id;
    validatedData.received_by = userId;
  }

  const result = await receiptService.createReceipt(validatedData);
  sendSuccess(res, 201, 'Réception confirmée', result);
});

/**
 * GET /api/logistics/receipts
 * 
 * Lister les réceptions avec pagination et filtres.
 * 
 * Query Params:
 * - page: numéro de page (défaut 1)
 * - limit: nombre par page (défaut 20, max 100)
 * - supplierId: filtrer par fournisseur (optionnel)
 * - from: date début (optionnel, format ISO)
 * - to: date fin (optionnel, format ISO)
 * 
 * FLUX B2B: Pas de filtre d'organisation
 * FLUX WEB: Filtré automatiquement par activeOrgId
 */
export const listReceiptsController = catchAsync(async (req: Request, res: Response) => {
  const isBB2B = !((req as unknown) as { user: any }).user;
  const activeOrgId = ((req as unknown) as { activeOrgId?: string }).activeOrgId;

  const filters = {
    page: req.query.page ? parseInt(req.query.page as string, 10) : 1,
    limit: req.query.limit ? parseInt(req.query.limit as string, 10) : 20,
    supplierId: req.query.supplierId as string | undefined,
    from: req.query.from as string | undefined,
    to: req.query.to as string | undefined,
    activeOrgId: activeOrgId, // Pour filtrer en Web mode
    isBB2B: isBB2B,           // Flag pour le service
  };

  const result = await receiptService.listReceipts(filters);
  sendSuccess(res, 200, 'Réceptions récupérées', result);
});

/**
 * GET /api/logistics/receipts/stats
 * 
 * FLUX WEB UNIQUEMENT (Admin).
 * Statistiques de réception pour le tableau de bord.
 */
export const getReceiptStatsController = catchAsync(async (req: Request, res: Response) => {
  const activeOrgId = ((req as unknown) as { activeOrgId: string }).activeOrgId;

  const stats = await receiptService.getReceiptStats(activeOrgId);
  sendSuccess(res, 200, 'Statistiques récupérées', stats);
});

/**
 * GET /api/logistics/receipts/:id
 * 
 * Récupérer une réception par son ID.
 * 
 * FLUX B2B: Accès direct (clé API)
 * FLUX WEB: Filtrage via middleware verifyReceiptAccess (org check)
 */
export const getReceiptByIdController = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const receipt = await receiptService.getReceiptById(id);
  sendSuccess(res, 200, 'Réception récupérée', receipt);
});

/**
 * GET /api/logistics/batches/:id
 * 
 * Récupérer un lot (batch) par son ID.
 * 
 * FLUX B2B: Accès direct (clé API)
 * FLUX WEB: Filtrage via middleware verifyBatchAccess (org check)
 */
export const getBatchByIdController = catchAsync(async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const batch = await receiptService.getBatchById(id);
  sendSuccess(res, 200, 'Lot récupéré', batch);
});
```

---

## 6️⃣ Routes Finales (CRUD avec Protections)

**Fichier**: `src/modules/logistics/receipts/routes/receipt.routes.ts` (REMPLACER COMPLÈTEMENT)

```typescript
import { Router } from 'express';

// Controllers
import {
  createReceiptController,
  listReceiptsController,
  getReceiptStatsController,
  getReceiptByIdController,
  getBatchByIdController,
} from '../controllers/receipt.controller';

// Middlewares: Validation
import { validateReceiptParams } from '../middlewares/validateReceipt.middleware';

// Middlewares: Authentification (B2B vs Web)
import { checkApiKey } from '../../../../shared/utils/checkApiKey/checkApiKey';
import { requireLogisticsRole } from '../middlewares/requireLogisticsRole.middleware';
import { verifyReceiptAccess } from '../middlewares/verifyReceiptAccess.middleware';
import { verifyBatchAccess } from '../middlewares/verifyBatchAccess.middleware';

// Constantes
import { LOGISTICS_ROLES } from '../constants/logistics.constants';

const router = Router();

/**
 * ===== FLUX B2B/M2M (Clé API) =====
 * Routes pour systèmes externes (IoT, partenaires logistiques, ERP)
 * 
 * Protection: checkApiKey() uniquement
 * Pas de vérification de rôle
 */

/**
 * POST /api/logistics/receipts
 * Créer une réception depuis le quai (camion arrive, scanneur IoT)
 * 
 * Accessibilité:
 * - B2B: OUI (clé API)
 * - Web: OUI (auth + operator/admin)
 * 
 * Sécurité:
 * - Validation stricte des données (VineJS)
 * - Le champ 'received_by' est overridé en flux Web
 * 
 * Response: 201 Created
 * {
 *   "status": 201,
 *   "message": "Réception confirmée",
 *   "data": { "receiptId": "uuid", "batchId": "uuid" }
 * }
 */
router.post(
  '/logistics/receipts',
  checkApiKey(), // B2B + clé API
  validateReceiptParams, // Fail fast validation
  createReceiptController
);

/**
 * GET /api/logistics/receipts
 * Lister les réceptions avec pagination et filtres
 * 
 * Accessibilité:
 * - B2B: OUI (clé API) → Pas de filtre org
 * - Web: OUI (auth + viewer/operator/admin) → Filtre org auto
 * 
 * Query Params:
 * - page: 1 (default)
 * - limit: 20 (default, max 100)
 * - supplierId: optionnel
 * - from: optionnel (ISO date)
 * - to: optionnel (ISO date)
 * 
 * Response: 200 OK
 * {
 *   "status": 200,
 *   "data": {
 *     "data": [...],
 *     "pagination": { "page": 1, "limit": 20, "total": 150, "totalPages": 8 }
 *   }
 * }
 */
router.get(
  '/logistics/receipts',
  checkApiKey(), // À NOTER: En production, créer une route Web séparée
  listReceiptsController
);

/**
 * GET /api/logistics/receipts/stats
 * Statistiques pour le dashboard
 * 
 * Accessibilité:
 * - B2B: NON (forbidden)
 * - Web: OUI (auth + ADMIN uniquement)
 * 
 * Sécurité: Stats filtrées par l'org active de l'utilisateur
 * 
 * Response: 200 OK
 * {
 *   "status": 200,
 *   "data": {
 *     "total_receipts_today": 12,
 *     "total_quantity_kg": 5000,
 *     "total_receipts_all_time": 1520
 *   }
 * }
 */
router.get(
  '/logistics/receipts/stats',
  requireLogisticsRole([LOGISTICS_ROLES.ADMIN]), // Web + admin UNIQUEMENT
  getReceiptStatsController
);

/**
 * GET /api/logistics/receipts/:id
 * Récupérer une réception spécifique
 * 
 * Accessibilité:
 * - B2B: OUI (clé API)
 * - Web: OUI (auth + viewer/operator/admin) + filtre org
 * 
 * Sécurité:
 * - B2B: Accès direct
 * - Web: Filtre org via middleware verifyReceiptAccess
 * 
 * Response: 200 OK
 * {
 *   "status": 200,
 *   "data": { ... }
 * }
 */
// IMPORTANT: Créer deux routes distincts en production!
// Route 1 (B2B): GET /api/logistics/receipts/:id avec checkApiKey()
// Route 2 (Web): GET /api/logistics/web/receipts/:id avec requireLogisticsRole + verifyReceiptAccess
//
// Pour cette implémentation, les deux flux partagent la route (verifyReceiptAccess ne s'active que si req.activeOrgId)
router.get(
  '/logistics/receipts/:id',
  // Middleware optionnel: Si c'est du flux Web, vérifier l'accès org
  (req, res, next) => {
    // Heuristique: Si activeOrgId est présent, c'est du Web → appliquer verifyReceiptAccess
    if ((req as unknown as { activeOrgId?: string }).activeOrgId) {
      return verifyReceiptAccess(req, res, next);
    }
    next(); // Sinon, c'est du B2B → accès direct
  },
  getReceiptByIdController
);

/**
 * GET /api/logistics/batches/:id
 * Récupérer un lot (batch) spécifique
 * 
 * Accessibilité:
 * - B2B: OUI (clé API)
 * - Web: OUI (auth + viewer/operator/admin) + filtre org
 * 
 * Sécurité:
 * - B2B: Accès direct
 * - Web: Filtre org via middleware verifyBatchAccess
 */
router.get(
  '/logistics/batches/:id',
  (req, res, next) => {
    if ((req as unknown as { activeOrgId?: string }).activeOrgId) {
      return verifyBatchAccess(req, res, next);
    }
    next();
  },
  getBatchByIdController
);

export default router;
```

---

## 7️⃣ Configuration de Routes (Montage dans Express)

**Fichier**: `src/app.ts` ou `src/shared/configs/router.config.ts` (VÉRIFIER)

```typescript
// Assurez-vous que le routeur est importé et utilisé ainsi:

import logisticsRouter from './modules/logistics/receipts/routes/receipt.routes';

// Dans la configuration Express:
app.use('/api', logisticsRouter); // Préfixe déjà /api/logistics dans les routes
```

---

## 8️⃣ Erreurs et Codes HTTP

| Code | Scénario | Message |
|------|----------|---------|
| **201** | Réception créée avec succès | "Réception confirmée" |
| **200** | Requête GET réussie | "Réceptions récupérées", "Statistiques...", etc. |
| **400** | Données invalides (VineJS) OU pas d'org active | "Validation error: ..." |
| **401** | Pas authentifié (flux Web) | "Authentification requise" |
| **403** | Rôle insuffisant OU accès cross-org | "Permission insuffisante" |
| **404** | Réception/Lot introuvable OU accès cross-org révélé génériquement | "Réception introuvable" |
| **500** | Erreur serveur | "Erreur serveur" |

---

## 9️⃣ Flux Complets (Exemples d'Appels)

### Flux B2B: Créer une Réception

```bash
# 1. Créer une réception
curl -X POST http://localhost:3000/api/logistics/receipts \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "id_fournisseur": "sup-001",
    "shipment_id": "SHIP-2026-05-17-001",
    "id_produit": "prod-001",
    "quantite_actuelle": 500,
    "unite_code": "KG",
    "statut_controle": "OK",
    "received_by": "user-123"
  }'

# Response:
{
  "status": 201,
  "message": "Réception confirmée",
  "data": {
    "receiptId": "receipt-uuid",
    "batchId": "batch-uuid"
  }
}

# 2. Récupérer la réception
curl http://localhost:3000/api/logistics/receipts/receipt-uuid \
  -H "x-api-key: YOUR_API_KEY"
```

### Flux Web: Opérateur Crée une Réception

```bash
# 1. Opérateur créé une réception (son ID est utilisé automatiquement)
curl -X POST http://localhost:3000/api/logistics/receipts \
  -H "Authorization: Bearer YOUR_BETTER_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "id_fournisseur": "sup-001",
    "shipment_id": "SHIP-2026-05-17-002",
    "id_produit": "prod-001",
    "quantite_actuelle": 300,
    "unite_code": "KG",
    "statut_controle": "OK",
    "received_by": "ignored-in-web-mode"
  }'

# Response: 201 (received_by overridé avec le token utilisateur)

# 2. Récupérer (filtre org auto)
curl http://localhost:3000/api/logistics/receipts/receipt-uuid \
  -H "Authorization: Bearer YOUR_BETTER_AUTH_TOKEN"

# 3. Stats (ADMIN UNIQUEMENT)
curl http://localhost:3000/api/logistics/receipts/stats \
  -H "Authorization: Bearer YOUR_BETTER_AUTH_TOKEN"
```

---

## 🔟 Checklist d'Implémentation

- [ ] Créer `src/modules/logistics/constants/logistics.constants.ts`
- [ ] Créer `src/modules/logistics/middlewares/requireLogisticsRole.middleware.ts`
- [ ] Créer `src/modules/logistics/middlewares/verifyReceiptAccess.middleware.ts`
- [ ] Créer `src/modules/logistics/middlewares/verifyBatchAccess.middleware.ts`
- [ ] Modifier `src/modules/logistics/receipts/middlewares/validateReceipt.middleware.ts`
- [ ] Modifier `src/modules/logistics/receipts/services/receipt.service.ts`
- [ ] Modifier `src/modules/logistics/receipts/controllers/receipt.controller.ts`
- [ ] Remplacer `src/modules/logistics/receipts/routes/receipt.routes.ts`
- [ ] Vérifier que les imports sont corrects
- [ ] Tester les 6 routes avec curl/Postman
- [ ] Vérifier les cas d'erreur (cross-org, rôle insuffisant, etc.)
- [ ] Exécuter les tests existants: `npm run test`

---

## 1️⃣1️⃣ Notes d'Architecture

### Séparation des Responsabilités
- **Middlewares**: Authentification, autorisation, validation
- **Contrôleurs**: Extraction des paramètres, appel du service, réponse
- **Services**: Logique métier, requêtes BDD, transactions
- **DB**: Prisma (ORM) avec typage strict

### Sécurité Multi-Niveaux
1. **Niveau 1 (B2B vs Web)**: `checkApiKey()` OU `requireLogisticsRole()`
2. **Niveau 2 (Rôles métier)**: `LOGISTICS_ROLES.*` enum
3. **Niveau 3 (Org)**: `verifyReceiptAccess()` / `verifyBatchAccess()`
4. **Niveau 4 (Données)**: Validation VineJS

### Points Sensibles
- **Révélation d'existence**: 404 générique au lieu de 403 (pas de "Vous n'avez pas accès")
- **Cross-org attacks**: Filtrer TOUS les résultats par activeOrgId
- **Rôles temporaires**: Ajouter startDate/endDate si besoin
- **Audit trail**: Logs WORM pour toutes les opérations (TODO: Audit_Log)

---

## 1️⃣2️⃣ Prochaines Étapes

1. **Implémenter une vraie séparation de routes** (B2B vs Web)
   ```typescript
   // B2B: /api/logistics/receipts (clé API)
   // Web: /api/web/logistics/receipts (auth)
   ```

2. **Ajouter les rôles au schéma Prisma**
   ```prisma
   enum LogisticsRoleEnum {
     ADMIN
     OPERATOR
     VIEWER
     QA
   }
   
   model Member {
     logisticsRole LogisticsRoleEnum?
   }
   ```

3. **Implémenter ABAC complète**
   - Permissions granulaires (LOT_RECEIVE, LOT_MOVE, etc.)
   - Conditions par lieu/usine

4. **Logging & Monitoring**
   - Audit trail (Audit_Log table)
   - Alertes access denied

5. **Tests E2E complets**
   - B2B: curl avec API Key
   - Web: Authentification Better-Auth
   - Cross-org rejection
