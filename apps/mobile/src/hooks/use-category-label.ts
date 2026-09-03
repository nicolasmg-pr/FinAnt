import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useCategories } from './use-categories';

/**
 * Resolves a category id to its translated label. A category the owner created
 * has no label key — its name *is* the label, in every language — so the
 * fallback chain is label key, then stored name, then the id itself. A null
 * category reads as "Uncategorised".
 */
export function useCategoryLabel(): (categoryId: string | null) => string {
  const { t } = useTranslation();
  const { byId } = useCategories();
  return useCallback(
    (categoryId: string | null): string => {
      if (!categoryId) return t('category.uncategorised');
      const category = byId.get(categoryId);
      return category?.labelKey ? t(category.labelKey) : (category?.name ?? categoryId);
    },
    [t, byId],
  );
}
