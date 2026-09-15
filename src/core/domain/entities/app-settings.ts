export interface AppSettings {
  theme: 'light' | 'dark' | 'system';
  locale: 'en' | 'ar';
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  locale: 'en',
};
