import { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import Svg, { Path } from 'react-native-svg';
import { PidroBevel, PidroColors, PidroFonts, PidroSpacing } from '@/design/tokens';
import { BevelButton } from '@/components/ui/BevelButton';
import { PidroText } from '@/components/ui/PidroText';
import { PressableFX } from '@/components/ui/PressableFX';
import type { SocialProviderAvailability } from '@/features/auth/socialCredentials';
import { getSocialProviderAvailability } from '@/features/auth/socialProviders';
import { useTranslation } from '@/i18n';

export interface AuthProviderButtonsProps {
  onApple: () => void;
  onFacebook: () => void;
  onEmail?: () => void;
  showEmail?: boolean;
  showEmailDivider?: boolean;
  /** Only this provider's button, for an account that signs in with it. */
  only?: 'apple' | 'facebook';
  /** The divider's words; "or with email" unless the screen says otherwise. */
  dividerLabel?: string;
  /** Side by side where height is short (phone landscape). */
  direction?: 'column' | 'row';
  /** Deterministic native-capability override for development fixtures. */
  availability?: SocialProviderAvailability;
}

function AppleLogo() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="#000000">
      <Path d="M16.37 12.62c-.02-2.2 1.8-3.26 1.88-3.31-1.02-1.5-2.62-1.7-3.19-1.73-1.36-.14-2.65.8-3.34.8-.69 0-1.75-.78-2.88-.76-1.48.02-2.85.86-3.61 2.19-1.54 2.67-.39 6.62 1.1 8.79.73 1.06 1.6 2.25 2.74 2.2 1.1-.04 1.52-.71 2.85-.71 1.33 0 1.7.71 2.87.69 1.18-.02 1.93-1.08 2.66-2.14.84-1.23 1.18-2.42 1.2-2.48-.03-.01-2.3-.88-2.33-3.5zM14.18 6.15c.6-.73 1.01-1.75.9-2.76-.87.04-1.92.58-2.54 1.31-.56.64-1.05 1.67-.92 2.66.97.08 1.96-.49 2.56-1.21z" />
    </Svg>
  );
}

function FacebookLogo() {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="#ffffff">
      <Path d="M15.12 5.32H17V2.14A26.1 26.1 0 0 0 14.26 2c-2.72 0-4.58 1.66-4.58 4.7v2.62H6.61v3.56h3.07V22h3.68v-9.12h3.06l.46-3.56h-3.52V7.05c0-1.03.28-1.73 1.76-1.73z" />
    </Svg>
  );
}

export function AuthProviderButtons({
  onApple,
  onFacebook,
  onEmail,
  showEmail = true,
  showEmailDivider = false,
  dividerLabel,
  only,
  direction = 'column',
  availability: availabilityOverride,
}: AuthProviderButtonsProps) {
  const { t } = useTranslation();
  const [detectedAvailability, setDetectedAvailability] = useState<SocialProviderAvailability>({
    apple: false,
    facebook: false,
  });
  const offered = availabilityOverride ?? detectedAvailability;
  const availability = only
    ? {
        apple: only === 'apple' && offered.apple,
        facebook: only === 'facebook' && offered.facebook,
      }
    : offered;

  useEffect(() => {
    if (availabilityOverride) return;
    let mounted = true;
    void getSocialProviderAvailability().then((detected) => {
      if (mounted) setDetectedAvailability(detected);
    });
    return () => {
      mounted = false;
    };
  }, [availabilityOverride]);

  if (!availability.apple && !availability.facebook && !(showEmail && onEmail)) return null;

  const row = direction === 'row' && availability.apple && availability.facebook;

  return (
    <View style={styles.stack}>
      <View style={[styles.providers, row && styles.providersRow]}>
        {availability.apple ? (
          Platform.OS === 'ios' && !availabilityOverride ? (
            // White on the navy window: Apple's own button, in the style its
            // guidelines ask for on a dark surface.
            <AppleAuthentication.AppleAuthenticationButton
              testID="apple-sign-in"
              accessibilityLabel={t('auth.apple')}
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
              buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
              cornerRadius={12}
              style={[styles.appleButton, row && styles.providerInRow]}
              onPress={onApple}
            />
          ) : (
            // Apple sign-in is offered on iOS only, with Apple's own button.
            // This stands in where a fixture forces it on (web, Expo Go), so
            // previews show the real composition.
            <PressableFX
              accessibilityRole="button"
              accessibilityLabel={t('auth.apple')}
              onPress={onApple}
              style={[styles.provider, styles.appleStandIn, row && styles.providerInRow]}
              pressedStyle={styles.appleStandInPressed}>
              <AppleLogo />
              <PidroText style={[styles.providerLabel, styles.appleLabel]} numberOfLines={1}>
                {row ? 'Apple' : t('auth.apple')}
              </PidroText>
            </PressableFX>
          )
        ) : null}
        {availability.facebook ? (
          <PressableFX
            accessibilityRole="button"
            accessibilityLabel={t('auth.facebook')}
            onPress={onFacebook}
            style={[styles.provider, styles.facebookButton, row && styles.providerInRow]}
            pressedStyle={styles.facebookPressed}>
            <FacebookLogo />
            <PidroText style={styles.providerLabel} numberOfLines={1}>
              {row ? 'Facebook' : t('auth.facebook')}
            </PidroText>
          </PressableFX>
        ) : null}
      </View>
      {showEmailDivider && (availability.apple || availability.facebook) ? (
        <View style={styles.dividerRow}>
          <View style={styles.divider} />
          <PidroText role="metadata" tone="soft">
            {dividerLabel ?? t('auth.or_email')}
          </PidroText>
          <View style={styles.divider} />
        </View>
      ) : null}
      {showEmail && onEmail ? (
        <BevelButton
          label={t('auth.with_email')}
          material="glass"
          size="md"
          fullWidth
          onPress={onEmail}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    alignSelf: 'stretch',
    gap: PidroSpacing.sm,
  },
  providers: {
    gap: PidroSpacing.sm,
  },
  providersRow: {
    flexDirection: 'row',
  },
  providerInRow: {
    width: 'auto',
    minWidth: 0,
    flex: 1,
  },
  appleButton: {
    width: '100%',
    height: 50,
  },
  provider: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderRadius: 12,
    boxShadow: PidroBevel.glassDropShadow,
  },
  providerLabel: {
    fontFamily: PidroFonts.ui,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '800',
    color: '#ffffff',
  },
  appleStandIn: {
    backgroundColor: '#ffffff',
  },
  appleStandInPressed: {
    backgroundColor: '#e6edf3',
  },
  appleLabel: {
    color: '#000000',
  },
  facebookButton: {
    backgroundColor: '#1877F2',
  },
  facebookPressed: {
    backgroundColor: '#1462c9',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: PidroSpacing.sm,
    marginVertical: 2,
  },
  divider: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: PidroColors.border,
  },
});
