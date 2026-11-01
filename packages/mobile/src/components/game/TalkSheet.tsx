import { useRef } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useReducedMotion } from 'react-native-reanimated';
import { PidroText } from '@/components/ui/PidroText';
import { PidroBevel, PidroColors, PidroRadii, PidroSpacing } from '@/design/tokens';
import { TALK_COINS, TALK_WORDS, type Said, type TalkItem } from '@/features/game/talk';
import type { TalkSheet as Sheet } from '@/game/useTableTalk';
import { t, useTranslation } from '@/i18n';
import { TalkBand, TalkCoin, TalkWord, talkText } from './TableTalk';

/**
 * The hand of words, and what was said this game. A sheet from below, as
 * FriendSheet is; in landscape it comes in from the right. The table stays
 * visible above it, and a tap outside closes it.
 */
export function TalkSheet({
  sheet,
  log,
  who,
  onSend,
  onOpen,
}: {
  sheet: Sheet | null;
  log: Said[];
  who: (said: Said) => { name: string; color: string };
  onSend: (item: TalkItem) => void;
  onOpen: (sheet: Sheet | null) => void;
}) {
  useTranslation();
  const { width, height } = useWindowDimensions();
  const wide = width > height;
  const reduceMotion = useReducedMotion();
  const close = () => onOpen(null);
  const scroll = useRef<ScrollView>(null);
  return (
    <Modal
      transparent
      navigationBarTranslucent
      statusBarTranslucent
      visible={sheet != null}
      supportedOrientations={['portrait', 'landscape']}
      animationType={reduceMotion ? 'none' : wide ? 'fade' : 'slide'}
      onRequestClose={close}>
      <SafeAreaProvider>
        <SafeAreaView
          style={[styles.safe, wide && styles.safeWide]}
          edges={['top', 'right', 'bottom', 'left']}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('profile.close')}
            onPress={close}
            style={StyleSheet.absoluteFill}
          />
          <View
            testID={`talk-sheet-${sheet}`}
            accessibilityViewIsModal
            onAccessibilityEscape={close}
            accessibilityLabel={sheet === 'log' ? t('talk.title') : t('talk.say')}
            style={[styles.sheet, wide && styles.sheetWide]}>
            {wide ? null : <View style={styles.grabber} />}
            {sheet === 'log' ? (
              <>
                <ScrollView
                  ref={scroll}
                  style={styles.log}
                  contentContainerStyle={styles.logLines}
                  // The newest line first in view.
                  onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}>
                  {log.map((said, i) => {
                    const { name, color } = who(said);
                    return (
                      <PidroText key={i} role="body" style={styles.line}>
                        <PidroText role="body" style={[styles.lineWho, { color }]}>
                          {name}
                        </PidroText>{' '}
                        {talkText(said)}
                      </PidroText>
                    );
                  })}
                </ScrollView>
                <PidroText role="metadata" tone="soft">
                  {t('talk.only_this_game')}
                </PidroText>
                <TalkBand place="band" line={null} lineName="" onOpen={() => onOpen('words')} />
              </>
            ) : (
              <>
                <View style={styles.coins}>
                  {TALK_COINS.map((item) => (
                    <TalkCoin
                      key={item}
                      item={item}
                      size={wide ? 52 : 58}
                      onPress={() => onSend(item)}
                    />
                  ))}
                </View>
                {[0, 3, 6].map((row) => (
                  <View key={row} style={styles.words}>
                    {TALK_WORDS.slice(row, row + 3).map((item, i) => (
                      <TalkWord
                        key={item}
                        item={item}
                        index={row + i}
                        onPress={() => onSend(item)}
                        style={[styles.wordCard, { height: wide ? 52 : 60 }]}
                      />
                    ))}
                  </View>
                ))}
              </>
            )}
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, justifyContent: 'flex-end', backgroundColor: PidroColors.screenScrim },
  safeWide: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'stretch' },
  sheet: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 520,
    borderTopLeftRadius: PidroRadii.lg,
    borderTopRightRadius: PidroRadii.lg,
    borderWidth: 1,
    borderColor: PidroColors.cyanBorderStrong,
    backgroundColor: PidroBevel.panelMid,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: PidroSpacing.lg,
    gap: PidroSpacing.sm,
  },
  sheetWide: {
    alignSelf: 'stretch',
    justifyContent: 'center',
    width: 380,
    borderRadius: PidroRadii.lg,
    paddingTop: PidroSpacing.md,
    paddingBottom: PidroSpacing.md,
    margin: PidroSpacing.xs,
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    backgroundColor: PidroColors.borderStrong,
  },
  coins: { flexDirection: 'row', justifyContent: 'space-between' },
  words: { flexDirection: 'row', gap: PidroSpacing.xs },
  wordCard: { flex: 1 },
  log: { flexGrow: 0, maxHeight: 260 },
  logLines: { gap: 10 },
  line: { fontWeight: '700' },
  lineWho: { fontWeight: '900' },
});
