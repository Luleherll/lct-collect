import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { join } from 'node:path';
import { workday } from '../../src/lib/domain';
const evidence = process.env.LCT_UI_EVIDENCE_DIR ?? 'test-results/visual';
async function fixture() {
  if (
    !/^(127\.0\.0\.1|localhost):[0-9]+$/.test(
      process.env.FIRESTORE_EMULATOR_HOST ?? '',
    )
  )
    throw new Error('Local emulator only');
  const { initializeApp, deleteApp } = await import('firebase-admin/app');
  const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
  const app = initializeApp({ projectId: 'demo-lct-collect' }, 'notes-design');
  const db = getFirestore(app),
    collection = db.collection('users/demo-agent/notes');
  // Kampala midnight is independent of the host time zone.
  const midnight = Date.parse(`${workday()}T00:00:00+03:00`);
  const notes = [
    {
      noteId: 'design_am',
      body: 'Check Amina’s passbook',
      tags: [
        { memberId: '002', uniqueNumber: 'LCT002', fullName: 'Amina Namusoke' },
      ],
      reminder: { kind: 'once', at: midnight + 9 * 3600000 },
    },
    {
      noteId: 'design_pm',
      body: 'Collect the missing documents',
      tags: [
        { memberId: '003', uniqueNumber: 'LCT014', fullName: 'Musa Kato' },
      ],
      reminder: { kind: 'once', at: midnight + 14 * 3600000 },
    },
    {
      noteId: 'design_tomorrow',
      body: 'Call the group treasurer',
      tags: [{ memberId: '009', uniqueNumber: 'ABC 2', fullName: 'ABC 2' }],
      reminder: { kind: 'once', at: midnight + 34 * 3600000 },
    },
    {
      noteId: 'design_weekly',
      body: 'Confirm the market collection',
      tags: [],
      reminder: { kind: 'weekly', day: 5, minute: 540 },
      occurrenceAt: midnight + 2 * 86400000 + 9 * 3600000,
    },
    {
      noteId: 'design_plain',
      body: 'Take extra receipt books',
      tags: [],
      reminder: { kind: 'none' },
    },
    {
      noteId: 'design_done',
      body: 'Completed visit',
      tags: [],
      reminder: { kind: 'none' },
      done: true,
    },
  ];
  const batch = db.batch();
  batch.update(db.doc('members/002'), { fullName: 'Amina Namusoke' });
  for (const doc of (await collection.get()).docs) batch.delete(doc.ref);
  for (const [i, note] of notes.entries())
    batch.set(collection.doc(note.noteId), {
      done: false,
      revision: 1,
      ...note,
      createdAt: Timestamp.fromMillis(Date.now() - i * 1000),
    });
  await batch.commit();
  await deleteApp(app);
}
async function open(page: import('@playwright/test').Page) {
  await page.goto('/login/');
  await page.getByPlaceholder('Your username').fill('demo.agent');
  await page.getByPlaceholder('Your password').fill('CollectDemo123!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL('**/agent/');
  await page.getByRole('link', { name: 'Notes', exact: true }).click();
}
test('notes agenda groups due dates and keeps unscheduled and completed notes discoverable', async ({
  page,
}) => {
  await fixture();
  await open(page);
  await expect(
    page.getByRole('heading', { name: 'Today', exact: true }),
  ).toBeVisible();
  await expect(page.locator('.agenda-row')).toHaveCount(4);
  await expect(page.locator('.agenda-row').first()).toContainText(
    'Check Amina',
  );
  await expect(page.locator('.agenda-row').nth(1)).toContainText(
    'Collect the missing',
  );
  await expect(page.getByText('Completed visit', { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByText('Take extra receipt books', { exact: true }),
  ).toBeHidden();
  await page.screenshot({ path: join(evidence, 'notes-agenda-approved.png') });
  await page.getByText('Without a reminder', { exact: false }).click();
  await expect(
    page.getByText('Take extra receipt books', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'All notes', exact: true }).click();
  await expect(
    page.getByText('Completed visit', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Notification settings', exact: true })
    .click();
  await expect(
    page
      .getByRole('dialog', { name: 'Notification settings' })
      .getByRole('button', { name: 'Enable reminders' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Upcoming', exact: true }).click();
});
test('note sheet recovers drafts, expands settings, traps focus and keeps actions in short viewports', async ({
  page,
  context,
}) => {
  await fixture();
  await open(page);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  let sheet = page.getByRole('dialog', { name: 'New note', exact: true });
  await sheet
    .getByRole('textbox', { name: 'New note', exact: true })
    .fill('Ask Amina to bring her passbook on the next visit.');
  await sheet.getByRole('button', { name: 'Members', exact: true }).click();
  await sheet.getByLabel('Tag members by name or number').fill('LCT002');
  await sheet.locator('.tag-result').first().click();
  await sheet.getByRole('button', { name: 'Members', exact: true }).click();
  await page.screenshot({ path: join(evidence, 'notes-sheet-approved.png') });
  await sheet.getByRole('button', { name: 'Reminder', exact: true }).click();
  await sheet.getByRole('button', { name: 'Weekly', exact: true }).click();
  await sheet.getByLabel('Weekday', { exact: true }).selectOption('5');
  await sheet.getByLabel('Time (EAT)', { exact: true }).fill('09:00');
  await sheet.getByRole('heading').focus();
  await sheet.locator('.sheet-body').evaluate((body) => {
    body.scrollTop = 0;
  });
  await page.screenshot({
    path: join(evidence, 'notes-sheet-weekly-approved.png'),
  });
  const audit = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(audit.violations).toEqual([]);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const req = indexedDB.open('lct-local-first-v1');
        const db = await new Promise<IDBDatabase>(
          (resolve) => (req.onsuccess = () => resolve(req.result)),
        );
        const read = db
          .transaction('users')
          .objectStore('users')
          .get('demo-lct-collect/demo-agent');
        return new Promise<boolean>(
          (resolve) =>
            (read.onsuccess = () => {
              const s = read.result;
              db.close();
              resolve(
                s?.drafts?.noteComposer?.reminder?.kind === 'weekly' &&
                  !!s?.drafts?.collection?.noteDraft,
              );
            }),
        );
      }),
    )
    .toBe(true);
  // Actual reload uses the browser's beforeunload mechanism; accept it here.
  page.once('dialog', (d) => d.accept());
  await page.reload();
  sheet = page.getByRole('dialog', { name: 'New note', exact: true });
  await expect(
    sheet.getByRole('textbox', { name: 'New note', exact: true }),
  ).toHaveValue('Ask Amina to bring her passbook on the next visit.');
  await expect(
    sheet.getByRole('button', { name: 'Members', exact: true }),
  ).toContainText('LCT002');
  await sheet.getByRole('button', { name: 'Reminder', exact: true }).click();
  await expect(
    sheet.getByRole('button', { name: 'Weekly', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await sheet.getByLabel('Weekday', { exact: true }).focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape'); // native select owns this Escape on platforms that open it
  if (await page.getByRole('dialog', { name: 'Discard this note?' }).count())
    await page
      .getByRole('button', { name: 'Keep writing', exact: true })
      .click();
  await page.setViewportSize({ width: 320, height: 400 });
  await sheet
    .getByRole('textbox', { name: 'New note', exact: true })
    .fill('Long note '.repeat(200));
  const save = sheet.getByRole('button', { name: 'Save note', exact: true });
  const box = await save.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(400);
  await save.focus();
  await page.keyboard.press('Tab');
  expect(await sheet.evaluate((d) => d.contains(document.activeElement))).toBe(
    true,
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: join(evidence, 'notes-sheet-short.png') });
  await context.setOffline(true);
  await save.click();
  await expect(sheet).toHaveCount(0);
  await page.getByRole('button', { name: 'All notes', exact: true }).click();
  await expect(
    page.locator('.note-list-row').filter({ hasText: 'Long note' }),
  ).toContainText('Pending sync');
  await context.setOffline(false);
  await expect(page.getByLabel('Unsynced work')).toHaveCount(0, {
    timeout: 30000,
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  await page.screenshot({ path: join(evidence, 'notes-sheet-desktop.png') });
  await sheet
    .getByRole('textbox', { name: 'New note', exact: true })
    .fill('A text-only draft');
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const request = indexedDB.open('lct-local-first-v1');
        const db = await new Promise<IDBDatabase>(
          (resolve) => (request.onsuccess = () => resolve(request.result)),
        );
        const read = db
          .transaction('users')
          .objectStore('users')
          .get('demo-lct-collect/demo-agent');
        return new Promise<boolean>(
          (resolve) =>
            (read.onsuccess = () => {
              db.close();
              resolve(
                read.result?.drafts?.collection?.noteDraft ===
                  'A text-only draft',
              );
            }),
        );
      }),
    )
    .toBe(true);
  page.once('dialog', (d) => d.accept());
  await page.reload();
  sheet = page.getByRole('dialog', { name: 'New note', exact: true });
  await expect(
    sheet.getByRole('textbox', { name: 'New note', exact: true }),
  ).toHaveValue('A text-only draft');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Discard note', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'All notes', exact: true }).click();
  await page.locator('.note-row').filter({ hasText: 'Check Amina' }).click();
  await page
    .getByRole('textbox', { name: 'Note text', exact: true })
    .fill('Unfinished edit of another note');
  await page.waitForTimeout(200);
  page.once('dialog', (d) => d.accept());
  await page.goto('/agent/notes/?note=design_pm');
  await expect(
    page.getByRole('textbox', { name: 'Note text', exact: true }),
  ).toHaveValue('Collect the missing documents');
  expect(errors).toEqual([]);
});

test('note member results follow the available space and remain usable above the keyboard', async ({
  page,
}) => {
  await fixture();
  await open(page);
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'New note', exact: true });
  const box = await sheet.boundingBox();
  expect(box!.height).toBeCloseTo(844 * 0.9, 0);
  await sheet
    .getByRole('textbox', { name: 'New note', exact: true })
    .fill('Prepare for the next collection.');
  await sheet.getByRole('button', { name: 'Members', exact: true }).click();
  const search = sheet.getByRole('textbox', {
    name: 'Tag members by name or number',
    exact: true,
  });
  await search.fill('LCT');
  const results = sheet.getByRole('region', {
    name: 'Matching members',
    exact: true,
  });
  await expect(results).toHaveAttribute('data-side', 'below');
  const anchor = search.locator('..');
  const down = await results.boundingBox(),
    field = await anchor.boundingBox();
  expect(down!.y).toBeGreaterThanOrEqual(field!.y + field!.height);
  expect(down!.y + down!.height).toBeLessThanOrEqual(
    (await sheet.locator('.sheet-footer').boundingBox())!.y,
  );
  // Paging a member search inside a note form must never submit the note.
  await results.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(sheet).toBeVisible();
  await expect(results).toContainText('Page 2');
  await search.fill('LCT002');
  await page.screenshot({ path: join(evidence, 'notes-members-below.png') });
  // Model a mobile keyboard reducing only the visual viewport, not the layout viewport.
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport!, 'height', {
      configurable: true,
      value: 450,
    });
    window.visualViewport!.dispatchEvent(new Event('resize'));
  });
  await expect(results).toHaveAttribute('data-side', 'above');
  await expect
    .poll(async () => {
      const panel = await results.boundingBox(),
        input = await anchor.boundingBox(),
        header = await sheet.locator('.dialog-head').boundingBox();
      return (
        panel!.y >= header!.y + header!.height &&
        panel!.y + panel!.height <= input!.y
      );
    })
    .toBe(true);
  await page.screenshot({
    path: join(evidence, 'notes-members-above-keyboard.png'),
  });
  await search.press('ArrowDown');
  await expect(results.locator('.tag-result').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(results).toHaveCount(0);
  await expect(search).toBeFocused();
  await expect(sheet).toBeVisible();
  await search.fill('LCT003');
  await search.press('Enter');
  await expect(results).toHaveCount(0);
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.note-tags')).toContainText('LCT003');
  await search.fill('no-match-for-this-member');
  await expect(results).toContainText('No members found');
  await search.press('Escape');
  await search.fill('LCT004');
  await sheet.getByRole('button', { name: 'Reminder', exact: true }).click();
  await expect(results).toHaveCount(0);
  await page.evaluate(() => {
    delete (window.visualViewport as unknown as Record<string, unknown>).height;
    window.visualViewport!.dispatchEvent(new Event('resize'));
  });
  await search.fill('LCT005');
  await page.setViewportSize({ width: 320, height: 500 });
  await expect(results).toHaveAttribute('data-side', 'above');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const audit = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(audit.violations).toEqual([]);
});
