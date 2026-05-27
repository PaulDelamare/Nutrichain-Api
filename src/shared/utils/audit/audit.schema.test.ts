import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.resolve(__dirname, '../../../../prisma/schema.prisma');
const schemaContent = fs.readFileSync(schemaPath, 'utf-8');

describe('Audit_Log schema invariants (WORM B)', () => {
  const auditLogBlock = schemaContent.match(/model Audit_Log\s*\{[^}]*\}/)?.[0];

  it('Audit_Log.organization doit refuser onDelete: Cascade (WORM contractuel)', () => {
    expect(auditLogBlock).toBeDefined();
    expect(auditLogBlock!).not.toMatch(
      /organization\s+Organization\s+@relation\([^)]*onDelete:\s*Cascade/
    );
    expect(auditLogBlock!).toMatch(
      /organization\s+Organization\s+@relation\([^)]*onDelete:\s*Restrict/
    );
  });

  it("Audit_Log.organization doit refuser onDelete: SetNull (perdrait l'auteur du log)", () => {
    expect(auditLogBlock!).not.toMatch(
      /organization\s+Organization\s+@relation\([^)]*onDelete:\s*SetNull/
    );
  });

  it('prev_hash et signature_hash doivent rester @db.Char(64) (intégrité de la chaîne)', () => {
    expect(auditLogBlock!).toMatch(/prev_hash\s+String\s+@db\.Char\(64\)/);
    expect(auditLogBlock!).toMatch(/signature_hash\s+String\s+@db\.Char\(64\)/);
  });
});
