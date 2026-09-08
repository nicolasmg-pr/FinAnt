import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { INTL_LOCALE, isLocale } from '@finant/i18n';
import { useAssistantEnabled } from '../assistant/enabled-store';
import { useAsk } from '../assistant/use-ask';
import { useAppData } from '../hooks/use-app-data';
import { useCategories } from '../hooks/use-categories';
import { useCategoryLabel } from '../hooks/use-category-label';
import { SETTING_CURRENCY, readSetting } from '../db/settings-repo';
import { AskBubble } from './AskBubble';
import { AskSheet } from './AskSheet';

/**
 * The bubble, the sheet, and the data they need.
 *
 * Lives above the tab navigator so the bubble survives a tab change instead of
 * remounting mid-drag. It renders nothing at all until a model is installed and
 * the owner has switched it on: a bubble that opens a sheet saying "no model"
 * is a permanent piece of furniture advertising a feature that does not work.
 */
export function AskOverlay() {
  const { i18n } = useTranslation();
  const { transactions, accounts } = useAppData();
  const { list: categories } = useCategories();
  const labelFor = useCategoryLabel();

  // Subscribed, not read once: this component mounts with the tab navigator at
  // launch, and the switch that turns it on is flipped long afterwards.
  const enabled = useAssistantEnabled();
  const [currency, setCurrency] = useState('EUR');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    void readSetting(SETTING_CURRENCY).then((stored) => {
      if (alive && stored) setCurrency(stored);
    });
    return () => {
      alive = false;
    };
  }, []);

  const locale = isLocale(i18n.language) ? INTL_LOCALE[i18n.language] : INTL_LOCALE.en;

  const ask = useAsk({
    open,
    transactions,
    categories,
    accounts,
    currency,
    locale,
    labelFor,
  });

  if (!enabled) return null;

  return (
    <>
      <AskBubble onPress={() => setOpen(true)} />
      <AskSheet visible={open} onDismiss={() => setOpen(false)} ask={ask} locale={locale} />
    </>
  );
}
