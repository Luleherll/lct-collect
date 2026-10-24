import { test, expect, type Page } from '@playwright/test';
import { join } from 'node:path';
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
  await page.locator('.account-choice').first().click();
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
    .locator('.account-choice')
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
    .locator('.account-choice')
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
  const row = page
    .locator('.entry-row')
    .filter({ hasText: 'Loan instalment' })
    .first();
  await row.getByRole('button', { name: 'Mark recorded' }).click();
  await expect(
    page.getByRole('button', { name: 'Undo recording check', exact: true }),
  ).toBeVisible();
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
    page.getByRole('status').filter({ hasText: 'Offline' }),
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
    page.getByRole('heading', { name: 'Session history' }),
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
  await page.getByRole('button', { name: 'Next', exact: true }).click();
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
  await expect(
    page.getByRole('heading', { name: 'Recent entries', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.entry-row').first()).toBeVisible();
  await expect(
    page.getByRole('status').filter({ hasText: 'saved records' }),
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
