import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTableSize } from '@/game/canvas/TableChrome';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { pushGameAction } from '@/channels/hooks/useGameChannel';
import { PidroText } from '@/components/ui/PidroText';
import { PressableFX } from '@/components/ui/PressableFX';
import { STILL_LAYER } from '@/components/ui/StillLayer';
import { PidroColors, PidroLayout, PidroRadii, PidroSpacing } from '@/design/tokens';
import { AVATAR_SIZE, computeLayout, handScale } from '@/game/canvas/layout';
import { playActionHaptic } from '@/game/useGameHaptics';
import { useGameStore } from '@/stores/game';
import type { LegalAction } from '@/types/game';
import { useTranslation } from '@/i18n';
import { localizedError } from '@pidro/shared';
import { actionTap } from '@/diagnostics/actions';

const ALL_BID_VALUES = [6, 7, 8, 9, 10, 11, 12, 13, 14] as const;
const GRID_GAP = PidroSpacing.xxs;
const CONTROL_GAP = PidroSpacing.xs;
const PANEL_PADDING = PidroSpacing.xxs;
const HAND_GAP = 18;
const PORTRAIT_HAND_GAP = PidroSpacing.xxl;
const MAX_BUTTON_SIZE = 54;
/** A failed bid's message: up to two metadata lines. */
const ERROR_LINES_HEIGHT = 2 * 16;
const FIXED_GROUP_HEIGHT = PidroLayout.touchTarget + GRID_GAP * 2 + CONTROL_GAP + PANEL_PADDING * 2;

export function BiddingActions({
  isYourTurn,
  isHandReady,
  topReserve,
  bottomReserve,
}: {
  isYourTurn: boolean;
  isHandReady: boolean;
  topReserve: number;
  bottomReserve: number;
}) {
  const { t } = useTranslation();
  const serverState = useGameStore((state) => state.serverState);
  const legalActions = useGameStore((state) => state.legalActions);
  const { width, height } = useTableSize();
  const insets = useSafeAreaInsets();
  const landscape = width > height;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<unknown>(null);

  const { bidOptions, legalBidSet, canPass } = useMemo(() => {
    const bids: number[] = [];
    let pass = false;
    legalActions.forEach((action: LegalAction) => {
      if (action.type === 'bid') bids.push(action.amount);
      if (action.type === 'pass') pass = true;
    });
    bids.sort((a, b) => a - b);
    return { bidOptions: bids, legalBidSet: new Set(bids), canPass: pass };
  }, [legalActions]);

  const showBiddingPanel = serverState?.phase === 'bidding';
  const bidValues = ALL_BID_VALUES.filter(
    (amount) => amount >= (serverState?.config?.min_bid ?? 6)
  );
  const canAct = isYourTurn && isHandReady && (bidOptions.length > 0 || canPass);

  const sendAction = async (event: 'bid' | 'pass', payload: Record<string, unknown>) => {
    setIsSubmitting(true);
    setSubmissionError(null);
    try {
      const promise = pushGameAction(event, payload);
      if (!promise) throw new Error('The game connection is not ready.');
      await promise;
      playActionHaptic();
    } catch (error) {
      console.error(`[Game] ${event} failed:`, error);
      setSubmissionError(error);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!showBiddingPanel || !canAct) return null;

  const layout = computeLayout(width, height, insets, topReserve, bottomReserve);
  const handHeight = layout.cardH * handScale(layout.profile);
  const handTop = layout.hand.cy - handHeight / 2;
  const tableTop = insets.top + topReserve;
  // A tight table has no room for the usual air between the grid and the hand.
  const handGap = landscape ? HAND_GAP : layout.tight ? PidroSpacing.sm : PORTRAIT_HAND_GAP;
  const sideBackWidth = Math.max(30, Math.min(56, layout.cardW * 0.62));
  // Landscape North sits 8pt below the table's top edge.
  const northClearance = tableTop + (landscape ? 12 + AVATAR_SIZE[layout.profile] : 82);
  const sideClearance =
    layout.trick.cy - (sideBackWidth * 3.4) / 2 - 62 + PidroLayout.touchTarget + handGap;
  const preferredTop = landscape ? northClearance : Math.max(northClearance, sideClearance);
  const availableHeight = handTop - handGap - preferredTop;
  const buttonSize = Math.max(
    PidroLayout.touchTarget,
    Math.min(MAX_BUTTON_SIZE, Math.floor((availableHeight - FIXED_GROUP_HEIGHT) / 3))
  );
  const gridWidth = buttonSize * 3 + GRID_GAP * 2;
  const gridHeight = buttonSize * 3 + GRID_GAP * 2;
  const hardTop = tableTop + HAND_GAP;
  // Centered on the trick, but never reaching down onto the hand, a failed
  // bid's error included.
  const errorHeight = submissionError ? CONTROL_GAP + ERROR_LINES_HEIGHT : 0;
  const portraitTop = Math.max(
    hardTop,
    Math.min(
      layout.trick.cy - gridHeight / 2 - PANEL_PADDING,
      // Staying centered may take some of the portrait gap, never the last 18pt.
      handTop - Math.min(handGap, HAND_GAP) - gridHeight - FIXED_GROUP_HEIGHT - errorHeight
    )
  );

  return (
    <View
      style={[
        styles.overlay,
        {
          top: landscape ? hardTop : portraitTop,
          bottom: height - handTop + handGap,
          justifyContent: landscape ? 'flex-end' : 'flex-start',
        },
      ]}
      pointerEvents="box-none">
      {/* Drawn once on Android: only your shine breathes while you bid. */}
      <View testID="bidding-window" {...STILL_LAYER} style={styles.panel}>
        <View testID="bidding-grid" style={[styles.bidGrid, { width: gridWidth, gap: GRID_GAP }]}>
          {bidValues.map((amount) => {
            const isLegal = legalBidSet.has(amount);
            return (
              <PressableFX
                key={amount}
                accessibilityRole="button"
                accessibilityLabel={t('game.bid', { amount })}
                accessibilityState={{ disabled: !isLegal || isSubmitting }}
                onPress={() => actionTap('bid', () => sendAction('bid', { amount }))}
                disabled={!isLegal || isSubmitting}
                style={[
                  styles.bidButton,
                  { width: buttonSize, height: buttonSize },
                  isLegal ? styles.bidButtonLegal : styles.bidButtonDisabled,
                ]}
                pressedStyle={styles.bidButtonPressed}>
                <PidroText
                  role="title"
                  tone={isLegal ? 'default' : 'muted'}
                  maxFontSizeMultiplier={1.2}>
                  {amount}
                </PidroText>
              </PressableFX>
            );
          })}
        </View>
        <PressableFX
          accessibilityRole="button"
          accessibilityLabel={t('game.pass')}
          accessibilityState={{ disabled: !canPass || isSubmitting }}
          onPress={() => actionTap('pass', () => sendAction('pass', {}))}
          disabled={!canPass || isSubmitting}
          style={[
            styles.passButton,
            { width: gridWidth },
            canPass ? styles.passButtonEnabled : styles.bidButtonDisabled,
          ]}
          pressedStyle={styles.bidButtonPressed}>
          <PidroText role="title" maxFontSizeMultiplier={1.2}>
            {t('game.pass').toLocaleUpperCase()}
          </PidroText>
        </PressableFX>
        {submissionError ? (
          <PidroText
            accessibilityLiveRegion="polite"
            role="metadata"
            tone="danger"
            align="center"
            numberOfLines={2}>
            {localizedError(submissionError, 'game.bid_failed')}
          </PidroText>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 54,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: PidroSpacing.sm,
  },
  panel: {
    alignItems: 'center',
    gap: CONTROL_GAP,
    padding: PANEL_PADDING,
    borderRadius: PidroRadii.lg,
    backgroundColor: PidroColors.panelStrong,
  },
  bidGrid: {
    alignSelf: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  bidButton: {
    minWidth: PidroLayout.touchTarget,
    minHeight: PidroLayout.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderRadius: PidroRadii.surface,
    borderWidth: 1,
  },
  bidButtonLegal: {
    borderColor: PidroColors.cyanBorderStrong,
    backgroundColor: PidroColors.glassHover,
  },
  bidButtonDisabled: {
    borderColor: PidroColors.border,
    backgroundColor: PidroColors.panel,
    opacity: 0.58,
  },
  bidButtonPressed: {
    opacity: 0.76,
    backgroundColor: PidroColors.glass,
  },
  passButton: {
    minHeight: PidroLayout.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: PidroRadii.surface,
    borderWidth: 1.5,
  },
  passButtonEnabled: {
    borderColor: PidroColors.cyanBorderStrong,
    backgroundColor: PidroColors.glassHover,
  },
});
