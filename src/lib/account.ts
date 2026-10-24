import type { Member } from './models';
export const isDirectoryNumber = (value: string) =>
  value.length <= 40 && /^(?:LCT|ABC ?)[0-9]+$/.test(value);
export const accountSearchKey = (value: string) =>
  value.replace(/\s/g, '').toLowerCase();
export function matchesAccount(
  name: string,
  number: string,
  query: string,
  uniqueNumber = '',
) {
  const term = query.trim().toLowerCase();
  return (
    !term ||
    name.toLowerCase().includes(term) ||
    accountSearchKey(number).includes(accountSearchKey(term)) ||
    (!!uniqueNumber &&
      accountSearchKey(uniqueNumber).includes(accountSearchKey(term)))
  );
}
export interface MemberGroup {
  key: string;
  fullName: string;
  uniqueNumber?: string;
  group: boolean;
  accounts: Member[];
}
export function groupAccounts(
  accounts: Member[],
  query = '',
  activeOnly = false,
): MemberGroup[] {
  const groups = new Map<string, MemberGroup>();
  for (const account of accounts) {
    if (activeOnly && !account.active) continue;
    const key = account.uniqueNumber ?? `legacy:${account.memberId}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        fullName: account.fullName,
        uniqueNumber: account.uniqueNumber,
        group: !!account.uniqueNumber?.startsWith('ABC'),
        accounts: [],
      };
      groups.set(key, group);
    }
    group.accounts.push(account);
  }
  const term = query.trim().toLowerCase(),
    key = accountSearchKey(term);
  const rank = (g: MemberGroup) =>
    !term
      ? 0
      : accountSearchKey(g.uniqueNumber ?? '') === key ||
          g.accounts.some((a) => accountSearchKey(a.accountNumber) === key)
        ? 0
        : g.fullName.toLowerCase().startsWith(term)
          ? 1
          : 2;
  return [...groups.values()]
    .filter((g) =>
      g.accounts.some((a) =>
        matchesAccount(a.fullName, a.accountNumber, query, a.uniqueNumber),
      ),
    )
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        a.fullName.localeCompare(b.fullName) ||
        a.key.localeCompare(b.key),
    )
    .map((g) => ({
      ...g,
      accounts: g.accounts.sort((a, b) =>
        a.accountNumber.localeCompare(b.accountNumber),
      ),
    }));
}
