/**
 * "A new version is ready" — the shell's one notice. A floating card over the
 * screen, anchored just above the tab pill (above the bottom safe area when
 * there is no bottom pill) and short of the landscape tab rail, so showing or
 * hiding it never moves anything. A screen whose controls reach the bottom
 * (Home) places it in a free spot of its own with `UpdateNoticeSlot`.
 */
import { createContext, useContext, useLayoutEffect, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { FadeInDown, FadeOutDown, useReducedMotion } from 'react-native-reanimated';
import { BevelButton } from '@/components/ui/BevelButton';
import { Icon } from '@/components/ui/Icon';
import { PidroText } from '@/components/ui/PidroText';
import { Surface } from '@/components/ui/Surface';
import { PidroBevel, PidroColors, PidroLayout, PidroSpacing } from '@/design/tokens';
import { useTranslation } from '@/i18n';

export interface UpdateNoticeState {
  restarting: boolean;
  onRestart: () => void;
  onDismiss: () => void;
}

interface UpdateNoticeProps extends UpdateNoticeState {
  /** Where the card floats; it is absolutely positioned and spans its parent. */
  style?: StyleProp<ViewStyle>;
  onHeight?: (height: number) => void;
}

/** The shell's notice while it shows, and the claim a screen's slot makes on it. */
export const UpdateNoticeHost = createContext<{
  notice: UpdateNoticeState | null;
  setPlaced: (placed: boolean) => void;
}>({ notice: null, setPlaced: () => {} });

/**
 * Shows the shell's notice here, at the top of this view, instead of above the
 * pill. `children` take the spot while there is no notice; the notice wins.
 */
export function UpdateNoticeSlot({
  style,
  children,
}: {
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}) {
  const { notice, setPlaced } = useContext(UpdateNoticeHost);
  useLayoutEffect(() => {
    setPlaced(true);
    return () => setPlaced(false);
  }, [setPlaced]);
  if (notice) return <UpdateNotice {...notice} style={[styles.slotTop, style]} />;
  return children ? (
    <View pointerEvents="box-none" style={[styles.slot, styles.slotTop, style]}>
      {children}
    </View>
  ) : null;
}

export function UpdateNotice({
  restarting,
  onRestart,
  onDismiss,
  style,
  onHeight,
}: UpdateNoticeProps) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();

  return (
    <Animated.View
      entering={reduceMotion ? undefined : FadeInDown.duration(200)}
      exiting={reduceMotion ? undefined : FadeOutDown.duration(160)}
      pointerEvents="box-none"
      onLayout={onHeight && ((event) => onHeight(event.nativeEvent.layout.height))}
      style={[styles.slot, style]}>
      <Surface
        testID="update-notice"
        variant="window"
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={styles.notice}>
        <Icon name="rematch" size={20} color={PidroColors.cyan} />
        <PidroText role="label" style={styles.copy}>
          {t('update.notice')}
        </PidroText>
        <View style={styles.actions}>
          <BevelButton
            testID="update-notice-restart"
            label={t('update.restart')}
            material="wood"
            size="sm"
            loading={restarting}
            onPress={onRestart}
            style={styles.restart}
          />
          <BevelButton
            accessibilityLabel={t('update.dismiss')}
            material="glass"
            size="icon"
            onPress={onDismiss}>
            <Icon name="close" size={20} />
          </BevelButton>
        </View>
      </Surface>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  slot: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  slotTop: { top: 0 },
  notice: {
    width: '100%',
    maxWidth: PidroLayout.contentMaxWidth,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: PidroSpacing.sm,
    paddingVertical: PidroSpacing.xs,
    paddingLeft: PidroSpacing.md,
    paddingRight: PidroSpacing.xs,
    boxShadow: PidroBevel.heroDropShadow,
  },
  // In a narrow slot the buttons wrap below the copy rather than squeeze it.
  copy: { flexGrow: 1, flexShrink: 1, flexBasis: 80 },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: PidroSpacing.xs,
    marginLeft: 'auto',
  },
  // Holds its width while the label turns into a spinner.
  restart: { minWidth: 96 },
});
