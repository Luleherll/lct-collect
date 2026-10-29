import { test, expect, type Page } from '@playwright/test';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { bounds, workday } from '../../src/lib/domain';
const evidence = process.env.LCT_UI_EVIDENCE_DIR ?? 'test-results/visual';
async function login(page: Page, role = 'agent') {
  await page.goto('/login/');
  await page.getByPlaceholder('Your username').fill(`demo.${role}`);
  await page.getByPlaceholder('Your password').fill('CollectDemo123!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL(role === 'agent' ? '**/agent/' : `**/${role}/`);
}
async function select(page: Page, id = '003') {
  await page.getByLabel('Search members', { exact: true }).fill(`LCT${id}`);
  await page.locator('.single-account').first().click();
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}

test('agent validates, protects drafts, saves through real operations, and voids a line', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page);
  await select(page);
  await expect(page.locator('#deposit')).toBeFocused();
  await page.locator('#deposit').fill('1.5');
  await expect(page.locator('#deposit')).toHaveValue('');
  await page.locator('#deposit').fill('letters');
  await expect(page.locator('#deposit')).toHaveValue('');
  await expect(page.locator('#deposit')).toHaveAttribute(
    'inputmode',
    'numeric',
  );
  await page.locator('#deposit').fill('100000001');
  await page.locator('#withdrawal').focus();
  await expect(page.locator('#deposit-error')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'New entry' })).toBeVisible();
  await page.locator('#deposit').fill('21,007');
  await page.locator('#withdrawal').focus();
  await expect(page.locator('#deposit-error')).toHaveCount(0);
  await page.getByLabel('Search members', { exact: true }).fill('LCT004');
  await page
    .locator('.single-account')
    .filter({ hasText: '000401001004' })
    .click();
  await expect(page.getByRole('dialog')).toContainText('Change member');
  await page.getByRole('button', { name: 'Keep entry', exact: true }).click();
  await expect(page.locator('#deposit')).toHaveValue('21,007');
  await page.getByRole('link', { name: 'Skip to content' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
  await page.getByRole('link', { name: 'History', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Discard this entry');
  await page.getByRole('button', { name: 'Keep entry', exact: true }).click();
  await page.getByLabel('Clear search members').click();
  await page.getByRole('button', { name: 'Review entry', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('21,007');
  await page.getByRole('button', { name: 'Confirm & save' }).click();
  await expect(
    page.getByRole('status', { name: 'Saved entry receipt' }),
  ).toContainText('Example Member 3');
  await expect(
    page.getByRole('status', { name: 'Saved entry receipt' }),
  ).toContainText('21,007');
  await page.getByRole('link', { name: 'Recent entries', exact: true }).click();
  const row = page.locator('.entry-row').filter({ hasText: '21,007' }).first();
  await row.getByRole('button', { name: 'View Deposit details' }).click();
  await page.getByLabel('Reason for voiding').fill('Browser test correction');
  await page.getByRole('button', { name: 'Void this line' }).click();
  await expect(row).toContainText('Voided');
  expect(errors).toEqual([]);
  await noOverflow(page);
});

test('member change discards amounts only after confirmation and long inputs reflow at 320px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await login(page);
  await select(page);
  await page.locator('#deposit').fill('100,000,000');
  await page.locator('#withdrawal').focus();
  await noOverflow(page);
  expect(
    await page
      .locator('#deposit')
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await page.getByLabel('Search members', { exact: true }).fill('LCT004');
  await page
    .locator('.single-account')
    .filter({ hasText: '000401001004' })
    .click();
  await page.getByRole('button', { name: 'Discard & change member' }).click();
  await expect(page.locator('#deposit')).toHaveValue('');
  await expect(page.locator('.entry-card .account')).toContainText('LCT004');
  await page.locator('#deposit').fill('20,000');
  await page.locator('#loanInstalment').fill('5,000');
  await page.locator('#withdrawal').focus();
  await page.screenshot({
    path: join(evidence, 'after-agent-mobile-320.png'),
    fullPage: true,
  });
});

test('viewer records and undoes through the real audited operations', async ({
  page,
}) => {
  await login(page, 'viewer');
  await expect(
    page.getByRole('link', { name: 'Register', exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole('combobox', { name: 'Status', exact: true })
    .selectOption('all');
  await page.route(/documents:commit|Firestore\/Commit/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 800));
    await route.continue();
  });
  const row = page
    .locator('.entry-row')
    .filter({ hasText: 'Loan instalment' })
    .first();
  const idleWidth = await row
    .getByRole('button', { name: 'Mark recorded' })
    .evaluate((el) => el.getBoundingClientRect().width);
  await row.getByRole('button', { name: 'Mark recorded' }).click();
  await expect(row.getByRole('button', { name: 'Recording…' })).toHaveAttribute(
    'aria-busy',
    'true',
  );
  await expect(row.getByRole('button', { name: 'Recording…' })).toBeDisabled();
  expect(
    await row
      .getByRole('button', { name: 'Recording…' })
      .evaluate((el) => el.getBoundingClientRect().width),
  ).toBe(idleWidth);
  await expect(
    page.getByRole('button', { name: 'Undo recording check', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.receipt')).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Undo recording check', exact: true })
    .click();
  await page.getByRole('button', { name: 'Undo check', exact: true }).click();
  await expect(
    page.locator('.entry-row').filter({ hasText: 'Loan instalment' }).first(),
  ).toContainText('Unrecorded');
  await page
    .getByRole('combobox', { name: 'Status', exact: true })
    .selectOption('all');
  await noOverflow(page);
  await page.screenshot({
    path: join(evidence, 'after-viewer-mobile.png'),
    fullPage: true,
  });
});

test('owner imports separate accounts under member/group numbers and preserves identities', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await login(page, 'admin');
  await page.locator('input[type=file]').setInputFiles({
    name: 'update.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'Account Id,Account Number,Unique Number,Account Name\n006,000401001006,LCT006,Updated Example Six\n008,000401001008,LCT006,Updated Example Six\n9001,009001,LCT9001,New Example Account\n9002,009002,ABC 2,Example Group\n',
    ),
  });
  await expect(
    page.getByRole('heading', { name: 'Review import' }),
  ).toBeVisible();
  await expect(page.locator('del').first()).toContainText('Example Member 6');
  await page.getByRole('button', { name: 'Apply updates' }).click();
  await expect(
    page.getByText('Member directory updated.', { exact: true }),
  ).toBeVisible({ timeout: 100_000 });
  await page.getByLabel('Search directory', { exact: true }).fill('ABC2');
  await expect(page.locator('.directory-list .group-chip')).toHaveText('Group');
  await expect(page.locator('.directory-list .member-account')).toHaveCount(2);
  await page.getByLabel('Search directory', { exact: true }).fill('9001');
  await expect(page.locator('.directory-list')).toContainText(
    'New Example Account',
  );
  await page.locator('input[type=file]').setInputFiles({
    name: 'collision.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'Account Id,Account Number,Unique Number,Account Name\n9002,009001,LCT9001,Reviewed name change\n',
    ),
  });
  await expect(
    page.getByRole('button', { name: 'Apply updates' }),
  ).toBeEnabled();
  await expect(
    page.getByRole('heading', { name: 'Review import' }),
  ).toBeVisible();
  await expect(page.locator('tbody')).toContainText('LCT9001');
  await expect(page.locator('tbody')).toContainText('Update');
  await expect(
    page.getByRole('columnheader', { name: 'Account ID' }),
  ).toHaveCount(0);
});

test('blocked Web Storage permits memory-only sign-in and safely blocks financial submission', async ({
  page,
}) => {
  await page.addInitScript(() => {
    for (const name of ['localStorage', 'sessionStorage'])
      Object.defineProperty(window, name, {
        get() {
          throw new DOMException('Blocked', 'SecurityError');
        },
      });
  });
  await login(page);
  await select(page);
  await page.locator('#deposit').fill('10,000');
  await page.getByRole('button', { name: 'Review entry', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm & save' }).click();
  await page.getByRole('button', { name: 'Back / edit' }).click();
  await expect(page.getByRole('alert')).toContainText(
    'cannot retain a save reference',
  );
  await expect(
    page.getByRole('button', { name: 'Review entry', exact: true }),
  ).toBeEnabled();
});

test('offline and operational rollover stop writes without replaying the draft', async ({
  page,
  context,
}) => {
  await login(page);
  await select(page);
  await page.locator('#deposit').fill('20,000');
  await context.setOffline(true);
  await expect(
    page.getByRole('button', { name: 'Review entry', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('status').filter({ hasText: /offline/i }),
  ).toBeVisible();
  await context.setOffline(false);
  await expect(
    page.getByRole('button', { name: 'Review entry', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Review entry', exact: true }).click();
  await page.clock.install();
  await page.clock.setSystemTime(
    new Date(bounds(workday()).end.getTime() + 1000),
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByRole('button', { name: 'Confirm & save' }).click();
  await expect(page.getByRole('alert')).toContainText('session has ended');
  await expect(
    page.getByRole('heading', { name: "Start today's session" }),
  ).toBeVisible();
});

test('restored save reference checks the server and shows a saved-account toast', async ({
  page,
}) => {
  await page.addInitScript(
    (id) => sessionStorage.setItem('lct-pending-demo-agent', id),
    `emulator_${workday().replaceAll('-', '')}`,
  );
  await login(page);
  await expect(
    page.getByRole('button', { name: 'Check save status' }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Check save status' }).click();
  await expect(
    page.getByRole('status', { name: 'Saved entry receipt' }),
  ).toContainText('Example Member 1');
  await expect(
    page.getByRole('status', { name: 'Saved entry receipt' }),
  ).toContainText('25,000');
  await expect(
    page.getByRole('button', { name: 'Check save status' }),
  ).toHaveCount(0);
});

test('a changed member invalidates an older import preview', async ({
  page,
  context,
}) => {
  await login(page, 'admin');
  const csv = (name: string) => ({
    name: 'change.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      `Account Number,Unique Number,Account Name\n000401001006,LCT006,${name}\n000401001008,LCT006,${name}\n`,
    ),
  });
  await page
    .locator('input[type=file]')
    .setInputFiles(csv('Outdated planned name'));
  await expect(
    page.getByRole('heading', { name: 'Review import' }),
  ).toBeVisible();
  const other = await context.newPage();
  await login(other, 'admin');
  await other
    .locator('input[type=file]')
    .setInputFiles(csv('Newer reviewed name'));
  await other.getByRole('button', { name: 'Apply updates' }).click();
  await expect(
    other.getByText('Member directory updated.', { exact: true }),
  ).toBeVisible();
  await other.close();
  await page.getByRole('button', { name: 'Apply updates' }).click();
  await expect(page.getByRole('alert')).toContainText('changed since preview');
  await page.getByLabel('Search directory', { exact: true }).fill('006');
  await expect(page.locator('.directory-list')).toContainText(
    'Newer reviewed name',
  );
});

test('long identities reflow and collection, review, history and office share the same visual system', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await login(page);
  await select(page, '007');
  await expect(page.locator('.entry-card .account')).toContainText(
    'deliberately long',
  );
  await noOverflow(page);
  await page.screenshot({
    path: join(evidence, 'after-long-account-mobile.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({
    path: join(evidence, 'after-agent-desktop.png'),
    fullPage: true,
  });
  await page.locator('#deposit').fill('20,000');
  await page.getByRole('button', { name: 'Review entry', exact: true }).click();
  await page.screenshot({
    path: join(evidence, 'after-review-desktop.png'),
    fullPage: false,
  });
  await page.getByRole('button', { name: 'Back / edit' }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page
    .getByRole('button', { name: 'Discard entry', exact: true })
    .click();
  await page.getByRole('link', { name: 'History', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Recent workdays' }),
  ).toBeVisible();
  await page.screenshot({
    path: join(evidence, 'after-history-desktop.png'),
    fullPage: true,
  });
});

test('compact collection fits a mobile viewport and keeps navigation mounted with automatic offline viewing', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 740 });
  await page.goto('/login/');
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await login(page);
  await select(page);
  await expect(page.getByText('Staging', { exact: true })).toHaveCount(0);
  const bottom = await page
    .getByRole('button', { name: 'Review entry', exact: true })
    .evaluate((el) => el.getBoundingClientRect().bottom);
  expect(bottom).toBeLessThanOrEqual(740);
  await expect(page.getByText('Cash breakdown', { exact: true })).toHaveCount(
    0,
  );
  await page.evaluate(() => {
    (window as Window & { mountedMarker?: boolean }).mountedMarker = true;
  });
  const names = await page
    .locator('nav[aria-label="Main navigation"] a')
    .allTextContents();
  expect(names.map((n) => n.trim())).toEqual(['Recent entries', 'History']);
  await page.getByRole('link', { name: 'Recent entries', exact: true }).click();
  expect(
    await page.evaluate(
      () => (window as Window & { mountedMarker?: boolean }).mountedMarker,
    ),
  ).toBe(true);
  await page.screenshot({
    path: join(evidence, 'compact-recent-mobile.png'),
    fullPage: false,
  });
  await page
    .getByRole('button', { name: 'Cash breakdown', exact: true })
    .click();
  await page.screenshot({
    path: join(evidence, 'compact-cash-dialog.png'),
    fullPage: false,
  });
  await expect(page.getByRole('dialog')).toContainText('Opening cash');
  await page.keyboard.press('Escape');
  await context.setOffline(true);
  await page.getByRole('link', { name: 'Back to collection' }).click();
  await expect(
    page.getByRole('heading', { name: 'Expected cash' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Recent entries', exact: true }).click();
  await expect(page.locator('.entry-row').first()).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole('heading', { name: 'Expected cash' }),
  ).toBeVisible();
  await context.setOffline(false);
  await noOverflow(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.page')).toHaveCSS('animation-name', 'none');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => {
    document.documentElement.style.zoom = '2';
  });
  await noOverflow(page);
});

test('directory paginates beyond fifty accounts and search resets its page', async ({
  page,
}) => {
  await login(page, 'admin');
  await expect(page.locator('.directory-list .member-result')).toHaveCount(50);
  await page.screenshot({
    path: join(evidence, 'compact-directory-mobile.png'),
    fullPage: false,
  });
  await expect(page.locator('.app-header input[type=file]')).toHaveCount(1);
  await page
    .getByRole('navigation', { name: 'Directory pages' })
    .getByRole('button', { name: 'Next', exact: true })
    .click();
  await expect(
    page.getByRole('navigation', { name: 'Directory pages' }),
  ).toContainText('51–100');
  await expect(
    page.getByRole('button', { name: 'Previous', exact: true }),
  ).toBeEnabled();
  await page.getByLabel('Search directory', { exact: true }).fill('006');
  await expect(
    page.getByRole('navigation', { name: 'Directory pages' }),
  ).toContainText('Page 1 of 1');
  await page.screenshot({
    path: join(evidence, 'compact-admin-mobile.png'),
    fullPage: false,
  });
  await noOverflow(page);
});

test('successful collection uses only an auto-closing toast', async ({
  page,
}) => {
  await login(page);
  await select(page);
  await page.locator('#deposit').fill('12001');
  await page.getByRole('button', { name: 'Review entry', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm & save' }).click();
  const toast = page.getByRole('status', { name: 'Saved entry receipt' });
  await expect(toast).toContainText('12,001');
  await expect(page.locator('.alert.success')).toHaveCount(0);
  await expect(toast).toHaveCount(0, { timeout: 9000 });
});

test('automatic record cache survives reload while the database is unavailable', async ({
  page,
}) => {
  await login(page);
  await page.getByRole('link', { name: 'Recent entries', exact: true }).click();
  await expect(page.locator('.entry-row').first()).toBeVisible();
  await page.route('http://127.0.0.1:8080/**', (route) => route.abort());
  await page.reload();
  await expect(page.locator('.loading-overlay')).toBeVisible();
  await expect(page.locator('.connection')).toHaveCount(0);
  await expect(page.locator('.loading-overlay')).toBeHidden({ timeout: 12000 });
  await expect(
    page.getByRole('heading', { name: 'Recent entries', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.entry-row').first()).toBeVisible();
  await expect(
    page.getByRole('status').filter({ hasText: 'data may be outdated' }),
  ).toBeVisible();
});

test('member search expands distinct accounts and ABC groups have a Group chip', async ({
  page,
}) => {
  await login(page);
  await page.getByLabel('Search members', { exact: true }).fill('LCT006');
  await expect(page.locator('.member-result')).toHaveCount(1);
  await expect(page.locator('.member-result .account-choice')).toHaveCount(2);
  await page
    .getByRole('button', {
      name: 'Select account 000401001008 for Newer reviewed name',
      exact: true,
    })
    .click();
  await expect(page.locator('.entry-card .account')).toContainText(
    '000401001008',
  );
  await expect(page.locator('.entry-card .account')).toContainText('LCT006');
  await page.locator('#deposit').fill('33008');
  await page.getByRole('button', { name: 'Review entry', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('000401001008');
  await expect(page.getByRole('dialog')).toContainText('LCT006');
  await page.getByRole('button', { name: 'Confirm & save' }).click();
  await expect(
    page.getByRole('status', { name: 'Saved entry receipt' }),
  ).toContainText('000401001008');
  await page.getByRole('link', { name: 'Recent entries', exact: true }).click();
  const saved = page
    .locator('.entry-row')
    .filter({ hasText: '33,008' })
    .first();
  await expect(saved).toContainText('000401001008');
  await page.getByRole('link', { name: 'Back to collection' }).click();
  await page.getByLabel('Search members', { exact: true }).fill('ABC2');
  await expect(page.locator('.find-card .group-chip')).toHaveText('Group');
  await expect(page.locator('.find-card .account-choice')).toHaveCount(2);
  const summary = page.locator('.find-card summary');
  await summary.focus();
  await summary.press('Space');
  await expect(page.locator('.find-card details')).toHaveJSProperty(
    'open',
    false,
  );
  await summary.press('Enter');
  await expect(page.locator('.find-card details')).toHaveJSProperty(
    'open',
    true,
  );
  await page.screenshot({
    path: join(evidence, 'group-member-accounts-mobile.png'),
    fullPage: false,
  });
});

test('viewer fetches cursor pages of 50 entries and keeps empty filtered pages navigable', async ({
  page,
}) => {
  // Admin SDK is deliberately restricted to local synthetic emulator fixtures.
  process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
  if (
    !/^(127\.0\.0\.1|localhost):[0-9]+$/.test(
      process.env.FIRESTORE_EMULATOR_HOST,
    )
  )
    throw new Error('Local emulator only');
  const { initializeApp, deleteApp } = await import('firebase-admin/app');
  const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
  const fixtureApp = initializeApp(
    { projectId: 'demo-lct-collect' },
    'viewer-pagination',
  );
  const database = getFirestore(fixtureApp);
  const sample = (
    await database.collection('entries').limit(1).get()
  ).docs[0].data();
  const refs = Array.from({ length: 55 }, (_, i) =>
    database.doc(`entries/pagination_fixture_${i}`),
  );
  try {
    const batch = database.batch();
    refs.forEach((ref, i) =>
      batch.set(ref, {
        ...sample,
        entryId: ref.id,
        workday: '2020-01-01',
        memberNameSnapshot: `Page fixture ${i}`,
        createdAt: Timestamp.fromMillis(1577836800000 + i * 1000),
        lines: {
          ...Object.fromEntries(
            ['deposit', 'withdrawal', 'loanInstalment'].map((type) => [
              type,
              { ...sample.lines.deposit, recorded: false, state: 'active' },
            ]),
          ),
        },
      }),
    );
    await batch.commit();
    await login(page, 'viewer');
    await page.getByLabel('Workday', { exact: true }).fill('2020-01-01');
    await expect(page.locator('.register .entry-row')).toHaveCount(50);
    await expect(page.locator('.register')).toContainText('Page fixture 54');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.locator('.register .entry-row')).toHaveCount(50);
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.locator('.register .entry-row')).toHaveCount(50);
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.locator('.register .entry-row')).toHaveCount(15);
    await expect(page.locator('.register')).toContainText('Page fixture 0');
    await expect(page.locator('.register')).not.toContainText(
      'Page fixture 54',
    );
    await expect(
      page.getByRole('button', { name: 'Next', exact: true }),
    ).toBeDisabled();
    await page
      .getByLabel('Search this page', { exact: true })
      .fill('no such fixture');
    await expect(
      page.getByText('No matching entries', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Previous', exact: true }),
    ).toBeEnabled();
    await page.getByLabel('Clear search this page').click();
    await page.getByRole('button', { name: 'Previous', exact: true }).click();
    await expect(page.locator('.register .entry-row')).toHaveCount(50);
    await page.getByRole('button', { name: 'Previous', exact: true }).click();
    await expect(page.locator('.register .entry-row')).toHaveCount(50);
    await page.getByRole('button', { name: 'Previous', exact: true }).click();
    await expect(page.locator('.register')).toContainText('Page fixture 54');
    await page.setViewportSize({ width: 320, height: 760 });
    await expect(
      page
        .locator('.register .entry-row')
        .first()
        .getByRole('button', { name: 'Mark recorded' }),
    ).toBeEnabled();
    await noOverflow(page);
    await page.screenshot({
      path: join(evidence, 'compact-viewer-pagination-mobile.png'),
      fullPage: false,
    });
    await page.getByLabel('Workday', { exact: true }).fill('2020-01-02');
    await expect(
      page.getByText('No matching entries', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Previous', exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole('button', { name: 'Next', exact: true }),
    ).toBeDisabled();
  } finally {
    const cleanup = database.batch();
    refs.forEach((ref) => cleanup.delete(ref));
    await cleanup.commit();
    await deleteApp(fixtureApp);
  }
});

test('exact full single-line pages stop at the end and follow live lookahead changes', async ({
  page,
}) => {
  process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
  if (
    !/^(127\.0\.0\.1|localhost):[0-9]+$/.test(
      process.env.FIRESTORE_EMULATOR_HOST,
    )
  )
    throw new Error('Local emulator only');
  const { initializeApp, deleteApp } = await import('firebase-admin/app');
  const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
  const fixtureApp = initializeApp(
    { projectId: 'demo-lct-collect' },
    'exact-page-boundary',
  );
  const database = getFirestore(fixtureApp);
  const sample = (
    await database.collection('entries').limit(1).get()
  ).docs[0].data();
  const refs = Array.from({ length: 100 }, (_, i) =>
    database.doc(`entries/exact_page_${i}`),
  );
  const makeEntry = (i: number) => ({
    ...sample,
    entryId: refs[i].id,
    workday: '2020-03-01',
    memberNameSnapshot: `Exact page ${i}`,
    createdAt: Timestamp.fromMillis(1583020800000 - i * 1000),
    lines: {
      deposit: { ...sample.lines.deposit, recorded: false, state: 'active' },
    },
  });
  try {
    const first = database.batch();
    refs.slice(0, 50).forEach((ref, i) => first.set(ref, makeEntry(i)));
    await first.commit();
    await login(page, 'viewer');
    await page.getByLabel('Workday', { exact: true }).fill('2020-03-01');
    const rows = page.locator('.register .entry-row');
    const next = page.getByRole('button', { name: 'Next', exact: true });
    const previous = page.getByRole('button', {
      name: 'Previous',
      exact: true,
    });
    await expect(rows).toHaveCount(50);
    await expect(
      rows.first().getByRole('button', { name: 'Mark recorded' }),
    ).toBeEnabled();
    await expect(next).toBeDisabled();
    // Adding/deleting an older entry leaves the first 50 documents unchanged.
    // Only the lookahead listener can update Next in these cases.
    await refs[50].set(makeEntry(50));
    await expect(next).toBeEnabled();
    await refs[50].delete();
    await expect(next).toBeDisabled();
    await refs[50].set(makeEntry(50));
    await expect(next).toBeEnabled();
    await next.click();
    await expect(rows).toHaveCount(1);
    await expect(page.locator('#entry-results')).toBeFocused();
    await expect(next).toBeDisabled();
    await previous.click();
    await expect(rows).toHaveCount(50);
    const rest = database.batch();
    refs
      .slice(51)
      .forEach((ref, offset) => rest.set(ref, makeEntry(offset + 51)));
    await rest.commit();
    await expect(next).toBeEnabled();
    await next.click();
    await expect(rows).toHaveCount(50);
    await expect(
      rows.first().getByRole('button', { name: 'Mark recorded' }),
    ).toBeEnabled();
    await expect(next).toBeDisabled();
    await expect(page.locator('.pagination')).toContainText('Page 2');
    await expect(
      page.getByText('No matching entries', { exact: true }),
    ).toHaveCount(0);
  } finally {
    await page.goto('/login/');
    const cleanup = database.batch();
    refs.forEach((ref) => cleanup.delete(ref));
    await cleanup.commit();
    await deleteApp(fixtureApp);
  }
});

test('agent shows five compact workdays and pages every line without losing split entries', async ({
  page,
}) => {
  process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
  if (
    !/^(127\.0\.0\.1|localhost):[0-9]+$/.test(
      process.env.FIRESTORE_EMULATOR_HOST,
    )
  )
    throw new Error('Local emulator only');
  const { initializeApp, deleteApp } = await import('firebase-admin/app');
  const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
  const fixtureApp = initializeApp(
    { projectId: 'demo-lct-collect' },
    'agent-history-pagination',
  );
  const database = getFirestore(fixtureApp);
  const sample = (
    await database.collection('entries').limit(1).get()
  ).docs[0].data();
  const templateSession = (
    await database.doc(`sessions/${sample.sessionId}`).get()
  ).data()!;
  const sessionRefs = Array.from({ length: 7 }, (_, i) =>
    database.doc(`sessions/agent_history_fixture_${i + 1}`),
  );
  const entryRefs = Array.from({ length: 55 }, (_, i) =>
    database.doc(`entries/agent_history_fixture_${i}`),
  );
  try {
    const batch = database.batch();
    sessionRefs.forEach((ref, i) =>
      batch.set(ref, {
        ...templateSession,
        sessionId: ref.id,
        agentId: 'demo-agent',
        workday: `2020-02-0${i + 1}`,
      }),
    );
    entryRefs.forEach((ref, i) =>
      batch.set(ref, {
        ...sample,
        entryId: ref.id,
        sessionId: sessionRefs[6].id,
        agentId: 'demo-agent',
        workday: '2020-02-07',
        memberNameSnapshot: `History fixture ${i}`,
        createdAt: Timestamp.fromMillis(1581033600000 + i * 1000),
        lines: Object.fromEntries(
          ['deposit', 'withdrawal', 'loanInstalment'].map((type) => [
            type,
            { ...sample.lines.deposit, state: 'active', recorded: false },
          ]),
        ),
      }),
    );
    await batch.commit();
    await login(page);
    const search = page.getByLabel('Search members', { exact: true });
    await search.fill('Example Member');
    await expect(page.locator('.find-card .member-result')).toHaveCount(50);
    const memberPages = page.getByRole('navigation', {
      name: 'Member search pages',
    });
    await memberPages
      .getByRole('button', { name: 'Next', exact: true })
      .click();
    await expect(memberPages).toContainText('51–100');
    await expect(page.locator('.find-card .member-result')).toHaveCount(50);
    await page.getByLabel('Clear search members').click();
    await page.getByRole('link', { name: 'History', exact: true }).click();
    await expect(page.locator('.session-card')).toHaveCount(5);
    await expect(page.locator('.session-list')).toContainText('7 Feb 2020');
    await expect(page.locator('.session-list')).not.toContainText('3 Feb 2020');
    await expect(
      page.getByRole('button', { name: 'Load older sessions' }),
    ).toHaveCount(0);
    await page.screenshot({
      path: join(evidence, 'compact-five-workdays-mobile.png'),
      fullPage: true,
    });
    await page
      .locator('.session-card')
      .filter({ hasText: '7 Feb 2020' })
      .click();
    await expect(page.locator('.entry-row')).toHaveCount(50);
    const backBox = await page
      .getByRole('link', { name: 'Back to collection', exact: true })
      .boundingBox();
    const allBox = await page
      .getByRole('button', { name: 'All sessions', exact: true })
      .boundingBox();
    expect(Math.abs(backBox!.y - allBox!.y)).toBeLessThan(4);
    expect(allBox!.x).toBeGreaterThan(backBox!.x);
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      await expect(page.locator('.entry-row')).toHaveCount(i === 3 ? 15 : 50);
      seen.push(
        ...(await page
          .locator('.entry-row')
          .evaluateAll((rows) =>
            rows.map(
              (row) =>
                `${row.querySelector('.entry-identity strong')!.textContent}:${row.querySelector('.entry-kind')!.textContent}`,
            ),
          )),
      );
      if (i < 3)
        await page
          .getByRole('navigation', { name: 'Workday entry pages' })
          .getByRole('button', { name: 'Next', exact: true })
          .click();
    }
    expect(seen).toHaveLength(165);
    expect(new Set(seen).size).toBe(165);
    await expect(
      page
        .getByRole('navigation', { name: 'Workday entry pages' })
        .getByRole('button', { name: 'Next', exact: true }),
    ).toBeDisabled();
    await page.locator('.entry-identity').first().click();
    await expect(page.getByRole('dialog')).toContainText('read-only');
    await expect(
      page.getByRole('button', { name: 'Void this line', exact: true }),
    ).toHaveCount(0);
    await page.getByRole('button', { name: 'Close dialog' }).click();
    await page.setViewportSize({ width: 320, height: 760 });
    await noOverflow(page);
    await page.screenshot({
      path: join(evidence, 'compact-workday-lines-mobile.png'),
      fullPage: false,
    });
    await page
      .getByRole('button', { name: 'All sessions', exact: true })
      .click();
    await expect(page.locator('.session-card')).toHaveCount(5);
  } finally {
    const cleanup = database.batch();
    [...sessionRefs, ...entryRefs].forEach((ref) => cleanup.delete(ref));
    await cleanup.commit();
    await deleteApp(fixtureApp);
  }
});

test('owner can page all import preview rows and all validation issues', async ({
  page,
}) => {
  await login(page, 'admin');
  const csv =
    'Account Number,Unique Number,Account Name\n' +
    Array.from(
      { length: 105 },
      (_, i) =>
        `990${String(i).padStart(4, '0')},LCT${99000 + i},Import preview fixture ${i}\n`,
    ).join('');
  await page.locator('input[type=file]').setInputFiles({
    name: 'paged-preview.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });
  await expect(page.locator('tbody tr')).toHaveCount(50);
  const preview = page.getByRole('navigation', {
    name: 'Import preview pages',
  });
  await preview.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(50);
  await preview.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(5);
  await expect(page.locator('tbody')).toContainText(
    'Import preview fixture 104',
  );
  await page.locator('input[type=file]').setInputFiles({
    name: 'paged-errors.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv.replaceAll(/LCT[0-9]+/g, 'INVALID')),
  });
  const issues = page.getByRole('navigation', { name: 'Import issue pages' });
  await expect(issues).toContainText('1–50');
  await expect(page.locator('.alert.error li')).toHaveCount(50);
  await issues.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(issues).toContainText('51–100');
  await issues.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.locator('.alert.error li')).toHaveCount(5);
  await expect(
    page.getByRole('button', { name: 'Apply updates', exact: true }),
  ).toBeDisabled();
});

test('sign-in gives field-linked recovery and preserves masked credentials', async ({
  page,
}) => {
  await page.goto('/login/');
  const username = page.getByPlaceholder('Your username');
  const password = page.getByPlaceholder('Your password');
  const submit = page.getByRole('button', { name: 'Sign in', exact: true });
  await expect(username).toBeVisible();
  await submit.click();
  await expect(username).toBeFocused();
  await expect(username).toHaveAttribute('aria-invalid', 'true');
  await expect(username).toHaveAttribute('aria-describedby', 'username-error');
  await expect(page.locator('#username-error')).toContainText(
    'assigned username',
  );
  await username.fill('demo.agent');
  await submit.click();
  await expect(password).toBeFocused();
  await expect(password).toHaveAttribute('aria-invalid', 'true');
  await expect(password).toHaveAttribute('aria-describedby', 'password-error');
  await password.fill('wrong-password');
  await expect(password).toHaveAttribute('type', 'password');
  await page
    .getByRole('button', { name: 'Show password', exact: true })
    .click();
  await expect(password).toHaveAttribute('type', 'text');
  await expect(
    page.getByRole('button', { name: 'Hide password' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Hide password' }).click();
  await submit.click();
  await expect(page.getByRole('alert')).toContainText('Sign-in failed');
  await expect(username).toHaveValue('demo.agent');
  await expect(password).toHaveValue('wrong-password');
  await password.fill('CollectDemo123!');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await submit.click();
  await page.waitForURL('**/agent/');
});

test('minimal directory shows one account directly and active navigation is announced', async ({
  page,
}) => {
  await login(page, 'admin');
  await page.getByLabel('Search directory', { exact: true }).fill('LCT003');
  const result = page.locator('.directory-list .member-result');
  await expect(result).toHaveCount(1);
  await expect(result).toContainText('000401001003');
  await expect(result.locator('summary')).toHaveCount(0);
  await noOverflow(page);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.waitForURL('**/login/');
  await login(page);
  await page.getByRole('link', { name: 'Recent entries', exact: true }).click();
  await expect(
    page.getByRole('link', { name: 'Recent entries', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await page.getByRole('link', { name: 'History', exact: true }).click();
  await expect(
    page.getByRole('link', { name: 'History', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
  await expect(
    page.getByRole('link', { name: 'Recent entries', exact: true }),
  ).not.toHaveAttribute('aria-current', 'page');
});

for (const width of [320, 1280]) {
  for (const role of ['agent', 'viewer', 'admin']) {
    test(`accessible ${role} screens and dialogs at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      async function audit(screen: string) {
        await noOverflow(page);
        const result = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze();
        expect(
          result.violations,
          `${screen} at ${width}px: ${JSON.stringify(result.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })))}`,
        ).toEqual([]);
      }
      await page.goto('/login/');
      await expect(page.getByPlaceholder('Your username')).toBeVisible();
      if (role === 'agent') await audit('Login');
      await login(page, role);
      if (role === 'agent') {
        await select(page);
        await audit('Collection');
        await page.locator('#deposit').fill('2000');
        await page
          .getByRole('button', { name: 'Review entry', exact: true })
          .click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await audit('Review dialog');
        await page
          .getByRole('button', { name: 'Back / edit', exact: true })
          .click();
        await page.locator('#deposit').fill('');
        await page
          .getByRole('link', { name: 'Recent entries', exact: true })
          .click();
        await expect(page.locator('.loading-overlay')).toHaveCount(0);
        await audit('Recent entries');
        await page.getByRole('link', { name: 'History', exact: true }).click();
        await expect(page.locator('.compact-session').first()).toBeVisible();
        await audit('Workdays');
      } else if (role === 'viewer') {
        await expect(
          page.locator('.register .entry-row').first(),
        ).toBeVisible();
        await audit('Viewer');
      } else {
        await expect(page.locator('.loading-overlay')).toHaveCount(0);
        await page
          .getByLabel('Search directory', { exact: true })
          .fill('LCT003');
        await expect(page.locator('.directory-single')).toBeVisible();
        await audit('Directory');
      }
    });
  }
}

test('owner initial connection uses overlay then a compact offline fallback', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await login(page, 'admin');
  await expect(
    page.getByRole('heading', { name: 'Member directory', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.loading-overlay')).toHaveCount(0);
  await expect(page.locator('.brand-link img')).toBeVisible();
  await expect(page.locator('.brand-link img')).toHaveJSProperty(
    'naturalWidth',
    64,
  );
  await page.screenshot({ path: join(evidence, 'branded-admin-mobile.png') });
  await page.route('http://127.0.0.1:8080/**', (route) => route.abort());
  await page.reload();
  await expect(page.locator('.loading-overlay')).toBeVisible();
  await expect(page.locator('#main-content')).toHaveAttribute('inert', '');
  await page.screenshot({ path: join(evidence, 'admin-loading-mobile.png') });
  await expect(page.locator('.connection')).toHaveCount(0);
  await expect(page.locator('.loading-overlay')).toBeHidden({ timeout: 12000 });
  await expect(page.locator('.connection.compact-connection')).toContainText(
    'data may be outdated',
  );
  await expect(page.getByLabel('Choose CSV', { exact: true })).toBeDisabled();
  await page.screenshot({ path: join(evidence, 'admin-offline-mobile.png') });
  await expect(
    page.locator('.directory-list .member-result').first(),
  ).toBeVisible();
  await noOverflow(page);
});
