import { zh } from './languages/zh';
import { en } from './languages/en';
import { tw } from './languages/tw';

export const translations = {
  zh,
  en,
  tw,
};

export type Language = keyof typeof translations;
export type TranslationKey = typeof translations.zh;
