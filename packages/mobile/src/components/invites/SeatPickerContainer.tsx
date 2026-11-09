import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useReducedMotion } from 'react-native-reanimated';
import { BevelPressable } from '@/components/ui/Bevel';
import { DismissButton } from '@/components/ui/DismissButton';
import { Icon } from '@/components/ui/Icon';
import { PidroText } from '@/components/ui/PidroText';
import { TextLink } from '@/components/ui/TextLink';
import { PidroBevel, PidroColors, PidroFonts, PidroRadii } from '@/design/tokens';
import { useTranslation } from '@/i18n';
import { BotPicker, type BotPickerProps } from './BotPicker';
import { ChoiceList, type ChoiceListProps } from './ChoiceList';
import { FriendPicker, type FriendPickerProps } from './FriendPicker';

export interface SeatPickerContainerProps {
  title: string;
  subtitle: string;
  choices: Omit<ChoiceListProps, 'compact' | 'onNavigate' | 'label'>;
  friends: Omit<FriendPickerProps, 'compact' | 'columns'>;
  /** Who sits in a bot seat (PID-410), with the page's one line of help. */
  bots?: Omit<BotPickerProps, 'columns'> & { help: string };
  onClose: () => void;
  initialPage?: 'choices' | 'friends' | 'bots';
  /** The server's refusal of the last choice, in plain words. */
  error?: string;
}

/** Local presentation only. Selection is an intent; the caller owns its result. */
export function SeatPickerContainer({
  title,
  subtitle,
  choices,
  friends,
  bots,
  onClose,
  initialPage = 'choices',
  error,
}: SeatPickerContainerProps) {
  const { t } = useTranslation();
  const { width, height } = useWindowDimensions();
  const tablet = Math.min(width, height) >= 600;
  const landscape = width > height;
  const split = tablet || landscape;
  const phoneLandscape = landscape && !tablet;
  const reduceMotion = useReducedMotion();
  const [page, setPage] = useState(initialPage);
  const friendPage = !split && page === 'friends';
  // A bot seat opens on who sits there; the way back leads to the other choices.
  const botPage = page === 'bots' && !!bots;
  const closeLabel = t('common.cancel');
  return (
    <Modal
      transparent
      navigationBarTranslucent
      statusBarTranslucent
      onRequestClose={onClose}
      supportedOrientations={['portrait', 'landscape-left', 'landscape-right']}
      animationType={reduceMotion ? 'none' : 'fade'}>
      <SafeAreaProvider>
        <SafeAreaView edges={['top', 'right', 'bottom', 'left']} style={styles.safe}>
          <Pressable
            accessibilityLabel={closeLabel}
            onPress={onClose}
            style={StyleSheet.absoluteFill}
          />
          <KeyboardAvoidingView
            pointerEvents="box-none"
            style={[styles.keyboard, tablet && styles.center]}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <View
              testID="seat-picker-container"
              accessibilityViewIsModal
              style={[
                styles.sheet,
                split && styles.screen,
                phoneLandscape && styles.tight,
                tablet && styles.panel,
                (friendPage || botPage) && styles.expanded,
              ]}>
              {!split && <View style={styles.grabber} />}
              {friendPage ? (
                <>
                  <TextLink
                    label={`‹ ${title}`}
                    onPress={() => setPage('choices')}
                    style={styles.back}
                  />
                  <PidroText role="title" tone="gold" style={styles.title}>
                    {t('picker.invite')}
                  </PidroText>
                </>
              ) : (
                <>
                  {botPage && !phoneLandscape && (
                    <TextLink
                      label={`‹ ${t('picker.other_choices')}`}
                      onPress={() => setPage('choices')}
                      style={styles.back}
                    />
                  )}
                  <View style={[styles.header, phoneLandscape && styles.inlineHeader]}>
                    {/* Sideways the ✕ leads the row on round glass, like the back button (the board). */}
                    {phoneLandscape && (
                      <BevelPressable
                        accessibilityRole="button"
                        accessibilityLabel={closeLabel}
                        material="glass"
                        radius={22}
                        onPress={onClose}
                        style={styles.close}
                        contentStyle={styles.closeFace}>
                        <Icon name="close" size={20} strokeWidth={2.4} />
                      </BevelPressable>
                    )}
                    <View style={[styles.heading, phoneLandscape && styles.inlineHeading]}>
                      <PidroText role="title" tone="gold" style={styles.title}>
                        {title}
                      </PidroText>
                      <PidroText role="metadata" tone="soft">
                        {bots && botPage ? bots.help : subtitle}
                      </PidroText>
                    </View>
                    {/* Sideways the way back shares the header row, so the list keeps its height. */}
                    {botPage && phoneLandscape && (
                      <TextLink
                        label={`‹ ${t('picker.other_choices')}`}
                        onPress={() => setPage('choices')}
                      />
                    )}
                    {!phoneLandscape && (
                      <DismissButton accessibilityLabel={closeLabel} onPress={onClose} />
                    )}
                  </View>
                </>
              )}
              {error ? (
                <PidroText role="metadata" tone="danger" accessibilityRole="alert">
                  {error}
                </PidroText>
              ) : null}
              {bots && botPage ? (
                <BotPicker
                  {...bots}
                  columns={landscape ? 2 : 1}
                  onSeat={(persona) => {
                    bots.onSeat(persona);
                    onClose();
                  }}
                />
              ) : (
                <View style={[styles.body, friendPage && styles.expanded, split && styles.split]}>
                  {!friendPage && (
                    <ScrollView
                      style={split ? styles.choicesColumn : styles.choicesScroll}
                      contentContainerStyle={styles.choicesContent}
                      keyboardShouldPersistTaps="handled">
                      {tablet && (
                        <PidroText role="eyebrow" tone="cyan">
                          {t('picker.fill_or_open')}
                        </PidroText>
                      )}
                      <ChoiceList
                        {...choices}
                        label={title}
                        compact={split}
                        onNavigate={() => setPage('friends')}
                        onSelect={(id) => {
                          choices.onSelect(id);
                          onClose();
                        }}
                      />
                    </ScrollView>
                  )}
                  {(split || friendPage) && (
                    <View style={styles.friendsColumn}>
                      {split && (
                        <PidroText role="eyebrow" tone="cyan">
                          {t('picker.or_invite')}
                        </PidroText>
                      )}
                      <FriendPicker
                        {...friends}
                        compact={split}
                        columns={landscape ? 2 : 1}
                        dense={phoneLandscape}
                        onInvite={(friend) => {
                          friends.onInvite(friend);
                          onClose();
                        }}
                      />
                    </View>
                  )}
                </View>
              )}
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: PidroColors.backdrop },
  keyboard: { flex: 1, justifyContent: 'flex-end' },
  center: { justifyContent: 'center', padding: 24 },
  sheet: {
    maxHeight: '100%',
    flexShrink: 1,
    padding: 16,
    gap: 12,
    backgroundColor: PidroBevel.panelMid,
    borderWidth: 1,
    borderColor: PidroColors.borderStrong,
    borderTopLeftRadius: PidroRadii.xl,
    borderTopRightRadius: PidroRadii.xl,
  },
  screen: { flex: 1, borderRadius: 0 },
  // Four rows of friends fit under the header on a 390pt-tall phone.
  tight: { paddingVertical: 8, gap: 8 },
  panel: {
    flexGrow: 0,
    flexShrink: 1,
    flexBasis: 'auto',
    height: 660,
    width: '100%',
    maxWidth: 780,
    alignSelf: 'center',
    borderRadius: PidroRadii.xl,
    padding: 24,
  },
  expanded: { flex: 1 },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: PidroRadii.full,
    backgroundColor: PidroColors.borderStrong,
    alignSelf: 'center',
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  inlineHeader: { gap: 12 },
  close: { width: 44, height: 44, flexShrink: 0 },
  closeFace: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  heading: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontFamily: PidroFonts.display, fontSize: 24, lineHeight: 32 },
  inlineHeading: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  back: { alignSelf: 'flex-start', paddingHorizontal: 0 },
  body: { flexShrink: 1, minHeight: 0 },
  split: { flex: 1, flexDirection: 'row', gap: 20 },
  choicesScroll: { flexShrink: 1 },
  choicesColumn: { width: 300, flexGrow: 0, flexShrink: 0 },
  choicesContent: { gap: 8 },
  friendsColumn: { flex: 1, minWidth: 0, minHeight: 0, gap: 8 },
});
