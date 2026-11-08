import { useState, type ReactNode } from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { Asset } from 'expo-asset';
import { useReducedMotion } from 'react-native-reanimated';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import type { PinChoice } from '@pidro/shared';
import type { ClassicProfile } from '@/api/profile';
import { Avatar, FACES } from '@/components/ui/Avatar';
import { BevelButton } from '@/components/ui/BevelButton';
import { Icon } from '@/components/ui/Icon';
import { PidroText } from '@/components/ui/PidroText';
import { Coin, PlayerAvatar } from '@/components/ui/PlayerAvatar';
import { PressableFX } from '@/components/ui/PressableFX';
import { Surface } from '@/components/ui/Surface';
import { TextLink } from '@/components/ui/TextLink';
import { useAuthStore } from '@/stores/auth';
import { useProfilePhoto } from './useProfilePhoto';
import {
  PidroBevel,
  PidroColors,
  PidroFonts,
  PidroLayout,
  PidroRadii,
  PidroSpacing,
} from '@/design/tokens';
import { classicPinLine, faceTap, pictureChoice, type Face } from '@/features/profile';
import { formatNumber, useTranslation } from '@/i18n';
import { isStillCapture } from '@/utils/stillCapture';

/**
 * The player's picture, ring and pin. Pin choice stays on this device until
 * the server keeps pins; a face or photo changes only after the server
 * accepts it, though a tapped face shows while it saves.
 */
export function BadgeSheet({
  isOpen,
  onClose,
  uri,
  level,
  prestige,
  classic,
  pin,
  onChoosePin,
  fixture,
}: {
  isOpen: boolean;
  onClose: () => void;
  uri?: string | null;
  level?: number | null;
  prestige?: number | null;
  classic: ClassicProfile | null;
  pin: 'classic' | null;
  onChoosePin: (pin: PinChoice) => void;
  fixture?: string;
}) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const user = useAuthStore((state) => state.user);
  const guest = !!user?.guest;
  const photo = useProfilePhoto();
  const previewState = __DEV__ ? fixture : undefined;
  // A face over a photo waits for the player to say the photo may go.
  const [confirmRemove, setConfirmRemove] = useState<Face | 'photo' | null>(
    previewState === 'photo-remove' ? 'photo' : null
  );
  const faceFixture = previewState === 'photo-empty' || previewState?.startsWith('photo-face');
  const fixturePhoto =
    __DEV__ && previewState && !faceFixture
      ? Asset.fromModule(require('../../../assets/images/marcel.jpg')).uri
      : null;
  const currentUri = faceFixture ? null : (fixturePhoto ?? uri);
  const choice = previewState
    ? fixturePhoto
      ? 'photo'
      : previewState === 'photo-face' || previewState === 'photo-face-saved'
        ? 'b'
        : 'a'
    : pictureChoice(user);
  const shown = photo.face ?? choice;
  // Without a photo, avatar_url is the face's image: only a photo fills the Photo disc.
  const photoUri = photo.preview ?? (choice === 'photo' ? currentUri : null);
  // The sheet draws faces from the app's own images, the same pixels the server serves.
  const picture = {
    uri: shown === 'photo' ? currentUri : null,
    fallbackSource: FACES[shown === 'photo' ? 'a' : shown],
  };
  const progress = previewState === 'photo-uploading' ? 42 : photo.progress;
  const busy = photo.busy || progress != null;
  const error =
    previewState === 'photo-error'
      ? t('profile.photo_open_error')
      : previewState === 'photo-face-error'
        ? t('profile.face_error')
        : photo.error;
  const saved = previewState === 'photo-saved' || photo.saved;
  const faceSaved = previewState === 'photo-face-saved' || photo.faceSaved;
  const feedback = progress != null || saved || faceSaved || !!error;
  // The face that shows once the photo goes: the one tapped, or the one kept on the server.
  const afterPhoto = confirmRemove === 'photo' ? (user?.avatar_face ?? 'a') : confirmRemove;
  const tapFace = (face: Face) => {
    if (previewState) return;
    const action = faceTap(shown, face);
    if (action === 'confirm-remove') setConfirmRemove(face);
    else if (action === 'save-face') void photo.pickFace(face);
  };
  const { height } = useWindowDimensions();
  const short = height < PidroLayout.compactHeight;
  const compact = height < 700;
  const disc = compact ? 64 : 84;
  const close = () => {
    if (photo.isBusy() || busy) return;
    setConfirmRemove(null);
    onClose();
  };
  return (
    <Modal
      visible={isOpen}
      transparent
      navigationBarTranslucent
      statusBarTranslucent
      animationType={reduceMotion || isStillCapture() ? 'none' : 'slide'}
      onRequestClose={close}>
      <SafeAreaProvider>
        <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
          <Pressable
            style={StyleSheet.absoluteFill}
            accessibilityLabel={t('profile.close_badges')}
            onPress={close}
          />
          <View style={[styles.sheet, compact && styles.compactSheet]} testID="badge-sheet">
            <View style={styles.grabber} />
            <PidroText style={styles.title} accessibilityRole="header">
              {t(guest ? 'profile.badges' : 'profile.photo_and_ring')}
            </PidroText>
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={[
                styles.content,
                compact && styles.compactContent,
                short && styles.columns,
              ]}
              showsVerticalScrollIndicator={false}>
              <View
                style={[styles.photo, compact && styles.compactPhoto, short && styles.photoColumn]}>
                <View
                  testID="photo-preview"
                  style={[styles.avatar, compact && styles.compactAvatar]}>
                  <PlayerAvatar
                    size={compact ? 72 : 92}
                    uri={photo.preview ?? picture.uri}
                    fallbackSource={picture.fallbackSource}
                    level={level}
                    prestige={prestige}
                    pin={pin}
                    photoProgress={progress}
                    accessibilityLabel={t(pin ? 'profile.wearing_classic' : 'profile.wearing_none')}
                  />
                </View>
                {feedback ? (
                  <View testID="photo-feedback" style={styles.feedback}>
                    {progress != null ? (
                      <PidroText
                        testID="photo-progress"
                        role="metadata"
                        tone="cyan"
                        align="center"
                        accessibilityRole="progressbar"
                        accessibilityLabel={t('profile.processing')}
                        accessibilityValue={{ min: 0, max: 100, now: progress }}>
                        {progress < 100
                          ? t('profile.uploading', { number: formatNumber(progress) })
                          : t('profile.processing')}
                      </PidroText>
                    ) : error ? (
                      <>
                        <PidroText
                          role="metadata"
                          tone="danger"
                          align="center"
                          accessibilityRole="alert">
                          {error}
                        </PidroText>
                        <TextLink
                          testID="photo-retry"
                          label={t('game.try_again')}
                          disabled={busy}
                          onPress={() => {
                            if (!previewState) void photo.retry();
                          }}
                        />
                      </>
                    ) : (
                      <PidroText
                        role="metadata"
                        tone="cyan"
                        align="center"
                        accessibilityLiveRegion="polite">
                        {t(saved ? 'profile.photo_saved' : 'profile.face_saved')}
                      </PidroText>
                    )}
                  </View>
                ) : null}
                <View testID="photo-actions" style={styles.actions}>
                  {confirmRemove ? (
                    <>
                      <PidroText role="label" align="center">
                        {t('profile.remove_title')}
                      </PidroText>
                      <PidroText role="metadata" tone="soft" align="center">
                        {t('profile.remove_help', {
                          face: t(afterPhoto === 'b' ? 'profile.face_2' : 'profile.face_1'),
                        })}
                      </PidroText>
                      <BevelButton
                        testID="photo-confirm"
                        label={t('profile.remove_photo')}
                        size="sm"
                        fullWidth
                        disabled={busy}
                        onPress={() => {
                          if (previewState) return;
                          setConfirmRemove(null);
                          void photo.remove(confirmRemove === 'photo' ? undefined : confirmRemove);
                        }}
                      />
                      <TextLink
                        testID="photo-cancel"
                        label={t('common.cancel')}
                        disabled={busy}
                        onPress={() => setConfirmRemove(null)}
                      />
                    </>
                  ) : (
                    <>
                      {/* The row's words yield to the line under the avatar, so small screens fit. */}
                      {!error ? (
                        <PidroText role="metadata" tone="cyan" style={styles.eyebrow}>
                          {t('profile.your_picture')}
                        </PidroText>
                      ) : null}
                      <View
                        testID="picture-choices"
                        accessibilityRole="radiogroup"
                        style={styles.discs}>
                        <PictureDisc
                          testID="picture-face-a"
                          label={t('profile.face_1')}
                          size={disc}
                          checked={shown === 'a'}
                          disabled={busy || photo.saving}
                          onPress={() => tapFace('a')}>
                          <Image source={FACES.a} style={styles.discImage} />
                        </PictureDisc>
                        <PictureDisc
                          testID="picture-face-b"
                          label={t('profile.face_2')}
                          size={disc}
                          checked={shown === 'b'}
                          disabled={busy || photo.saving}
                          onPress={() => tapFace('b')}>
                          <Image source={FACES.b} style={styles.discImage} />
                        </PictureDisc>
                        {!guest ? (
                          <PictureDisc
                            testID="picture-photo"
                            label={t('profile.photo')}
                            size={disc}
                            checked={shown === 'photo'}
                            empty={!photoUri}
                            disabled={busy || photo.saving}
                            onPress={() => {
                              if (!previewState) void photo.choose();
                            }}>
                            {photoUri ? (
                              <Avatar uri={photoUri} style={styles.discImage} resizeMode="cover" />
                            ) : (
                              <Icon name="camera" size={disc * 0.36} color={PidroColors.textSoft} />
                            )}
                          </PictureDisc>
                        ) : null}
                      </View>
                      {!feedback ? (
                        <PidroText role="metadata" tone="soft" align="center">
                          {t('profile.picture_help')}
                        </PidroText>
                      ) : null}
                      {shown === 'photo' && !busy && !error ? (
                        <TextLink
                          testID="photo-remove"
                          label={t('profile.remove_photo')}
                          disabled={busy}
                          onPress={() => setConfirmRemove('photo')}
                        />
                      ) : null}
                    </>
                  )}
                </View>
              </View>
              <View testID="badge-options" style={[styles.options, short && styles.optionColumn]}>
                <Surface variant="subtle" style={[styles.ring, compact && styles.compactRow]}>
                  <PlayerAvatar size={40} {...picture} />
                  <View style={styles.copy}>
                    <PidroText role="label">{t('profile.glass_ring')}</PidroText>
                    <PidroText role="metadata" tone="soft">
                      {t('profile.supporter_ring')}
                    </PidroText>
                  </View>
                </Surface>
                <View accessibilityRole="radiogroup" style={styles.choices}>
                  <PidroText role="metadata" tone="cyan" style={styles.eyebrow}>
                    {t('profile.pin_to_wear')}
                  </PidroText>
                  {classic ? (
                    <PinRow
                      title={t('profile.classic_app')}
                      compact={compact}
                      line={classicPinLine(classic)}
                      checked={pin === 'classic'}
                      onPress={() => onChoosePin('classic')}
                      coin={
                        <Coin material="wood" size={40} rim={2.5} style={styles.inline}>
                          <Icon name="spade" size={17} color={PidroBevel.textGold} />
                        </Coin>
                      }
                    />
                  ) : null}
                  <PinRow
                    title={t('profile.founding_tester')}
                    compact={compact}
                    line={t('profile.tester_help')}
                    locked
                    coin={
                      <Coin material="glass" size={40} rim={2.5} style={styles.inline}>
                        <Icon name="spade" size={17} color={PidroColors.text} />
                      </Coin>
                    }
                  />
                  <PinRow
                    title={t('profile.no_pin')}
                    compact={compact}
                    line={t('profile.no_pin_help')}
                    checked={pin === null}
                    onPress={() => onChoosePin('none')}
                    coin={<View style={styles.noPin} />}
                  />
                </View>
              </View>
            </ScrollView>
            <TextLink
              testID="badge-done"
              label={t('profile.done')}
              disabled={busy}
              onPress={close}
            />
          </View>
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

function PictureDisc({
  label,
  size,
  checked,
  empty = false,
  disabled,
  onPress,
  children,
  testID,
}: {
  label: string;
  size: number;
  checked: boolean;
  empty?: boolean;
  disabled: boolean;
  onPress: () => void;
  children: ReactNode;
  testID: string;
}) {
  return (
    <PressableFX
      testID={testID}
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked, disabled }}
      aria-checked={checked}
      aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
      style={styles.disc}>
      <View style={{ width: size, height: size }}>
        <View
          style={[
            styles.discFace,
            { borderRadius: size / 2 },
            empty && styles.discEmpty,
            checked && styles.discOn,
          ]}>
          {children}
        </View>
        {checked ? (
          <View style={styles.discCheck}>
            <Icon name="check" size={14} color={PidroBevel.keyline} />
          </View>
        ) : null}
      </View>
      <PidroText role="label" align="center" style={checked && styles.captionOn}>
        {label}
      </PidroText>
    </PressableFX>
  );
}

function PinRow({
  title,
  line,
  coin,
  checked = false,
  locked = false,
  compact = false,
  onPress,
}: {
  title: string;
  line: string;
  coin: ReactNode;
  checked?: boolean;
  locked?: boolean;
  compact?: boolean;
  onPress?: () => void;
}) {
  return (
    <PressableFX
      accessibilityRole="radio"
      accessibilityLabel={`${title}. ${line}`}
      accessibilityState={{ checked, disabled: locked }}
      aria-checked={checked}
      aria-disabled={locked}
      disabled={locked}
      onPress={onPress}
      style={[
        styles.choice,
        checked && styles.chosen,
        compact && styles.compactRow,
        locked && styles.locked,
      ]}>
      {coin}
      <View style={styles.copy}>
        <PidroText role="label">{title}</PidroText>
        <PidroText role="metadata" tone="soft">
          {line}
        </PidroText>
      </View>
      {locked ? (
        <Icon name="lock" size={18} />
      ) : (
        <View style={[styles.radio, checked && styles.radioOn]}>
          {checked ? <View style={styles.radioDot} /> : null}
        </View>
      )}
    </PressableFX>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, justifyContent: 'flex-end', backgroundColor: PidroColors.backdrop },
  sheet: {
    maxHeight: '100%',
    flexShrink: 1,
    alignItems: 'center',
    gap: PidroSpacing.sm,
    borderTopLeftRadius: PidroRadii.lg,
    borderTopRightRadius: PidroRadii.lg,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: PidroColors.cyanBorderStrong,
    backgroundColor: PidroColors.panelStrong,
    paddingHorizontal: PidroSpacing.lg,
    paddingTop: PidroSpacing.xs,
    paddingBottom: PidroSpacing.md,
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: PidroColors.borderStrong,
  },
  compactSheet: {
    gap: PidroSpacing.xxs,
    paddingHorizontal: PidroSpacing.md,
    paddingBottom: PidroSpacing.xs,
  },
  compactContent: { gap: PidroSpacing.xxs, paddingTop: PidroSpacing.xxs },
  compactPhoto: { gap: PidroSpacing.xxs },
  compactAvatar: { paddingTop: PidroSpacing.xs, paddingBottom: PidroSpacing.sm },
  compactRow: { paddingVertical: PidroSpacing.xxs },
  scroll: { width: '100%', flexShrink: 1 },
  content: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    alignItems: 'center',
    gap: PidroSpacing.sm,
    paddingTop: PidroSpacing.xs,
  },
  columns: { maxWidth: 880, flexDirection: 'row', alignItems: 'flex-start', gap: PidroSpacing.lg },
  photo: { width: '100%', alignItems: 'center', gap: PidroSpacing.xs },
  photoColumn: { width: '38%' },
  options: { width: '100%', gap: PidroSpacing.xs },
  optionColumn: { width: undefined, flex: 1 },
  actions: { width: '100%', gap: PidroSpacing.xxs },
  feedback: { width: '100%', alignItems: 'center' },
  avatar: { padding: PidroSpacing.sm, paddingBottom: PidroSpacing.md },
  title: {
    fontFamily: PidroFonts.display,
    fontWeight: '400',
    fontSize: 26,
    lineHeight: 34,
    color: PidroBevel.textGold,
  },
  ring: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: PidroSpacing.xs,
    paddingHorizontal: 14,
  },
  copy: { minWidth: 0, flex: 1, gap: 2 },
  choices: { width: '100%', gap: PidroSpacing.xs },
  eyebrow: { paddingLeft: PidroSpacing.xxs, letterSpacing: 1, textTransform: 'uppercase' },
  choice: {
    minHeight: PidroLayout.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: PidroSpacing.xs,
    paddingHorizontal: 14,
    borderRadius: PidroRadii.lg,
    borderWidth: 1,
    borderColor: PidroColors.border,
    backgroundColor: PidroColors.panelSoft,
  },
  chosen: {
    borderWidth: 2,
    borderColor: PidroBevel.rim,
    backgroundColor: PidroColors.chosenBg,
    paddingVertical: PidroSpacing.xs - 1,
    paddingHorizontal: 13,
  },
  locked: { opacity: 0.55 },
  inline: { position: 'relative' },
  noPin: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: PidroColors.borderStrong,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: PidroColors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOn: { borderColor: PidroBevel.textGold },
  discs: { width: '100%', flexDirection: 'row', justifyContent: 'space-evenly' },
  disc: { flex: 1, alignItems: 'center', gap: PidroSpacing.xxs },
  discFace: {
    flex: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: PidroColors.border,
    backgroundColor: PidroColors.panelSoft,
  },
  discEmpty: { borderWidth: 2, borderStyle: 'dashed', borderColor: PidroColors.borderStrong },
  discOn: { borderColor: PidroBevel.rim },
  discImage: { width: '100%', height: '100%' },
  discCheck: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: PidroBevel.keyline,
    backgroundColor: PidroBevel.textGold,
  },
  captionOn: { color: PidroBevel.textGold },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: PidroBevel.textGold },
});
