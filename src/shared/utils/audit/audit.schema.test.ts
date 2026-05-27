import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.resolve(__dirname, '../../../../prisma/schema.prisma');
const schemaContent = fs.readFileSync(schemaPath, 'utf-8');

describe('Audit_Log schema invariants (WORM B)', () => {
  it('Audit_Log.organization doit refuser onDelete: Cascade (WORM contractuel)', () => {
    const auditLogBlock = schemaContent.match(/model Audit_Log\s*\{[^}]*\}/);
    expect(auditLogBlock).not.toBeNull();

    const block = auditLogBlock![0];
    expect(block).not.toMatch(/organization\s+Organization\s+@relation\([^)]*onDelete:\s*Cascade/);
    expect(block).toMatch(/organization\s+Organization\s+@relation\([^)]*onDelete:\s*Restrict/);
  });
});
