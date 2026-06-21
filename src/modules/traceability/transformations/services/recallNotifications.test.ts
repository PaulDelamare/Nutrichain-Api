import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../shared/utils/mailer/mailer', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../../shared/utils/logger/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { notifyRecallCustomers, RecallCustomerTarget } from './recallNotifications';
import { sendEmail } from '../../../../shared/utils/mailer/mailer';
import { logger } from '../../../../shared/utils/logger/logger';

const target = (overrides: Partial<RecallCustomerTarget> = {}): RecallCustomerTarget => ({
  customerEmail: 'client@example.com',
  customerName: 'Supermarché Central',
  shipmentRef: 'SHIP-REF-001',
  batchIds: ['batch-1', 'batch-2'],
  ...overrides,
});

describe('notifyRecallCustomers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('envoie un email à chaque client disposant d une adresse', async () => {
    await notifyRecallCustomers(
      [target({ customerEmail: 'a@x.com' }), target({ customerEmail: 'b@x.com' })],
      'batch-root',
      'Listeria'
    );

    expect(sendEmail).toHaveBeenCalledTimes(2);
    const recipients = vi
      .mocked(sendEmail)
      .mock.calls.map((c) => c[0].to)
      .sort();
    expect(recipients).toEqual(['a@x.com', 'b@x.com']);
  });

  it('ignore les clients sans email et journalise un contact manuel requis', async () => {
    await notifyRecallCustomers(
      [target({ customerEmail: 'a@x.com' }), target({ customerEmail: null })],
      'batch-root',
      'reason'
    );

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'a@x.com' }));
    expect(logger.warn).toHaveBeenCalled();
    const warn = vi.mocked(logger.warn).mock.calls.flat().join(' ');
    expect(warn).toMatch(/1 client/);
  });

  it('échappe le motif et le nom client dans le corps HTML (anti-XSS)', async () => {
    await notifyRecallCustomers(
      [target({ customerName: '<b>ACME</b>' })],
      'batch-root',
      '<script>alert(1)</script>'
    );

    const html = vi.mocked(sendEmail).mock.calls[0][0].html;
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;b&gt;ACME&lt;/b&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it("n'expose pas les identifiants internes de lots au client (seulement le nombre)", async () => {
    await notifyRecallCustomers(
      [target({ batchIds: ['uuid-secret-1', 'uuid-secret-2'] })],
      'b',
      'r'
    );

    const html = vi.mocked(sendEmail).mock.calls[0][0].html;
    expect(html).not.toContain('uuid-secret-1');
    expect(html).toContain('2'); // le nombre de lots concernés
  });

  it('un échec d envoi est capté et ne propage pas (fire-and-forget)', async () => {
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error('SMTP down'));

    await expect(
      notifyRecallCustomers([target()], 'batch-root', 'reason')
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
  });
});
