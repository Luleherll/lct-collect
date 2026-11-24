import AxeBuilder from '@axe-core/playwright';
import { test, expect, type Page } from '@playwright/test';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { newLines } from '../../functions/src/protocol';
async function login(page: Page, role = 'agent') {
  await page.goto('/login/');
  await page.getByPlaceholder('Your username').fill(`demo.${role}`);
  await page.getByPlaceholder('Your password').fill('CollectDemo123!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(role === 'agent' ? '**/agent/' : `**/${role}/`);
}
function fixture(name: string) {
  if (
    !/^(127\.0\.0\.1|localhost):\d+$/.test(
      process.env.FIRESTORE_EMULATOR_HOST ?? '',
    )
  )
    throw Error('Emulator only');
  const app = initializeApp({ projectId: 'demo-lct-collect' }, name);
  return { app, db: getFirestore(app) };
}
test('Both deposits and withdrawals survive offline reload and save one atomic submission', async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  const { app, db } = fixture('both-browser');
  const refs = ['both-member-saving', 'both-member-fixed'].map((id) =>
    db.doc('members/' + id),
  );
  const marker = 'both-browser-' + Date.now();
  try {
    for (const [index, ref] of refs.entries())
      await ref.set({
        memberId: ref.id,
        fullName: 'Both Browser Example',
        uniqueNumber: 'LCT88221',
        accountNumber: '8822' + index,
        active: true,
        searchName: 'both browser example',
        updatedAt: Timestamp.now(),
      });
    await login(page);
    await page.getByLabel('Search members', { exact: true }).fill('LCT88221');
    await page.locator('.multi-account').click();
    await page.getByLabel('Deposit account type').selectOption('both');
    await page.getByLabel('Withdrawal account type').selectOption('both');
    await page
      .getByRole('button', { name: 'Review entry', exact: true })
      .click();
    await expect(page.locator('#deposit-error')).toBeVisible();
    for (const [label, value] of [
      ['Deposit Saving', '100'],
      ['Deposit Fixed', '200'],
      ['Withdrawal Saving', '30'],
      ['Withdrawal Fixed', '40'],
    ])
      await page.getByLabel(label + ' in UGX', { exact: true }).fill(value);
    await page.getByLabel('Loan instalment in UGX', { exact: true }).fill('5');
    await page.getByLabel('Notes Optional').fill(marker);
    await page.setViewportSize({ width: 320, height: 760 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations).toEqual([]);
    await page.screenshot({
      path: 'test-results/both-fields-mobile.png',
      fullPage: true,
    });
    // Wait for the actual durable draft, rather than a fixed delay.
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const open = indexedDB.open('lct-local-first-v1', 1);
          const db = await new Promise<IDBDatabase>((r, j) => {
            open.onsuccess = () => r(open.result);
            open.onerror = () => j(open.error);
          });
          const tx = db.transaction('users');
          const req = tx
            .objectStore('users')
            .get('demo-lct-collect/demo-agent');
          const records: any = await new Promise((r) => {
            req.onsuccess = () => r(req.result);
          });
          db.close();
          return records?.drafts?.collection?.splitValues?.withdrawal?.fixed;
        }),
      )
      .toBe('40');
    await context.setOffline(true);
    await page.reload();
    await expect(
      page.getByLabel('Deposit Saving in UGX', { exact: true }),
    ).toHaveValue(/100/);
    await expect(
      page.getByLabel('Withdrawal Fixed in UGX', { exact: true }),
    ).toHaveValue(/40/);
    await page.getByLabel('Deposit account type').selectOption('saving');
    await expect(
      page.getByLabel('Deposit in UGX', { exact: true }),
    ).toHaveValue(/100/);
    await page.getByLabel('Deposit account type').selectOption('both');
    await expect(
      page.getByLabel('Deposit Fixed in UGX', { exact: true }),
    ).toHaveValue(/200/);
    await page
      .getByRole('button', { name: 'Review entry', exact: true })
      .click();
    const review = page.getByRole('dialog');
    await expect(review).toContainText('Deposit · Saving');
    await expect(review).toContainText('Withdrawal · Fixed');
    await page.screenshot({
      path: 'test-results/both-review-mobile.png',
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Confirm & save' }).click();
    await expect(
      page.getByRole('status', { name: 'Saved entry receipt' }),
    ).toContainText('Withdrawal (Fixed) UGX 40');
    expect(
      (await db.collection('entries').where('note', '==', marker).get()).empty,
    ).toBe(true);
    await context.setOffline(false);
    await expect
      .poll(
        async () =>
          (await db.collection('entries').where('note', '==', marker).get())
            .size,
      )
      .toBe(2);
    const entries = (
      await db.collection('entries').where('note', '==', marker).get()
    ).docs.map((d) => d.data());
    expect(entries[0].submissionGroupId).toBe(entries[1].submissionGroupId);
    expect(entries.flatMap((e) => Object.keys(e.lines))).toHaveLength(5);
    const summary = await db.doc(`sessions/${entries[0].sessionId}`).get();
    expect(summary.data()!.expectedCash).toBeGreaterThanOrEqual(0);
  } finally {
    await context.setOffline(false);
    await deleteApp(app);
  }
});
test('viewer refills filtered pages, clamps the last page and navigates numbered pages', async ({
  page,
}) => {
  test.setTimeout(180000);
  const { app, db } = fixture('refill-browser'),
    day = '2022-03-03';
  const refs = Array.from({ length: 121 }, (_, i) =>
    db.doc(`entries/refill-example-${i}`),
  );
  try {
    const batch = db.batch();
    refs.forEach((ref, i) =>
      batch.set(ref, {
        entryId: ref.id,
        sessionId: 'demo-agent_' + day,
        workday: day,
        agentId: 'demo-agent',
        agentNameSnapshot: 'Demo agent',
        memberId: '003',
        memberNameSnapshot: `Refill Example ${i}`,
        accountNumberSnapshot: '003',
        uniqueNumberSnapshot: 'LCT003',
        createdAt: Timestamp.fromMillis(Date.parse(day) + i * 1000),
        financialRevision: 1,
        lines: newLines({ deposit: 1, withdrawal: 0, loanInstalment: 0 }),
      }),
    );
    await batch.commit();
    await login(page, 'viewer');
    await page.getByLabel('Workday', { exact: true }).fill(day);
    const nav = page.getByRole('navigation', { name: 'Register pages' });
    await expect(page.locator('.entry-row')).toHaveCount(50);
    await nav.getByRole('button', { name: 'Page 3', exact: true }).click();
    await expect(page.locator('.entry-row')).toHaveCount(21);
    await expect(
      nav.getByRole('button', { name: 'Page 3', exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    for (let i = 0; i < 21; i++) {
      await page
        .locator('.entry-row')
        .first()
        .getByRole('button', { name: 'Mark recorded', exact: true })
        .click();
      await expect(page.locator('.entry-row')).toHaveCount(
        i === 20 ? 50 : 20 - i,
      );
    }
    await expect(nav).toContainText('Page 2 of 2');
    await nav.getByRole('button', { name: 'Page 1', exact: true }).click();
    for (let i = 0; i < 51; i++) {
      await page
        .locator('.entry-row')
        .first()
        .getByRole('button', { name: 'Mark recorded', exact: true })
        .click();
      await expect(page.locator('.entry-row')).toHaveCount(i === 50 ? 49 : 50);
    }
    await expect(nav).toContainText('Page 1 of 1');
    await page.getByRole('button', { name: 'Undo recording check' }).click();
    await page.getByRole('button', { name: 'Undo check', exact: true }).click();
    await expect(page.locator('.entry-row')).toHaveCount(50);
    await page
      .getByRole('combobox', { name: 'Status', exact: true })
      .selectOption('all');
    await expect(nav).toContainText('Page 1 of 3');
    await nav.getByRole('button', { name: 'Page 3', exact: true }).click();
    await page
      .getByLabel('Search workday', { exact: true })
      .fill('Refill Example 120');
    await expect(page.locator('.entry-row')).toHaveCount(1);
    await expect(nav).toContainText('Page 1 of 1');
    await page.getByLabel('Clear search workday').click();
    await page.setViewportSize({ width: 320, height: 760 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await nav.screenshot({ path: 'test-results/numbered-pages-mobile.png' });
  } finally {
    const batch = db.batch();
    refs.forEach((ref) => batch.delete(ref));
    await batch.commit();
    await deleteApp(app);
  }
});
