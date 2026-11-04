import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import type { NewsPost } from '@pidro/shared';
import { FeedbackSheet } from '@/components/feedback/FeedbackSheet';
import { TellRow } from '@/components/feedback/TellRow';
import { BevelButton } from '@/components/ui/BevelButton';
import { Icon } from '@/components/ui/Icon';
import { PidroText } from '@/components/ui/PidroText';
import { PressableFX } from '@/components/ui/PressableFX';
import { Surface } from '@/components/ui/Surface';
import {
  PidroBevel,
  PidroColors,
  PidroFonts,
  PidroLayout,
  PidroRadii,
  PidroSpacing,
} from '@/design/tokens';
import { isNewPost, postedLine, type NewsState } from '@/features/news';
import { useTranslation } from '@/i18n';

interface Props {
  open: boolean;
  onClose: () => void;
  news: NewsState;
  status: 'idle' | 'loading' | 'ready' | 'failed';
  onRetry: () => void;
  /** Fixtures: Write back already open on this post. */
  reply?: NewsPost | null;
}

/**
 * News (PID-347): Tell us first, then our posts, newest first. Write back opens
 * Tell us over it, about that post; Done comes back here.
 */
export function NewsSheet({ open, onClose, news, status, onRetry, reply = null }: Props) {
  const { t } = useTranslation();
  const { width, height } = useWindowDimensions();
  const landscape = width > height && height < PidroLayout.compactHeight;
  const tablet = Math.min(width, height) >= 700;
  const reduceMotion = useReducedMotion();
  // The post outlives the sheet's close, so its chip stays while it slides away.
  const [tellOpen, setTellOpen] = useState(Boolean(reply));
  const [about, setAbout] = useState<NewsPost | null>(reply);
  const tellAbout = (post: NewsPost | null) => {
    setAbout(post);
    setTellOpen(true);
  };

  const body =
    news.posts.length === 0 && status === 'loading' ? (
      <ActivityIndicator color={PidroColors.cyanText} style={styles.state} />
    ) : news.posts.length === 0 && status === 'failed' ? (
      <View style={styles.state} accessibilityRole="alert">
        <PidroText role="body" tone="soft" align="center">
          {t('news.failed')}
        </PidroText>
        <BevelButton
          label={t('tell.retry')}
          material="glass"
          size="sm"
          onPress={onRetry}
          style={styles.retry}
        />
      </View>
    ) : (
      news.posts.map((post, index) => (
        <Post
          key={post.id}
          post={post}
          fresh={isNewPost(index, news.marked)}
          onWriteBack={() => tellAbout(post)}
        />
      ))
    );

  return (
    <Modal
      transparent
      navigationBarTranslucent
      statusBarTranslucent
      visible={open}
      supportedOrientations={['portrait', 'landscape']}
      animationType={reduceMotion ? 'none' : 'slide'}
      onRequestClose={onClose}>
      <SafeAreaProvider>
        <SafeAreaView
          style={[styles.safe, tablet && styles.safeTablet]}
          edges={['top', 'right', 'bottom', 'left']}>
          <Pressable
            accessibilityLabel={t('profile.close')}
            onPress={onClose}
            style={StyleSheet.absoluteFill}
          />
          <View
            testID="news-sheet"
            accessibilityViewIsModal
            style={[
              styles.sheet,
              landscape && styles.sheetLandscape,
              tablet && styles.sheetTablet,
            ]}>
            {landscape ? null : <View style={styles.grabber} />}
            <View style={styles.head}>
              <PidroText accessibilityRole="header" style={styles.title}>
                {t('news.door')}
              </PidroText>
              <BevelButton
                accessibilityLabel={t('profile.close')}
                material="glass"
                size="icon"
                onPress={onClose}>
                <Icon name="close" size={18} strokeWidth={2.6} />
              </BevelButton>
            </View>
            <ScrollView
              testID="news-feed"
              style={styles.feed}
              contentContainerStyle={styles.feedContent}>
              <TellRow testID="news-tell" onPress={() => tellAbout(null)} />
              {body}
            </ScrollView>
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
      <FeedbackSheet open={tellOpen} post={about} onClose={() => setTellOpen(false)} />
    </Modal>
  );
}

function Post({
  post,
  fresh,
  onWriteBack,
}: {
  post: NewsPost;
  fresh: boolean;
  onWriteBack: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Surface variant="subtle" testID="news-post" style={styles.post}>
      <View style={styles.posted}>
        {fresh ? <View testID="news-post-new" style={styles.dot} /> : null}
        <PidroText role="eyebrow" tone="cyan">
          {postedLine(post.published_at)}
        </PidroText>
      </View>
      <PidroText role="label" accessibilityRole="header" style={styles.postTitle}>
        {post.title}
      </PidroText>
      <PidroText role="body">{post.body}</PidroText>
      <PressableFX
        accessibilityRole="button"
        accessibilityLabel={`${t('news.writeBack')}: ${post.title}`}
        onPress={onWriteBack}
        style={styles.writeBack}>
        <Icon name="reply" size={18} strokeWidth={2.4} color={PidroColors.cyanText} />
        <PidroText role="label" tone="cyan" style={styles.writeBackText}>
          {t('news.writeBack')}
        </PidroText>
      </PressableFX>
    </Surface>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, justifyContent: 'flex-end', backgroundColor: PidroColors.backdrop },
  safeTablet: { justifyContent: 'center', padding: PidroSpacing.lg },
  sheet: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 520,
    flex: 1,
    marginTop: PidroSpacing.xxl,
    borderTopLeftRadius: PidroRadii.lg,
    borderTopRightRadius: PidroRadii.lg,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: PidroColors.cyanBorderStrong,
    backgroundColor: PidroBevel.panelMid,
    paddingHorizontal: 20,
    paddingTop: 10,
    gap: 14,
  },
  sheetLandscape: { maxWidth: 640, marginTop: PidroSpacing.xs, paddingTop: PidroSpacing.sm },
  // On iPad the sheet floats in the middle, as Tell us does.
  sheetTablet: {
    maxHeight: 820,
    maxWidth: 560,
    marginTop: 0,
    borderRadius: PidroRadii.lg,
    borderBottomWidth: 1,
    paddingHorizontal: 28,
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    flexShrink: 0,
    backgroundColor: PidroColors.borderStrong,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: PidroSpacing.sm, flexShrink: 0 },
  title: {
    flex: 1,
    fontFamily: PidroFonts.display,
    fontWeight: '400',
    fontSize: 28,
    lineHeight: 34,
    color: PidroBevel.textGold,
  },
  feed: { flex: 1, minHeight: 0 },
  feedContent: { gap: PidroSpacing.sm, paddingBottom: 30 },
  state: { paddingVertical: PidroSpacing.lg, alignItems: 'center', gap: PidroSpacing.sm },
  retry: { alignSelf: 'center' },
  post: {
    gap: 6,
    paddingTop: 14,
    paddingHorizontal: PidroSpacing.md,
    paddingBottom: 6,
    borderRadius: PidroRadii.lg,
  },
  posted: { flexDirection: 'row', alignItems: 'center', gap: PidroSpacing.xs },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: PidroColors.cyan,
    boxShadow: PidroColors.newsDotRing,
  },
  postTitle: { fontSize: 19, lineHeight: 24 },
  writeBack: {
    alignSelf: 'flex-start',
    minHeight: PidroLayout.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  writeBackText: { fontSize: 15, lineHeight: 20 },
});
