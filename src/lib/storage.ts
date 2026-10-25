type Area = 'local' | 'session';
export const storage = {
  get(area: Area, key: string): string | null {
    try {
      return window[
        area === 'local' ? 'localStorage' : 'sessionStorage'
      ].getItem(key);
    } catch {
      return null;
    }
  },
  set(area: Area, key: string, value: string): boolean {
    try {
      window[area === 'local' ? 'localStorage' : 'sessionStorage'].setItem(
        key,
        value,
      );
      return true;
    } catch {
      return false;
    }
  },
  remove(area: Area, key: string): boolean {
    try {
      window[area === 'local' ? 'localStorage' : 'sessionStorage'].removeItem(
        key,
      );
      return true;
    } catch {
      return false;
    }
  },
};
