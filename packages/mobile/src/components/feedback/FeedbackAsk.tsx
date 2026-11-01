import { useCallback, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useFocusEffect } from 'expo-router';
import type { FeedbackAnswer, FeedbackAsk as Ask, FeedbackRequest } from '@pidro/shared';
import { feedbackApi } from '@/api/feedback';
import { DismissButton } from '@/components/ui/DismissButton';
import { PidroText } from '@/components/ui/PidroText';
import { PressableFX } from '@/components/ui/PressableFX';
import { Surface } from '@/components/ui/Surface';
import { TextLink } from '@/components/ui/TextLink';
import { PidroBevel, PidroColors, PidroLayout, PidroNote, PidroRadii } from '@/design/tokens';
import { FEEDBACK_ANSWERS, nextAskCard, type AskCard } from '@/features/feedback';
import { useTranslation } from '@/i18n';
import { playSelectionHaptic } from '@/utils/haptics';

const NO_ASK: Ask = { ask: null, game_id: null };
// Long enough to see the answer marked before the next question takes the row.
const MARKED_MS = 700;

/** One question about the last game, when the server has one; asked on every Home focus. */
export function FeedbackAsk({ fixture, onMore }: { fixture?: Ask; onMore: () => void }) {
  const { t } = useTranslation();
  const [card, setCard] = useState<AskCard | null>(null);
  // One answer per question, even from a double tap that lands before the next render.
  const answering = useRef(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (fixture ? Promise.resolve(fixture) : feedbackApi.ask())
        .then((answer) => {
          if (active) setCard((current) => nextAskCard(current, { type: 'asked', answer }));
        })
        .catch(() => undefined);
      return () => {
        active = false;
      };
    }, [fixture])
  );

  if (!card) return null;
  const { ask, gameId, picked, thanked } = card;
  const pick = async (answer: FeedbackAnswer) => {
    if (picked || answering.current) return;
    answering.current = true;
    playSelectionHaptic();
    setCard(nextAskCard(card, { type: 'picked', answer }));
    const request = { kind: ask, answer, game_id: gameId } as FeedbackRequest;
    const [next] = await Promise.all([
      feedbackApi
        .send(request)
        .then(() => feedbackApi.ask())
        .catch(() => NO_ASK),
      new Promise((resolve) => setTimeout(resolve, MARKED_MS)),
    ]);
    answering.current = false;
    setCard((current) => nextAskCard(current, { type: 'asked', answer: next as Ask }));
  };
  const skip = () => {
    setCard(nextAskCard(card, { type: 'skipped' }));
    void feedbackApi
      .send({ kind: ask, answer: 'skipped', game_id: gameId } as FeedbackRequest)
      .catch(() => undefined);
  };
  const question = t(ask === 'pace' ? 'tell.pace' : 'tell.old_pidro');

  return (
    <Surface variant="window" testID="feedback-ask" style={styles.card}>
      <View style={styles.head}>
        <PidroText role="label" numberOfLines={1} style={styles.question}>
          {thanked ? t('tell.thanksShort') : question}
        </PidroText>
        {thanked ? (
          <TextLink
            label={t('tell.more')}
            accessibilityRole="button"
            onPress={onMore}
            style={styles.more}
          />
        ) : null}
      </View>
      <Animated.View
        key={ask}
        entering={FadeIn.duration(260)}
        accessibilityRole="radiogroup"
        accessibilityLabel={question}
        style={styles.track}>
        {FEEDBACK_ANSWERS[ask].map((answer) => (
          <PressableFX
            key={answer}
            accessibilityRole="radio"
            accessibilityState={{ checked: picked === answer, disabled: Boolean(picked) }}
            aria-checked={picked === answer}
            disabled={Boolean(picked)}
            onPress={() => void pick(answer)}
            style={[styles.choice, picked === answer && styles.chosen]}>
            <PidroText
              role="label"
              numberOfLines={2}
              align="center"
              style={[
                styles.choiceText,
                picked === answer && styles.chosenText,
                picked && picked !== answer && styles.otherText,
              ]}>
              {t(`tell.${ask}_${answer}` as Parameters<typeof t>[0])}
            </PidroText>
          </PressableFX>
        ))}
      </Animated.View>
      <View style={styles.close}>
        <DismissButton accessibilityLabel={t('profile.close')} onPress={skip} />
      </View>
    </Surface>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    maxWidth: PidroLayout.contentMaxWidth,
    gap: 8,
    paddingTop: 12,
    paddingBottom: 12,
    paddingHorizontal: 14,
    boxShadow: PidroBevel.heroDropShadow,
  },
  // The × sits beside the question; the answers take the card's whole width.
  head: {
    minHeight: 24,
    marginRight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  question: { flexShrink: 1, fontSize: 15, lineHeight: 20 },
  more: { marginVertical: -12, paddingHorizontal: 2 },
  track: {
    flexDirection: 'row',
    gap: 4,
    padding: 3,
    borderRadius: PidroRadii.lg,
    borderWidth: 1.5,
    borderColor: PidroColors.border,
    backgroundColor: PidroNote.track,
  },
  choice: {
    flex: 1,
    minWidth: 0,
    minHeight: PidroLayout.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
    borderRadius: 9,
  },
  chosen: { backgroundColor: PidroNote.choiceOn, boxShadow: PidroNote.choiceOnRing },
  choiceText: { fontSize: 15, lineHeight: 18 },
  chosenText: { color: PidroBevel.textGold },
  otherText: { color: PidroNote.choiceOff },
  // Its 44pt target ends where the answers start.
  close: { position: 'absolute', top: 0, right: 0 },
});
