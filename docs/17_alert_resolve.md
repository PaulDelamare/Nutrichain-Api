# 17 — Alert Resolve (PATCH `/api/alerts/:id/resolve`)

> **Branche** : `feat/alert-resolve-endpoint`
> **Statut** : MVP livré — résolution manuelle d'`Alert` (IoT + Recall + futurs types).
> Complète l'Objectif SMART n°2 (IoT cold chain — déblocage de la dédup).

## 1. Pourquoi

Le module IoT (`feat/iot-cold-chain-alerts`, docs/15) crée une `Alert` `ACTIVE` à chaque
excursion thermique et **dédoublonne** : tant qu'une alerte ACTIVE existe pour un equipment
donné, aucune nouvelle alerte n'est créée. Sans endpoint de résolution, on ne pouvait pas
re-déclencher une détection sans purger manuellement la DB — démos répétables et tests E2E
bloqués.

Cet endpoint permet à un opérateur Qualité (rôle `owner`/`admin`) de marquer une `Alert`
comme `RESOLVED` après traitement terrain. Le module est **générique** : il résout aussi les
`Alert` de type `PRODUCT_RECALL` créées par le déclenchement de rappel produit (cf. §5).

## 2. Contrat

`PATCH /api/alerts/:id/resolve`

**Auth** : session Better-Auth (cookie ou Bearer) + `requireOrgRole(['owner','admin'])`.

**Body** (optionnel) :
```json
{ "note": "Nettoyage capteur effectué — fausse alerte porte ouverte 2min." }
```

- `note` : string libre, max 500 chars, optionnelle. Stockée **uniquement dans l'audit WORM**
  (`Audit_Log.nouvelle_valeur.note`), pas dans le modèle `Alert`. Empty string `""` traitée
  comme absente (`note: null` en audit).

**Réponse 200** :
```json
{
  "status": 200,
  "message": "Alerte résolue avec succès.",
  "data": {
    "alert": {
      "id": "uuid",
      "statut": "RESOLVED",
      "resolved_by": "user-uuid",
      "resolved_at": "2026-05-29T11:00:00.000Z",
      "type": "TEMP_EXCURSION",
      "...": "..."
    }
  }
}
```

Si l'`Alert` était déjà résolue, `message` contient `"déjà résolue (idempotent)"`. Aucune
nouvelle ligne `Audit_Log` n'est créée pour ce replay (cf. §4 trade-off forensique).

**Erreurs** :
| Code | Champ | Cas |
|---|---|---|
| 400 | `note` | `note.length > 500` |
| 401 | `auth` | Pas de session |
| 403 | `auth` | Rôle insuffisant (pas owner/admin) |
| 404 | `alert` | Introuvable, autre org, id malformé — message générique unique |

## 3. ⚠️ Resolve Alert ≠ Close Recall

**Cas spécial `type === 'PRODUCT_RECALL'`** — message de réponse augmenté d'un warning :

> *"Note : le rappel produit lui-même n'est pas clôturé par cette action — voir le workflow Recall."*

**Pourquoi** : `recallService.triggerRecall` (`docs/12_RECALLS_SYSTEM.md`) crée à la fois
- un `Alert` `PRODUCT_RECALL` (le voyant rouge ergonomique pour le dashboard),
- et passe le `Batch` source + sa descendance en `statut: 'ALERTE'`.

Résoudre l'`Alert` éteint le voyant **mais ne libère pas les Batches**. Le workflow de
clôture du rappel (libération des Batches ou destruction, notification clients) est un
processus séparé hors scope de cet endpoint. Le warning explicite évite la fausse impression
"j'ai résolu l'alerte donc le rappel est terminé".

Couvert par E2E scénario 5 (`scripts/e2e-alert-resolve.ts`) : on assert que le `Batch` source
**reste `ALERTE`** après la résolution de l'`Alert PRODUCT_RECALL`.

## 4. Trade-offs explicites

### Idempotence sans audit

Un 2e PATCH sur une `Alert` déjà RESOLVED renvoie 200 sans créer de ligne `Audit_Log`. C'est
voulu : la `Audit_Log` est la **source de vérité des state-changes**, et un replay n'est pas
un state-change.

**Conséquence** : si une investigation forensique veut savoir "qui a tenté de résoudre quoi
et quand, même en replay", l'info n'est pas dans l'audit. Trade-off accepté pour v1 ; un futur
log applicatif (sortie `winston`) peut tracer les replays sans polluer la hash chain WORM.

### Note PII et GDPR

Le champ `note` est libre et l'opérateur peut **accidentellement** y saisir des informations
nominatives (nom client, contact, adresse). La consigne UI/doc est : **"Ne pas saisir
d'information PII dans la note."**

**Classification GDPR** : les lignes `Audit_Log` portant `action = 'ALERT_RESOLVED'` sont
considérées comme **potentiellement PII-containing** pour la purge GDPR. La politique de
rétention WORM (cf. `docs/07_audit_worm.md` si présent) doit traiter ces lignes avec la même
attention que les `Audit_Log` de `BATCH_RECALL_TRIGGERED` qui stockent des `customerName`.

### Pas de GET liste/détail en v1 (flag pour Hugo)

Cette PR n'expose **pas** `GET /api/alerts` ni `GET /api/alerts/:id`. Workflow v1 :
- L'`alert.id` est récupérable depuis l'email d'alerte (cf. `docs/15` §10), depuis Prisma
  Studio, ou depuis la réponse 201 de l'endpoint qui a créé l'`Alert` (admin tooling).
- L'UI mobile / web ne peut donc pas afficher une **liste** d'alertes actives — workflow
  "click sur lien email → page de résolution" uniquement.

Listing paginé reporté en P3 (cf. §6).

## 5. Architecture

```
PATCH /api/alerts/:id/resolve
  → requireAuth (Better-Auth session)
  → requireOrgRole(['owner','admin'])
  → validateResolveAlert  (VineJS : note optionnel, maxLength 500)
  → verifyAlertAccess     (Prisma.alert.findFirst { id, organization_id } → 404 sinon)
  → resolveAlertController (compose message contextuel + sendSuccess 200)
       ↳ alertService.resolveAlert({ alert, userId, note })
            ↳ prisma.$transaction(Serializable, timeout 10s)
                ↳ updateMany { id, statut:'ACTIVE' } → count
                   - count === 0 → idempotent, refetch, retour { alreadyResolved: true }
                   - count === 1 → refetch + auditService.logAction({...}, tx)
                                   retour { alreadyResolved: false }
```

**Race-safety** : `updateMany + count` est le **seul** garde de l'invariant. Deux callers
concurrents → un winner (count===1), un loser (count===0). Le loser ne crée pas d'audit
double. Pattern identique à `auth.config.ts:72` (consommation d'invitation) et à la dédup
IoT.

**Audit** :
- `entity = 'Alert'`, `entity_id = alertId`, `action = 'ALERT_RESOLVED'`
- `ancienne_valeur = { statut, resolved_by, resolved_at }` (snapshot complet pré-update lu
  depuis l'argument `alert` — pas un littéral hardcodé, conserve le contexte forensique exact)
- `nouvelle_valeur = { statut: 'RESOLVED', resolved_by, resolved_at, note: <string|null> }`
- Exécuté **dans la même tx** que l'`updateMany` (hash chain intègre).

## 6. Limites & P3

| Item | Justification du report |
|---|---|
| `GET /api/alerts` paginée filtrable | UI mobile/dashboard P3 — workflow v1 = email/Prisma Studio |
| `GET /api/alerts/:id` | Idem |
| `PATCH /alerts/:id/reopen` | Cas rare, à voir si besoin métier |
| Notification mail au resolve | Les destinataires originaux peuvent "oublier" sans event push |
| Métriques temps moyen de résolution | Tableau de bord Prometheus P3 |
| Workflow d'escalade auto si non résolu après X h | Cron P3 |
| Bulk resolve (N alertes en 1 appel) | Pas de cas d'usage MVP |
| Webhook sortant à la résolution | Intégrations externes P3 |

## 7. Tests

- **Unit** :
  - `alert.service.test.ts` (12 cas) : happy / idempotent / race / oldValue snapshot complet /
    note null vs string vs charset exotique / audit rollback / tx options literal / PRODUCT_RECALL
    propagé / self-resolve
  - `verifyAlertAccess.middleware.test.ts` (5 cas) : message constant identique pour 3 cas
    d'échec + 400 si pas d'activeOrgId
  - `validateResolveAlert.middleware.test.ts` (5 cas) : boundary 500 / 501 / empty string
    traitée comme absente
  - `resolveAlert.controller.test.ts` (4 cas) : message contextuel PRODUCT_RECALL vs TEMP_EXCURSION,
    idempotent
  - `alert.routes.test.ts` (7 cas) : 200 / 401 / 403 / 404 / 200 idempotent / 400 note > 500 /
    PRODUCT_RECALL message
- **E2E** `scripts/e2e-alert-resolve.ts` (`npm run e2e:alert-resolve`) :
  1. Setup Equipment + sensor + Alert ACTIVE pré-créée
  2. Happy path résolution + assertions DB + audit
  3. Idempotent : 2e appel ne crée pas de 2e audit
  4. **Re-déclencher dédup IoT** : insertion ≥ 5 telemetry points + `iotAlertService.checkAndAlert`
     → nouvelle Alert ACTIVE créée. Preuve **déterministe** que la résolution débloque.
  5. PRODUCT_RECALL : Batch reste `ALERTE` après résolution de l'Alert (preuve découplage)
  6. Cleanup

## 8. Exemple manuel via Bruno

Folder "Alerts" → "Resolve Alert" :
- `PATCH {{url}}alerts/{{alert_id}}/resolve`
- Bearer `{{token}}` (admin/owner)
- Body : `{ "note": "Nettoyage capteur effectué." }`

Récupérer un `alert_id` :
1. Lancer une excursion (cf. docs/15 §9) → email reçu → `alert.id` visible dedans, ou
2. `npx prisma studio` → table `Alert` → copier un `id` statut=`ACTIVE`.

## See also

- `docs/15_iot_cold_chain_alerts.md` — création des `Alert` `TEMP_EXCURSION` (dédup débloquée par cette PR)
- `docs/12_RECALLS_SYSTEM.md` — création des `Alert` `PRODUCT_RECALL` (NON clôturées par cette PR)
- `docs/16_invitation_register_flow.md` — exemple récent d'utilisation du même pattern d'auth/audit
- `src/modules/alerts/` — implémentation
- Swagger : `/api-docs` → tag `Alertes`

---

*Branche `feat/alert-resolve-endpoint`. Multi-agent review du plan v1 → v2. Multi-agent review du code après implémentation.*
