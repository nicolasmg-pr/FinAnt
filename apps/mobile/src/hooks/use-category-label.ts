import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { CATEGORY_BY_ID } from '@finant/core';

/**
 * Resolves a category id to its translated label. Falls back to the English
 * name for a category without a label key, then to the id itself. A null
 * category reads as "Uncategorised".
 */
export function useCategoryLabel(): (categoryId: string | null) => string {
  const { t } = useTranslation();
  return useCallback(
    (categoryId: string | null): string => {
      if (!categoryId) return t('category.uncategorised');
      const category = CATEGORY_BY_ID.get(categoryId);
      return category?.labelKey ? t(category.labelKey) : (category?.name ?? categoryId);
    },
    [t],
  );
}
