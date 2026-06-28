import { describe, it, expect } from 'vitest';
import { escapeHtml } from './escapeHtml';

describe('escapeHtml', () => {
  it('échappe les caractères HTML dangereux (anti-XSS inbox)', () => {
    expect(escapeHtml(`<script>alert("x&y")</script>'`)).toBe(
      '&lt;script&gt;alert(&quot;x&amp;y&quot;)&lt;/script&gt;&#39;'
    );
  });

  it('laisse une chaîne neutre inchangée', () => {
    expect(escapeHtml('Lot 42 rappelé')).toBe('Lot 42 rappelé');
  });
});
