import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { dayAt, dayStart, newLines } from '../../functions/src/protocol';
async function login(page: Page) {
  await page.goto('/login/');
  await page.getByPlaceholder('Your username').fill('demo.agent');
  await page.getByPlaceholder('Your password').fill('CollectDemo123!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL('**/agent/');
  await expect(page.locator('.cash-number strong')).toBeVisible();
}
async function entry(page: Page, value: number) {
  await page.getByLabel('Search members', { exact: true }).fill('LCT003');
  await page.locator('.single-account').first().click();
  await page.locator('#deposit').fill(String(value));
  await page.getByRole('button', { name: 'Review entry', exact: true }).click();
  await page
    .getByRole('button', { name: 'Confirm & save', exact: true })
    .click();
  await expect(
    page.getByRole('status', { name: 'Saved entry receipt' }),
  ).toContainText(value.toLocaleString('en-UG'));
}
async function saved(page: Page) {
  return page.evaluate(async () => {
    const request = indexedDB.open('lct-local-first-v1');
    const db = await new Promise<IDBDatabase>(
      (resolve) => (request.onsuccess = () => resolve(request.result)),
    );
    const read = db
      .transaction('users')
      .objectStore('users')
      .get('demo-lct-collect/demo-agent');
    return new Promise<any>(
      (resolve) =>
        (read.onsuccess = () => {
          db.close();
          resolve(read.result);
        }),
    );
  });
}
test('a delayed receipt cannot hide a newer balance from another device, even after disconnect', async ({
  page,
  context,
  browser,
}) => {
  let release!: () => void, committed!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve)),
    posted = new Promise<void>((resolve) => (committed = resolve));
  let intercepted = false;
  await page.route('**/syncOperation', async (route) => {
    const data =
      route.request().method() === 'POST'
        ? route.request().postDataJSON()?.data
        : null;
    if (
      !intercepted &&
      data?.kind === 'entry' &&
      data.data.values.deposit === 3141
    ) {
      intercepted = true;
      const response = await route.fetch();
      committed();
      await held;
      await route.fulfill({ response });
    } else await route.continue();
  });
  const other = await browser.newContext({ baseURL: 'http://127.0.0.1:4179' });
  try {
    await login(page);
    const before = Number(
      (await page.locator('.cash-number strong').innerText()).replaceAll(
        ',',
        '',
      ),
    );
    await entry(page, 3141);
    await posted;
    const second = await other.newPage();
    await login(second);
    await entry(second, 2718);
    await expect(second.getByLabel('Unsynced work')).toHaveCount(0, {
      timeout: 30000,
    });
    const expected = before + 3141 + 2718;
    await expect
      .poll(async () =>
        Object.values((await saved(page)).heldRecords ?? {}).some(
          (record: any) => record?.expectedCash === expected,
        ),
      )
      .toBe(true);
    // The old receipt must reconcile correctly without a subsequent Firestore snapshot.
    await context.setOffline(true);
    release();
    await expect(page.getByLabel('Unsynced work')).toHaveCount(0, {
      timeout: 30000,
    });
    await expect(page.locator('.cash-number strong')).toHaveText(
      expected.toLocaleString('en-UG'),
    );
    const state = await saved(page);
    expect(state.heldRecords).toEqual({});
    await page.reload();
    await expect(page.locator('.cash-number strong')).toHaveText(
      expected.toLocaleString('en-UG'),
    );
  } finally {
    release();
    await other.close();
  }
});

test('a reviewed archive releases a valid late deposit behind a permanently rejected offline void', async ({
  page,
  context,
}) => {
  if (
    !/^(127\.0\.0\.1|localhost):[0-9]+$/.test(
      process.env.FIRESTORE_EMULATOR_HOST ?? '',
    )
  )
    throw new Error('Local emulator only');
  const { initializeApp, deleteApp } = await import('firebase-admin/app');
  const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
  const app = initializeApp(
    { projectId: 'demo-lct-collect' },
    'rejected-void-recovery',
  );
  const db = getFirestore(app),
    day = dayAt(Date.now() - 86400000),
    sessionId = `demo-agent_${day}`,
    entryId = 'expired-void-original-entry';
  const ref = db.doc(`sessions/${sessionId}`),
    old = db
      .collection('entries')
      .where('agentId', '==', 'demo-agent')
      .where('workday', '==', day);
  const batch = db.batch();
  for (const doc of (await old.get()).docs) batch.delete(doc.ref);
  batch.set(ref, {
    sessionId,
    agentId: 'demo-agent',
    workday: day,
    startsAt: Timestamp.fromMillis(dayStart(day)),
    endsAt: Timestamp.fromMillis(dayStart(day) + 86400000),
    openingCash: 100,
    totalDeposits: 50,
    totalWithdrawals: 0,
    totalLoanInstalments: 0,
    expectedCash: 150,
    revision: 1,
    lastMutationId: entryId,
    createdAt: Timestamp.fromMillis(dayStart(day) + 1000),
  });
  batch.set(db.doc(`entries/${entryId}`), {
    entryId,
    sessionId,
    agentId: 'demo-agent',
    agentNameSnapshot: 'Demo agent',
    workday: day,
    memberId: '003',
    memberNameSnapshot: 'Example Member 3',
    accountNumberSnapshot: '000401001003',
    createdAt: Timestamp.fromMillis(dayStart(day) + 2000),
    financialRevision: 1,
    lines: newLines({ deposit: 50, withdrawal: 0, loanInstalment: 0 }),
  });
  await batch.commit();
  try {
    await login(page);
    await page.clock.install();
    await page.clock.setSystemTime(new Date(dayStart(day) + 43200000));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.locator('.cash-number strong')).toHaveText('150');
    await page
      .getByRole('button', { name: 'More actions', exact: true })
      .click();
    await page
      .getByRole('menuitem', { name: 'Recent entries', exact: true })
      .click();
    const row = page.locator('.entry-row').filter({ hasText: '50' }).first();
    await row.getByRole('button', { name: 'View Deposit details' }).click();
    await context.setOffline(true);
    await page
      .getByLabel('Reason for voiding')
      .fill('Offline correction before cutoff');
    await page
      .getByRole('button', { name: 'Void this line', exact: true })
      .click();
    await page
      .getByRole('link', { name: 'Back to collection', exact: true })
      .click();
    await entry(page, 25);
    await expect(page.getByLabel('Unsynced work')).toContainText(
      '2 unsynced changes',
    );
    await context.setOffline(false);
    await expect(page.getByLabel('Unsynced work')).toContainText(
      'Needs attention',
      { timeout: 30000 },
    );
    await expect(page.locator('.cash-number strong')).toHaveText('150');
    const initial = await saved(page),
      root = initial.commands.find(
        (p: any) => p.command.kind === 'void',
      ).command;
    await page.getByLabel('Unsynced work').locator('summary').click();
    await page
      .getByRole('button', { name: 'Review change', exact: true })
      .first()
      .click();
    await page
      .getByRole('button', {
        name: 'Review archive and later changes',
        exact: true,
      })
      .click();
    let dialog = page.getByRole('dialog', {
      name: 'Archive rejected void?',
      exact: true,
    });
    await expect(dialog).toContainText('1 later change');
    await expect(
      dialog.getByRole('button', { name: 'Keep in queue', exact: true }),
    ).toBeFocused();
    await dialog
      .getByRole('button', { name: 'Keep in queue', exact: true })
      .click();
    expect((await saved(page)).commands.map((p: any) => p.command.id)).toEqual(
      initial.commands.map((p: any) => p.command.id),
    );
    await page
      .getByRole('button', {
        name: 'Review archive and later changes',
        exact: true,
      })
      .click();
    dialog = page.getByRole('dialog', {
      name: 'Archive rejected void?',
      exact: true,
    });
    await page.setViewportSize({ width: 320, height: 740 });
    const audit = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(audit.violations).toEqual([]);
    await page.screenshot({
      path: 'test-results/visual/archive-rejected-void.png',
    });
    await dialog
      .getByRole('button', {
        name: 'Archive void and release eligible changes',
        exact: true,
      })
      .click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByLabel('Unsynced work')).toHaveCount(0, {
      timeout: 30000,
    });
    await expect(page.locator('.cash-number strong')).toHaveText('175');
    const final = await saved(page);
    expect(
      final.resolved.find((p: any) => p.command.id === root.id),
    ).toMatchObject({ resolution: 'archived', command: root });
    expect(final.receipts[root.id].status).toBe('rejected');
    expect(
      (await db.doc(`entries/${entryId}`).get()).data()!.lines.deposit.state,
    ).toBe('active');
    expect((await ref.get()).data()!.expectedCash).toBe(175);
    const deposits = await old.get();
    expect(deposits.size).toBe(2);
    expect(
      deposits.docs.some((doc) => doc.data().lateSubmission === true),
    ).toBe(true);
    await page.reload();
    await expect(page.getByLabel('Unsynced work')).toHaveCount(0);
    await expect(page.locator('.cash-number strong')).toHaveText('175');
  } finally {
    await deleteApp(app);
  }
});
