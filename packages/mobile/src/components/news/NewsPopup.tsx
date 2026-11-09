import { useRef, useState } from 'react';
import {
  Image,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { nativeApplicationVersion, nativeBuildVersion } from 'expo-application';
import { Asset } from 'expo-asset';
import Constants from 'expo-constants';
import { useIsFocused, usePathname } from 'expo-router';
import { useReducedMotion } from 'react-native-reanimated';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import type { NewsPost } from '@pidro/shared';
import { newsApi } from '@/api/news';
import { BevelButton } from '@/components/ui/BevelButton';
import { PidroText } from '@/components/ui/PidroText';
import { Surface } from '@/components/ui/Surface';
import { TextLink } from '@/components/ui/TextLink';
import { PidroColors, PidroFonts, PidroLayout, PidroRadii, PidroSpacing } from '@/design/tokens';
import { nativeStoreUpdate, updateBuildLine, updateStoreLabel } from '@/features/appUpdate';
import { newsPopupFixture, popupForStart } from '@/features/newsPopup';
import { useTranslation } from '@/i18n';
import { useAuthStore } from '@/stores/auth';
import { useLobbyStore } from '@/stores/lobby';
import { useNewsStore } from '@/stores/news';
import { NewsMarkdown } from './NewsMarkdown';

// A foreground, route remount or account switch is not another cold start.
const handledThisStart = new Map<string, Set<number>>();

/** Home mounts only after the startup update gate releases. */
export function NewsPopup({ fixture, blocked }: { fixture?: string; blocked: boolean }) {
  const { t, locale } = useTranslation();
  const focused = useIsFocused();
  const pathname = usePathname();
  const userId = useAuthStore((state) => state.user?.id);
  const { popup, popupLoaded, welcomeReady, status, locale: postLocale } = useNewsStore();
  const minimums = useLobbyStore((state) => state.minimumNativeVersions);
  const minimumBuilds = useLobbyStore((state) => state.minimumNativeBuilds);
  const urls = useLobbyStore((state) => state.nativeStoreUrls);
  const nativeUpdatePopup = useLobbyStore((state) => state.nativeUpdatePopup);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const preview = __DEV__ ? newsPopupFixture(fixture, locale) : null;
  if (preview && (fixture === 'popup-image' || fixture === 'popup-news'))
    preview.image_url = Asset.fromModule(require('../../../assets/images/logo-v3.png')).uri;
  const platform = preview ? (fixture === 'popup-ios' ? 'ios' : 'android') : Platform.OS;
  const url = preview
    ? `https://example.invalid/pidro-${platform}`
    : platform === 'android' || platform === 'ios'
      ? urls[platform]
      : undefined;
  const fallback = nativeStoreUpdate(
    platform,
    { version: nativeApplicationVersion, build: nativeBuildVersion },
    { versions: minimums, builds: minimumBuilds },
    urls
  );
  const handled = handledThisStart.get(userId ?? '') ?? new Set<number>();
  const post = popupForStart({
    post: preview ?? popup,
    fallback: fallback
      ? {
          id: 0,
          title: t('news.updateTitle'),
          body: t('news.updateBody'),
          published_at: '',
          app_update: true,
        }
      : null,
    nativeUpdatePopup,
    handled: preview
      ? new Set(dismissed === `${userId}:${preview.id}` ? [preview.id] : [])
      : handled,
    ready:
      Boolean(preview) ||
      (welcomeReady && ((popupLoaded && postLocale === locale) || status === 'failed')),
    atHome: focused && pathname === '/home' && !blocked,
    inGame: pathname.startsWith('/game'),
  });
  const storeLabel = updateStoreLabel(platform, Constants.expoConfig?.extra?.variant);
  if (!post || (fixture && !preview) || (post.app_update && !(url && storeLabel))) return null;
  // Web has no build number, so previews show the boards' 14 and 19.
  const builds = post.app_update
    ? preview
      ? updateBuildLine('14', '19')
      : updateBuildLine(
          nativeBuildVersion,
          platform === 'android' || platform === 'ios' ? minimumBuilds[platform] : null
        )
    : null;

  const close = async (later: boolean) => {
    if (!preview && useAuthStore.getState().user?.id !== userId) return;
    if (!preview && !later && post.id !== 0) await newsApi.popupSeen(post.id);
    if (!preview && useAuthStore.getState().user?.id !== userId) return;
    if (!preview) {
      handled.add(post.id);
      handledThisStart.set(userId ?? '', handled);
    }
    setDismissed(`${userId}:${post.id}`);
  };

  return (
    <PopupCard
      key={`${userId}:${post.id}`}
      post={post}
      url={post.app_update ? url : (post.button_url ?? undefined)}
      label={post.app_update ? storeLabel! : post.button_label || t('news.gotIt')}
      builds={builds}
      close={close}
    />
  );
}

function PopupCard({
  post,
  url,
  label,
  builds,
  close,
}: {
  post: NewsPost;
  url?: string;
  label: string;
  builds: string | null;
  close: (later: boolean) => Promise<void>;
}) {
  const { t } = useTranslation();
  const { width, height } = useWindowDimensions();
  const landscape = width > height && height < PidroLayout.compactHeight;
  const short = height < 700;
  const reduceMotion = useReducedMotion();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const inFlight = useRef(false);
  const finish = async (later: boolean, openLink = false) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setFailed(false);
    try {
      if (openLink && url) await Linking.openURL(url);
      await close(later);
    } catch {
      setFailed(true);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const image =
    post.image_url && !imageFailed ? (
      <Image
        testID="news-popup-image"
        source={{ uri: post.image_url }}
        accessible={false}
        resizeMode="contain"
        onError={() => setImageFailed(true)}
        style={[styles.image, short && styles.imageShort, landscape && styles.imageLandscape]}
      />
    ) : null;

  return (
    <Modal
      transparent
      navigationBarTranslucent
      statusBarTranslucent
      supportedOrientations={['portrait', 'landscape']}
      animationType={reduceMotion ? 'none' : 'fade'}
      onRequestClose={() => void finish(Boolean(post.app_update))}>
      <SafeAreaProvider>
        <SafeAreaView style={styles.backdrop}>
          <Surface
            testID="news-popup"
            variant="window"
            role="dialog"
            aria-modal
            aria-labelledby="news-popup-title"
            accessibilityViewIsModal
            style={[styles.card, landscape && styles.cardLandscape]}>
            {image}
            <View style={styles.content}>
              <ScrollView style={styles.scroll} contentContainerStyle={styles.copy}>
                {post.eyebrow ? (
                  <PidroText role="label" tone="gold">
                    {post.eyebrow}
                  </PidroText>
                ) : null}
                <PidroText
                  nativeID="news-popup-title"
                  accessibilityRole="header"
                  style={[styles.title, landscape && styles.titleLandscape]}>
                  {post.title}
                </PidroText>
                <NewsMarkdown
                  testID="news-popup-body"
                  body={post.body}
                  tone="soft"
                  style={styles.body}
                  onLinkError={() => setFailed(true)}
                />
                {builds ? (
                  <PidroText testID="news-popup-builds" role="metadata" tone="muted">
                    {builds}
                  </PidroText>
                ) : null}
              </ScrollView>
              <View style={styles.actions}>
                {failed ? (
                  <PidroText tone="danger" accessibilityRole="alert">
                    {t('news.popupFailed')}
                  </PidroText>
                ) : null}
                <BevelButton
                  testID="news-popup-action"
                  label={label}
                  size="md"
                  fullWidth
                  loading={busy}
                  onPress={() => void finish(false, true)}
                />
                {post.app_update ? (
                  <TextLink
                    testID="news-popup-later"
                    label={t('news.later')}
                    size={16}
                    accessibilityRole="button"
                    disabled={busy}
                    onPress={() => void finish(true)}
                  />
                ) : null}
              </View>
            </View>
          </Surface>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: PidroColors.backdrop,
    padding: PidroSpacing.md,
  },
  card: {
    width: '100%',
    maxWidth: 480,
    maxHeight: '100%',
    padding: PidroSpacing.lg,
    gap: PidroSpacing.md,
  },
  cardLandscape: { maxWidth: 760, flexDirection: 'row', padding: PidroSpacing.md },
  content: { flexShrink: 1, minHeight: 0, gap: PidroSpacing.md },
  scroll: { flexGrow: 0, flexShrink: 1 },
  copy: { gap: PidroSpacing.sm },
  title: {
    fontFamily: PidroFonts.display,
    fontWeight: '400',
    fontSize: 30,
    lineHeight: 38,
    color: PidroColors.gold,
  },
  titleLandscape: { fontSize: 26, lineHeight: 34 },
  body: { fontSize: 18, lineHeight: 27 },
  actions: { gap: PidroSpacing.xs },
  image: { width: '100%', height: 180, borderRadius: PidroRadii.surface },
  imageShort: { height: 100 },
  imageLandscape: { width: 180, height: '100%', minHeight: 180, alignSelf: 'stretch' },
});
