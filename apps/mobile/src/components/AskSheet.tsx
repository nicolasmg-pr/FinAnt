import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { formatMoney } from '@finant/core';
import type { AskIssue } from '@finant/assistant';
import { radius, spacing, type, useTheme } from '../design';
import type { AskTurn, UseAsk } from '../assistant/use-ask';
import { Amount } from './Amount';
import { Button } from './ui/Button';
import { Field } from './ui/Field';
import { Sheet } from './ui/Sheet';

/** How many movements the answer shows before it stops and offers the list. */
const PREVIEW_ROWS = 6;

/**
 * One issue as a line the owner can act on.
 *
 * Issues are rendered, never swallowed. A constraint the model dropped without
 * saying so would leave a total that looks authoritative and answers a
 * different question than the one that was asked.
 */
function IssueLine({ issue }: { issue: AskIssue }) {
  const theme = useTheme();
  const { t } = useTranslation();

  const text = ((): string | null => {
    switch (issue.kind) {
      case 'unknown-category':
        return t('assistant.unknownCategory', { id: issue.id });
      case 'unknown-account':
        return t('assistant.unknownAccount', { id: issue.id });
      case 'bad-date':
        return t('assistant.badDate', { value: issue.value });
      case 'bad-amount':
        return t('assistant.badAmount', { value: issue.value });
      case 'excluded-from-total':
        return t('assistant.excludedFromTotal', { count: issue.count });
      // A dropped key and a malformed reply are already reported by the turn
      // itself; repeating them as a footnote would say the same thing twice.
      case 'bad-field':
      case 'malformed-output':
        return null;
    }
  })();

  if (text === null) return null;
  return <Text style={[type.caption, { color: theme.textMuted }]}>{text}</Text>;
}

function TurnView({
  turn,
  locale,
  onOpenInMovements,
}: {
  turn: AskTurn;
  locale: string;
  onOpenInMovements: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();

  return (
    <View style={styles.turn}>
      <View style={[styles.question, { backgroundColor: theme.accentSoft }]}>
        <Text style={[type.body, { color: theme.text }]}>{turn.question}</Text>
      </View>

      {turn.result === null && turn.understood ? (
        <Text style={[type.caption, { color: theme.textMuted }]}>{t('assistant.thinking')}</Text>
      ) : null}

      {!turn.understood ? (
        <View style={styles.answer}>
          <Text style={[type.body, { color: theme.text }]}>{t('assistant.notUnderstood')}</Text>
          <Button
            label={t('assistant.openFilters')}
            variant="secondary"
            onPress={onOpenInMovements}
          />
        </View>
      ) : null}

      {turn.result !== null ? (
        <View style={styles.answer}>
          {turn.result.count === 0 ? (
            <Text style={[type.body, { color: theme.text }]}>{t('assistant.noResults')}</Text>
          ) : (
            <>
              {/* The figure comes from packages/core. The model chose the
                  filter; it never wrote this number. */}
              <Text style={[type.title, { color: theme.text }]}>
                {turn.result.state.aggregate === 'count'
                  ? t('assistant.answerCount', { count: turn.result.count })
                  : t('assistant.answerSum', {
                      amount: formatMoney(turn.result.total, locale),
                      count: turn.result.count,
                    })}
              </Text>

              {turn.result.state.aggregate === 'average' && turn.result.average !== null ? (
                <Text style={[type.body, { color: theme.textMuted }]}>
                  {t('assistant.answerAverage', {
                    amount: formatMoney(turn.result.average, locale),
                  })}
                </Text>
              ) : null}

              {turn.result.matches.slice(0, PREVIEW_ROWS).map((tx) => (
                <View key={tx.id} style={styles.row}>
                  <Text
                    numberOfLines={1}
                    style={[type.body, styles.rowText, { color: theme.text }]}
                  >
                    {tx.description}
                  </Text>
                  <Amount value={tx.amount} tone={tx.side} />
                </View>
              ))}

              <Button
                label={t('assistant.openInMovements')}
                variant="secondary"
                onPress={onOpenInMovements}
              />
            </>
          )}
        </View>
      ) : null}

      {turn.issues.map((issue, index) => (
        <IssueLine key={`${issue.kind}-${index}`} issue={issue} />
      ))}
    </View>
  );
}

/**
 * The conversation.
 *
 * Every answer is a filter plus a figure computed by `@finant/core`, and the
 * "open in movements" button hands that same filter to the list — so what the
 * sheet says and what the list shows can never be two different questions.
 */
export function AskSheet({
  visible,
  onDismiss,
  ask,
  locale,
}: {
  visible: boolean;
  onDismiss: () => void;
  ask: UseAsk;
  locale: string;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const [draft, setDraft] = useState('');

  const openInMovements = () => {
    onDismiss();
    router.push('/(tabs)/transactions');
  };

  const busy = ask.status === 'thinking' || ask.status === 'loading-model';

  return (
    <Sheet visible={visible} onDismiss={onDismiss} title={t('assistant.title')}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollBody}>
        {ask.turns.length === 0 ? (
          <Text style={[type.body, { color: theme.textMuted }]}>{t('assistant.emptyPrompt')}</Text>
        ) : null}

        {ask.turns.map((turn) => (
          <TurnView key={turn.id} turn={turn} locale={locale} onOpenInMovements={openInMovements} />
        ))}

        {ask.status === 'loading-model' ? (
          <View style={styles.busy}>
            <ActivityIndicator color={theme.accent} />
            <Text style={[type.caption, { color: theme.textMuted }]}>
              {t('assistant.loadingModel')}
            </Text>
          </View>
        ) : null}

        {ask.status === 'out-of-memory' ? (
          <Text style={[type.body, { color: theme.expense }]}>{t('assistant.outOfMemory')}</Text>
        ) : null}
      </ScrollView>

      <Field
        label={t('assistant.title')}
        value={draft}
        onChangeText={setDraft}
        placeholder={t('assistant.placeholder')}
      />

      <View style={styles.actions}>
        {busy ? (
          <Button label={t('common.cancel')} variant="secondary" onPress={() => void ask.stop()} />
        ) : null}
        <Button
          label={t('assistant.title')}
          onPress={() => {
            const question = draft;
            setDraft('');
            void ask.send(question);
          }}
        />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  scroll: { maxHeight: 420 },
  scrollBody: { gap: spacing.md, paddingBottom: spacing.md },
  turn: { gap: spacing.sm },
  question: {
    alignSelf: 'flex-end',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
  },
  answer: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowText: { flex: 1 },
  busy: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
});
