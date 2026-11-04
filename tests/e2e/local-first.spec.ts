import { test, expect } from '@playwright/test';
async function login(page: import('@playwright/test').Page) {
  await page.goto('/login/');
  await page.getByPlaceholder('Your username').fill('demo.agent');
  await page.getByPlaceholder('Your password').fill('CollectDemo123!');
  const transitions: string[] = [];
  await page.evaluate(() => {
    (window as any).__transitions = [];
    new MutationObserver(() => {
      const text = document.body.innerText;
      if (text.includes('Loading your access'))
        (window as any).__transitions.push(text);
    }).observe(document.body, { childList: true, subtree: true });
  });
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL('**/agent/');
  await expect(page.locator('.loading-overlay')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__transitions)).toEqual(
    transitions,
  );
  await page.getByLabel('Search members', { exact: true }).fill('LCT003');
  await page.locator('.single-account').first().click();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
}
test('offline collection is durable across reload and syncs exactly once without transitional pages', async ({
  page,
  context,
}) => {
  await login(page);
  // Wait for background preparation, including the current entries scope.
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const r = indexedDB.open('lct-local-first-v1');
        const db = await new Promise<IDBDatabase>(
          (resolve) => (r.onsuccess = () => resolve(r.result)),
        );
        const q = db
          .transaction('users')
          .objectStore('users')
          .get('demo-lct-collect/demo-agent');
        return await new Promise<boolean>(
          (resolve) =>
            (q.onsuccess = () =>
              resolve(
                Object.keys(q.result?.scopes ?? {}).some((k) =>
                  k.startsWith('entries:'),
                ),
              )),
        );
      }),
    )
    .toBe(true);
  await context.setOffline(true);
  await page.locator('#deposit').fill('17321');
  await page.getByRole('button', { name: 'Review entry', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm & save' }).click();
  await expect(
    page.getByRole('status', { name: 'Saved entry receipt' }),
  ).toContainText('Saved on this device');
  await expect(page.getByLabel('Unsynced work')).toContainText(
    '1 unsynced changes',
  );
  await page.reload();
  await expect(
    page.getByLabel('Search members', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('.loading-overlay')).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Access unavailable' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'More actions', exact: true }).click();
  await page
    .getByRole('menuitem', { name: 'Recent entries', exact: true })
    .click();
  const row = page.locator('.entry-row').filter({ hasText: '17,321' });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Pending sync');
  await context.setOffline(false);
  await expect(page.getByLabel('Unsynced work')).toHaveCount(0, {
    timeout: 30000,
  });
  await expect(row).toHaveCount(1);
  await expect(row).not.toContainText('Pending sync');
  await expect(row).not.toContainText('Synced');
  await page.reload();
  await expect(row).toHaveCount(1);
});
test('offline notes create, edit, complete and delete locally before reconnect', async ({
  page,
  context,
}) => {
  await login(page);
  await page.getByRole('link', { name: 'Notes', exact: true }).click();
  await page.getByRole('button', { name: 'All notes', exact: true }).click();
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  await context.setOffline(true);
  await page
    .getByRole('textbox', { name: 'New note', exact: true })
    .fill('Offline queue note');
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  const note = page
    .locator('.note-list-row')
    .filter({ hasText: 'Offline queue note' });
  await expect(note).toContainText('Pending sync');
  await note.getByRole('button', { name: /^Offline queue note/ }).click();
  await page
    .getByLabel('Note text', { exact: true })
    .fill('Offline queue note edited');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await note.getByRole('checkbox').click();
  await expect(note.getByRole('checkbox')).toBeChecked();
  await context.setOffline(false);
  await expect(page.getByLabel('Unsynced work')).toHaveCount(0, {
    timeout: 30000,
  });
  await expect(note).toContainText('Offline queue note edited');
  await expect(note.getByRole('checkbox')).toBeChecked();
  await context.setOffline(true);
  await note.locator('.note-row').click();
  const sheet = page.getByRole('dialog', { name: 'Edit note', exact: true });
  await sheet.getByLabel('Note actions', { exact: true }).click();
  await sheet.getByRole('button', { name: 'Delete note', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Delete note?', exact: true })
    .getByRole('button', { name: 'Delete note', exact: true })
    .click();
  await expect(note).toHaveCount(0);
  await expect(page.getByLabel('Unsynced work')).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByLabel('Unsynced work')).toHaveCount(0, {
    timeout: 30000,
  });
});

test('agents can start sessions and collect over multiple offline workdays', async ({
  page,
  context,
}) => {
  await login(page);
  await context.setOffline(true);
  await page.clock.install();
  const base = Date.now() - 30 * 86400000;
  for (const [offset, opening, deposit] of [
    [0, 100, 11],
    [1, 200, 22],
  ]) {
    await page.clock.setSystemTime(new Date(base + offset * 86400000));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(
      page.getByRole('heading', { name: "Start today's session" }),
    ).toBeVisible();
    await page
      .getByRole('textbox', { name: 'Opening cash (UGX)' })
      .fill(String(opening));
    await page
      .getByRole('button', { name: 'Start session', exact: true })
      .click();
    await page.getByLabel('Search members', { exact: true }).fill('LCT003');
    await page.locator('.single-account').first().click();
    await page.locator('#deposit').fill(String(deposit));
    await page
      .getByRole('button', { name: 'Review entry', exact: true })
      .click();
    await page.getByRole('button', { name: 'Confirm & save' }).click();
    await expect(
      page.getByRole('status', { name: 'Saved entry receipt' }),
    ).toContainText('Saved on this device');
  }
  await expect(page.getByLabel('Unsynced work')).toContainText(
    '4 unsynced changes',
  );
  await context.setOffline(false);
  await expect(page.getByLabel('Unsynced work')).toHaveCount(0, {
    timeout: 30000,
  });
});
